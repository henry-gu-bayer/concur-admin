import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSaePath, handleSaeCheck } from './saeCheck';

const directories: string[] = [];

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'concur-sae-'));
  directories.push(path);
  return path;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function writeExtract(folder: string, name: string, batchId: string): string {
  const row = Array.from({ length: 256 }, () => '');
  Object.assign(row, { 0: 'DETAIL', 1: batchId, 2: '2026-10-15', 3: '1' });
  const path = join(folder, name);
  writeFileSync(path, `EXTRACT|2026-10-15|1|0.0000\r\n${row.join('|')}\r\n`);
  return path;
}

describe('SAE check paths', () => {
  it('checks every .txt file in a folder and ignores other files', async () => {
    const folder = directory();
    writeExtract(folder, 'b.txt', '2');
    writeExtract(folder, 'a.txt', '1');
    writeFileSync(join(folder, 'notes.md'), 'not an extract');

    const result = await checkSaePath(folder);
    expect(result.kind).toBe('directory');
    expect(result.files.map((file) => file.name)).toEqual(['a.txt', 'b.txt']);
    expect(result.files[0]).toMatchObject({ version: 'V2', batchId: '1', detailRows: 1 });
    expect(result.crossFile).toEqual([]);
  });

  it('checks a single file, accepting a quoted path', async () => {
    const path = writeExtract(directory(), 'one.txt', '7');
    const result = await checkSaePath(`"${path}"`);
    expect(result).toMatchObject({ kind: 'file', files: [{ name: 'one.txt', batchId: '7' }] });
  });

  it('defaults to data/integrations/sae under DATA_DIR', async () => {
    const root = directory();
    const folder = join(root, 'integrations', 'sae');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(folder, { recursive: true });
    writeExtract(folder, 'default.txt', '3');
    vi.stubEnv('DATA_DIR', root);

    const result = await checkSaePath('  ');
    expect(result.target).toBe(folder);
    expect(result.files).toHaveLength(1);
  });

  it('flags the same batch delivered twice', async () => {
    const folder = directory();
    writeExtract(folder, 'a.txt', '9');
    writeExtract(folder, 'a-copy.txt', '9');
    const result = await checkSaePath(folder);
    expect(result.crossFile[0]).toMatchObject({ rule: 'X-01', severity: 'error' });
  });

  it('returns 404 JSON for a missing path', async () => {
    const res = { writeHead: vi.fn(), end: vi.fn() };
    await handleSaeCheck(res, { path: join(directory(), 'missing') });
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.objectContaining({ 'Content-Type': 'application/json' }));
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ error: expect.stringContaining('Path not found') });
  });
});
