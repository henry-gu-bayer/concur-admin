import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listLogFiles, readLogEntries } from './apiLogs';
import { logApiCall } from './logger';

const directories: string[] = [];

function logDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'concur-api-logs-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('API log files', () => {
  it('lists only rolling API log files newest first', () => {
    const directory = logDirectory();
    writeFileSync(join(directory, 'api.log'), '{}\n');
    writeFileSync(join(directory, 'api.1.log'), '{}\n');
    writeFileSync(join(directory, 'notes.log'), '{}\n');

    expect(listLogFiles(directory).map((file) => file.name)).toEqual(['api.log', 'api.1.log']);
  });

  it('rejects invalid filenames and returns valid entries newest first', () => {
    const directory = logDirectory();
    writeFileSync(
      join(directory, 'api.log'),
      [
        JSON.stringify({ requestDateTime: '2026-08-05T09:00:00.000Z', url: '/old' }),
        'not json',
        JSON.stringify({ requestDateTime: '2026-08-05T10:00:00.000Z', url: '/new' }),
      ].join('\n')
    );

    expect(readLogEntries(directory, '../api.log')).toEqual([]);
    expect(readLogEntries(directory, 'api.log').map((entry) => entry.url)).toEqual(['/new', '/old']);
  });

  it('keeps writes and listings scoped to an entity log directory', () => {
    const directory = logDirectory();
    logApiCall('us-uat', {
      method: 'GET',
      url: 'https://us.example.test/list/v4/lists',
      requestHeaders: {},
      requestBody: '',
      response: { status: 200, headers: {}, body: '{}' },
      responseTimeMs: 12,
    }, directory);

    const entityDirectory = join(directory, 'us-uat');
    expect(existsSync(join(entityDirectory, 'api.log'))).toBe(true);
    expect(listLogFiles(entityDirectory).map((file) => file.name)).toEqual(['api.log']);
    expect(readLogEntries(entityDirectory, 'api.log')[0]).toMatchObject({ entityId: 'us-uat' });
    expect(readFileSync(join(entityDirectory, 'api.log'), 'utf-8')).not.toContain('Authorization');
  });
});
