import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logApiCall, logApiCallFailure, logTokenExchangeFailure } from './logger';

const directories: string[] = [];

function logDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'concur-logger-'));
  directories.push(directory);
  return directory;
}

function readEntries(directory: string, entityId: string): Record<string, unknown>[] {
  return readFileSync(join(directory, entityId, 'api.log'), 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'silent');
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('failure logging', () => {
  it('persists a failed token exchange with status 0 and masked credentials', () => {
    const directory = logDirectory();

    logTokenExchangeFailure('us-uat', 'https://us.example.test/oauth2/v0/token', {
      requestHeaders: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer should-be-masked' },
      requestBody: 'client_id=us-client&client_secret=us-secret&grant_type=refresh_token&refresh_token=us-refresh',
      error: 'connect ETIMEDOUT 10.0.0.1:443',
      responseTimeMs: 1200,
    }, directory);

    const [entry] = readEntries(directory, 'us-uat');
    expect(entry).toMatchObject({
      entityId: 'us-uat',
      kind: 'auth',
      method: 'POST',
      url: 'https://us.example.test/oauth2/v0/token',
      responseStatus: 0,
      correlationId: null,
      responseTimeMs: 1200,
      responseBody: { error: 'connect ETIMEDOUT 10.0.0.1:443' },
    });
    expect(entry.requestParams).toContain('client_id=***');
    expect(entry.requestParams).toContain('grant_type=refresh_token');
    expect(entry.requestParams).not.toContain('us-secret');
    expect(entry.requestParams).not.toContain('us-refresh');
    expect((entry.requestHeaders as Record<string, unknown>).Authorization).toBe('***');
  });

  it('persists a failed proxied API call with status 0 and the transport error', () => {
    const directory = logDirectory();

    logApiCallFailure('us-uat', {
      method: 'GET',
      url: 'https://us.example.test/profile/spend/v4.1/Users/x',
      requestHeaders: { Authorization: 'Bearer should-be-masked' },
      requestBody: '',
      error: 'socket hang up',
      responseTimeMs: 300,
    }, directory);

    const [entry] = readEntries(directory, 'us-uat');
    expect(entry).toMatchObject({
      entityId: 'us-uat',
      kind: 'api',
      method: 'GET',
      url: 'https://us.example.test/profile/spend/v4.1/Users/x',
      responseStatus: 0,
      correlationId: null,
      responseTimeMs: 300,
      responseBody: { error: 'socket hang up' },
    });
    expect((entry.requestHeaders as Record<string, unknown>).Authorization).toBe('***');
  });

  it('masks sensitive URL query parameters before persisting an API call', () => {
    const directory = logDirectory();

    logApiCall('us-uat', {
      method: 'GET',
      url: 'https://us.example.test/api?countryCode=CN&access_token=visible-token&client_secret=visible-secret',
      requestHeaders: {},
      requestBody: '',
      response: { status: 200, headers: {}, body: '{}' },
      responseTimeMs: 12,
    }, directory);

    const [entry] = readEntries(directory, 'us-uat');
    expect(entry.url).toContain('countryCode=CN');
    expect(entry.url).toContain('access_token=***');
    expect(entry.url).toContain('client_secret=***');
    expect(entry.url).not.toContain('visible-token');
    expect(entry.url).not.toContain('visible-secret');
  });
});
