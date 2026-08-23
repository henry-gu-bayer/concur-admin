import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLocalityCountries,
  handleGetLocalityCountries,
  handleRefreshLocalityCountries,
  readLocalityCountriesSnapshot,
} from './concurLocalities';

const { undiciFetch, logApiCall, logApiCallFailure, getServerAccessToken } = vi.hoisted(() => ({
  undiciFetch: vi.fn(),
  logApiCall: vi.fn(),
  logApiCallFailure: vi.fn(),
  getServerAccessToken: vi.fn(),
}));

vi.mock('undici', () => ({
  fetch: undiciFetch,
}));

vi.mock('./logger', () => ({
  logApiCall,
  logApiCallFailure,
}));

vi.mock('./concurAuth', () => ({
  getServerAccessToken,
}));

vi.mock('./entities', () => ({
  createEntityRegistry: () => ({
    require: () => ({ id: 'us-uat', baseUrl: 'https://us2.api.concursolutions.com' }),
  }),
}));

const COUNTRIES_RESPONSE = {
  countries: [
    {
      code: 'CN',
      active: true,
      names: [{ name: 'CHINA', langCode: 'en' }],
      currencies: [{ code: 'CNY' }],
      links: [{ rel: 'self', href: 'https://us2.api.concursolutions.com/localities/v5/countries/CN' }],
    },
    {
      code: 'US',
      active: true,
      names: [{ name: 'UNITED STATES', langCode: 'en' }],
      currencies: [{ code: 'USD' }],
      links: [{ rel: 'self', href: 'https://us2.api.concursolutions.com/localities/v5/countries/US' }],
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { forEach: (cb: (value: string, key: string) => void) => cb('application/json', 'content-type') },
  };
}

let dataDir: string;

beforeEach(() => {
  undiciFetch.mockReset();
  logApiCall.mockReset();
  logApiCallFailure.mockReset();
  getServerAccessToken.mockReset();
  getServerAccessToken.mockResolvedValue('server-token');
  undiciFetch.mockResolvedValue(jsonResponse(COUNTRIES_RESPONSE));
  dataDir = mkdtempSync(join(tmpdir(), 'concur-localities-'));
  vi.stubEnv('DATA_DIR', dataDir);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function fakeResponse() {
  return {
    statusCode: 0,
    body: '',
    writeHead(code: number) { this.statusCode = code; },
    end(body?: string) { this.body = body ?? ''; },
  };
}

describe('localities countries snapshot', () => {
  it('fetches all countries from Localities v5, logs the API call, and persists the snapshot', async () => {
    const snapshot = await fetchLocalityCountries('us-uat');

    expect(undiciFetch).toHaveBeenCalledWith(
      'https://us2.api.concursolutions.com/localities/v5/countries',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(snapshot.countries.map((country) => country.code)).toEqual(['CN', 'US']);
    expect(logApiCall).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dataDir, 'us-uat', 'localities-countries.json'))).toBe(true);
    expect(readLocalityCountriesSnapshot('us-uat')?.countries).toHaveLength(2);
  });

  it('logs and rethrows transport failures', async () => {
    undiciFetch.mockRejectedValue(new Error('connection failed'));

    await expect(fetchLocalityCountries('us-uat')).rejects.toThrow('connection failed');
    expect(logApiCallFailure).toHaveBeenCalledWith('us-uat', expect.objectContaining({ error: 'connection failed' }));
  });

  it('serves 404 until refreshed and returns the cached snapshot afterwards', async () => {
    const missing = fakeResponse();
    handleGetLocalityCountries(missing, 'us-uat');
    expect(missing.statusCode).toBe(404);

    await fetchLocalityCountries('us-uat');
    const found = fakeResponse();
    handleGetLocalityCountries(found, 'us-uat');
    expect(found.statusCode).toBe(200);
    expect(JSON.parse(found.body).countries).toHaveLength(2);
  });

  it('refresh handler fetches and returns the new snapshot', async () => {
    const res = fakeResponse();
    await handleRefreshLocalityCountries(res, 'us-uat');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).countries[0].code).toBe('CN');
  });
});
