import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

let temporarySequence = 0;

export class CorruptSnapshotError extends Error {
  constructor(public readonly filePath: string, cause: unknown) {
    super(`Local snapshot is corrupt: ${filePath}. Refresh it explicitly to replace the damaged file.`, { cause });
    this.name = 'CorruptSnapshotError';
  }
}

/** Missing and malformed snapshots are intentionally different states. */
export function readJsonSnapshot<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch (error) {
    console.warn(`[concur:snapshot] corrupt JSON snapshot: ${filePath}`);
    throw new CorruptSnapshotError(filePath, error);
  }
}

/** Write beside the destination, then rename so readers never see partial JSON. */
export function writeJsonSnapshot(filePath: string, value: unknown, pretty = false): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryFile = `${filePath}.tmp-${process.pid}-${Date.now()}-${++temporarySequence}`;
  try {
    writeFileSync(temporaryFile, JSON.stringify(value, null, pretty ? 2 : undefined), 'utf-8');
    renameSync(temporaryFile, filePath);
  } catch (error) {
    try { unlinkSync(temporaryFile); } catch { /* The temporary file may not have been created. */ }
    throw error;
  }
}
