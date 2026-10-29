import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import {
  crossFileFindings,
  validateSaeContent,
  type SaeCrossFileFinding,
  type SaeFileKeys,
  type SaeFileResult,
} from './saeValidator';

/**
 * Local SAE file check: validates one extract file, or every `.txt` extract in
 * a folder, against the SAE specification (see server/saeValidator.ts).
 *
 * The files never leave the machine and the response carries findings only —
 * not file content — with card, bank, and contact values masked. Unlike the
 * snapshot repositories, the path is user-supplied: an admin points it at
 * wherever the integration drops its extracts.
 */

export interface SaeCheckResponse {
  target: string;
  kind: 'file' | 'directory';
  checkedAt: string;
  files: SaeFileResult[];
  crossFile: SaeCrossFileFinding[];
  skipped: { name: string; reason: string }[];
}

/** One SAE export is a few MB; this bound only stops an accidental multi-GB pick. */
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 200;

export class SaeCheckError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function defaultSaeDirectory(): string {
  return join(process.env.DATA_DIR ?? 'data', 'integrations', 'sae');
}

/** Paths pasted from Explorer often arrive wrapped in quotes. */
function normalizeInput(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim().replace(/^"(.*)"$/, '$1').trim() : '';
  return text || defaultSaeDirectory();
}

/** Yield between files so a large folder does not stall the dev server's other requests. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((done) => setImmediate(done));
}

export async function checkSaePath(rawPath: unknown): Promise<SaeCheckResponse> {
  const target = resolve(normalizeInput(rawPath));
  let targetStat;
  try {
    targetStat = await stat(target);
  } catch {
    throw new SaeCheckError(`Path not found: ${target}`, 404);
  }

  const skipped: SaeCheckResponse['skipped'] = [];
  let candidates: string[];
  if (targetStat.isDirectory()) {
    const entries = await readdir(target, { withFileTypes: true });
    candidates = entries
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.txt')
      .map((entry) => join(target, entry.name))
      .sort((a, b) => a.localeCompare(b));
    if (candidates.length > MAX_FILES) {
      for (const path of candidates.slice(MAX_FILES)) skipped.push({ name: basename(path), reason: `Only the first ${MAX_FILES} files are checked per run.` });
      candidates = candidates.slice(0, MAX_FILES);
    }
  } else if (targetStat.isFile()) {
    candidates = [target];
  } else {
    throw new SaeCheckError(`Not a file or folder: ${target}`, 400);
  }

  const files: SaeFileResult[] = [];
  const keys: { name: string; keys: SaeFileKeys }[] = [];
  for (const path of candidates) {
    const name = basename(path);
    try {
      const { size } = await stat(path);
      if (size > MAX_FILE_BYTES) {
        skipped.push({ name, reason: `File is ${Math.round(size / 1024 / 1024)} MB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.` });
        continue;
      }
      const { result, keys: fileKeys } = validateSaeContent(name, path, await readFile(path));
      files.push(result);
      keys.push({ name, keys: fileKeys });
    } catch (error) {
      skipped.push({ name, reason: error instanceof Error ? error.message : String(error) });
    }
    await yieldToEventLoop();
  }

  return {
    target,
    kind: targetStat.isDirectory() ? 'directory' : 'file',
    checkedAt: new Date().toISOString(),
    files,
    crossFile: crossFileFindings(keys),
    skipped,
  };
}

type Response = {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
};

export async function handleSaeCheck(res: Response, body: unknown): Promise<void> {
  const path = typeof body === 'object' && body !== null ? (body as { path?: unknown }).path : undefined;
  try {
    const result = await checkSaePath(path);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof SaeCheckError ? error.status : 500;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}
