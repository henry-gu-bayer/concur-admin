import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { entityDataDirectory } from './entityDataDirectory';

let dataDirectory = '';

afterEach(() => {
  if (dataDirectory) rmSync(dataDirectory, { recursive: true, force: true });
  dataDirectory = '';
  vi.unstubAllEnvs();
});

describe('entityDataDirectory', () => {
  it('uses lowercase entity IDs for snapshot directories', () => {
    dataDirectory = mkdtempSync(join(tmpdir(), 'concur-data-directory-'));
    vi.stubEnv('DATA_DIR', dataDirectory);

    expect(entityDataDirectory('US-UAT')).toBe(join(dataDirectory, 'us-uat'));
  });

  it('moves a legacy mixed-case snapshot directory when no lowercase directory exists', () => {
    dataDirectory = mkdtempSync(join(tmpdir(), 'concur-data-directory-'));
    const legacyDirectory = join(dataDirectory, 'US-UAT');
    mkdirSync(legacyDirectory, { recursive: true });
    vi.stubEnv('DATA_DIR', dataDirectory);

    expect(entityDataDirectory('US-UAT')).toBe(join(dataDirectory, 'us-uat'));
    expect(existsSync(join(dataDirectory, 'us-uat'))).toBe(true);
    expect(readdirSync(dataDirectory)).toContain('us-uat');
    expect(readdirSync(dataDirectory)).not.toContain('US-UAT');
  });
});
