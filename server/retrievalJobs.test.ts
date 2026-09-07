import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRetrievalJob, profilePageSignal, retrievalIsStalled, retryPage, UpstreamPageError } from './retrievalJobs';

let dataDirectory: string;

beforeEach(() => {
  dataDirectory = mkdtempSync(join(tmpdir(), 'concur-retrieval-jobs-'));
  vi.stubEnv('DATA_DIR', dataDirectory);
});

afterEach(() => {
  rmSync(dataDirectory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('profile retrieval safeguards', () => {
  it('applies a hard timeout signal to an upstream page request', async () => {
    const signal = profilePageSignal(5);

    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));

    expect(signal.aborted).toBe(true);
    expect(signal.reason?.name).toBe('TimeoutError');
  });

  it('retries a transient page failure at most five times', async () => {
    const job = createRetrievalJob('us-uat', 'active-users');
    const request = vi.fn().mockRejectedValue(new UpstreamPageError('busy', 503));

    await expect(retryPage(job, request)).rejects.toThrow('busy');

    expect(request).toHaveBeenCalledTimes(5);
    expect(job.retryAttempt).toBe(4);
  });

  it('recognizes a missing heartbeat after 180 seconds', () => {
    const job = createRetrievalJob('us-uat', 'spend-profiles');
    job.lastHeartbeatAt = '2026-09-05T00:00:00.000Z';

    expect(retrievalIsStalled(job, Date.parse('2026-09-05T00:03:00.000Z'))).toBe(true);
    expect(retrievalIsStalled(job, Date.parse('2026-09-05T00:02:59.999Z'))).toBe(false);
  });
});
