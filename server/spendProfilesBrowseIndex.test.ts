import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SpendProfileResource, SpendProfilesQuery } from './concurSpendProfiles';
import { buildSpendProfilesBrowseIndex, querySpendProfilesBrowse, readProvisionalSpendProfiles, resumeSpendProfilesBrowseIndex } from './spendProfilesBrowseIndex';
import { ShardedSnapshotWriter } from './shardedIdentitySnapshot';

const FIELDS = ['id', 'identityPresent', 'loginId', 'employeeNumber', 'email', 'preferredName', 'country', 'custom19'];

let directory: string;
let generation: string;

function query(overrides: Partial<SpendProfilesQuery> = {}): SpendProfilesQuery {
  return {
    offset: 0, limit: 2, filters: { id: 'root', kind: 'group', logic: 'and', items: [] },
    sortBy: 'loginId', sortDir: 'asc', includeOrphans: false, source: 'complete', ...overrides,
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'spend-profiles-browse-'));
  const profiles: SpendProfileResource[] = [
    { id: 'three' }, { id: 'one' }, { id: 'orphan' }, { id: 'two' },
  ];
  const values: Record<string, Record<string, string>> = {
    three: { id: 'three', identityPresent: 'true', loginId: 'zoe@example.com', employeeNumber: '30', email: 'zoe@example.com', preferredName: 'Zoë', country: 'DE', custom19: '300' },
    one: { id: 'one', identityPresent: 'true', loginId: 'alice2@example.com', employeeNumber: '10', email: 'alice2@example.com', preferredName: 'Alice 2', country: 'PT', custom19: '100' },
    orphan: { id: 'orphan', identityPresent: 'false', loginId: '', employeeNumber: '', email: '', preferredName: '', country: 'US', custom19: '050' },
    two: { id: 'two', identityPresent: 'true', loginId: 'alice10@example.com', employeeNumber: '20', email: 'alice10@example.com', preferredName: 'Alice 10', country: 'FR', custom19: '200' },
  };
  const writer = new ShardedSnapshotWriter<SpendProfileResource>(directory, 'us-production', FIELDS, (profile) => values[profile.id]);
  writer.append(profiles);
  generation = writer.finalize('2026-09-06T00:00:00.000Z', 1, { spendFields: ['country'], customFields: ['custom19'] }).generation;
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('Spend Profiles browse index', () => {
  it('serves every sortable field in both directions and excludes orphans by default', async () => {
    const manifest = await buildSpendProfilesBrowseIndex(directory, 'us-production', generation);
    expect(manifest).toMatchObject({ count: 4, presentCount: 3, pageSize: 2048, sourceGeneration: generation });

    expect(querySpendProfilesBrowse(directory, generation, query())?.rows.map((row) => row.id)).toEqual(['one', 'two']);
    expect(querySpendProfilesBrowse(directory, generation, query({ offset: 2, limit: 1 }))?.rows.map((row) => row.id)).toEqual(['three']);
    expect(querySpendProfilesBrowse(directory, generation, query({ sortDir: 'desc' }))?.rows.map((row) => row.id)).toEqual(['three', 'two']);
    expect(querySpendProfilesBrowse(directory, generation, query({ sortBy: 'custom19', sortDir: 'desc' }))?.rows.map((row) => row.id)).toEqual(['three', 'two']);
    expect(querySpendProfilesBrowse(directory, generation, query({ includeOrphans: true, limit: 10 }))?.total).toBe(4);
  });

  it('keeps a 343,000-record completed-snapshot query independent of total source-index size', async () => {
    const largeDirectory = mkdtempSync(join(tmpdir(), 'spend-profiles-browse-large-'));
    try {
      const fields = ['id', 'identityPresent', 'loginId'];
      const writer = new ShardedSnapshotWriter<SpendProfileResource>(largeDirectory, 'performance', fields, (profile) => ({
        id: profile.id,
        identityPresent: 'true',
        loginId: `user-${profile.id.padStart(6, '0')}@example.com`,
      }));
      for (let start = 0; start < 343_000; start += 5_000) {
        writer.append(Array.from({ length: Math.min(5_000, 343_000 - start) }, (_, index) => ({ id: String(343_000 - start - index) })));
      }
      const largeGeneration = writer.finalize('2026-09-06T00:00:00.000Z', 3430).generation;
      await buildSpendProfilesBrowseIndex(largeDirectory, 'performance', largeGeneration);
      unlinkSync(join(largeDirectory, 'generations', largeGeneration, 'indexes', 'loginId.ndjson'));

      const started = performance.now();
      const result = querySpendProfilesBrowse(largeDirectory, largeGeneration, query({ limit: 200 }));
      const elapsed = performance.now() - started;
      expect(result).toMatchObject({ total: 343_000, provisional: false, orderingReady: true });
      expect(result?.rows).toHaveLength(200);
      expect(elapsed).toBeLessThan(500);
    } finally {
      rmSync(largeDirectory, { recursive: true, force: true });
    }
  }, 120_000);

  it('uses only committed order pages and compact rows after indexing', async () => {
    await buildSpendProfilesBrowseIndex(directory, 'us-production', generation);
    const loginIndex = join(directory, 'generations', generation, 'indexes', 'loginId.ndjson');
    expect(existsSync(loginIndex)).toBe(true);
    unlinkSync(loginIndex);

    const result = querySpendProfilesBrowse(directory, generation, query({ limit: 3 }));
    expect(result).toMatchObject({ total: 3, provisional: false, orderingReady: true });
    expect(result?.rows.map((row) => row.loginId)).toEqual(['alice2@example.com', 'alice10@example.com', 'zoe@example.com']);
  });

  it('returns a bounded provisional page before the browse generation is ready', () => {
    const result = readProvisionalSpendProfiles(directory, generation, query({ limit: 2 }));
    expect(result).toMatchObject({ provisional: true, orderingReady: false, hasMore: false });
    expect(result.rows.map((row) => row.id)).toEqual(['three', 'one']);
    expect(result.rows[0].values.country).toBe('DE');
  });

  it('resumes a persisted local browse job without retrieving from Concur', async () => {
    const browseDirectory = join(directory, 'generations', generation, 'browse');
    mkdirSync(browseDirectory, { recursive: true });
    writeFileSync(join(browseDirectory, 'job.json'), JSON.stringify({
      format: 'spend-profiles-browse-job-v1', runId: 'saved-run', entityId: 'us-production', sourceGeneration: generation,
      state: 'paused', phase: 'rows', percent: 0, rowCount: 0, presentCount: 0, sourceOffsets: {}, rowBytes: 0,
      entryBytes: {}, completedFields: [], orderManifests: {}, fieldEntries: 0,
      startedAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', lastCheckpointAt: null,
    }));

    expect(resumeSpendProfilesBrowseIndex(directory, 'us-production', generation).sourceGeneration).toBe(generation);
    await expect(buildSpendProfilesBrowseIndex(directory, 'us-production', generation)).resolves.toMatchObject({ generation: 'saved-run', count: 4 });
  });

  it('fails closed when an order page is missing or does not match its checksum', async () => {
    const manifest = await buildSpendProfilesBrowseIndex(directory, 'us-production', generation);
    const page = join(directory, 'generations', generation, 'browse', 'generations', manifest.generation, 'orders', 'loginId', '000000.json');
    unlinkSync(page);
    expect(() => querySpendProfilesBrowse(directory, generation, query())).toThrow(/browse index is incomplete/);

    writeFileSync(page, JSON.stringify([[0, 1, 1]]));
    expect(() => querySpendProfilesBrowse(directory, generation, query())).toThrow(/checksum failed/);
  });
});
