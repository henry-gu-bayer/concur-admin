import { afterEach, describe, expect, it } from 'vitest';
import {
  getLocalOperatorInfo,
  parseClientHeaders,
  resetClientLogState,
  tryMarkClientLogged,
} from './localOperator';

afterEach(() => {
  resetClientLogState();
});

describe('getLocalOperatorInfo', () => {
  it('returns host identity fields from the local OS', () => {
    const info = getLocalOperatorInfo();
    expect(info.username).toEqual(expect.any(String));
    expect(info.username!.length).toBeGreaterThan(0);
    expect(info.hostname).toEqual(expect.any(String));
    expect(info.platform).toEqual(expect.any(String));
    expect(info.release).toEqual(expect.any(String));
    expect(info.arch).toEqual(expect.any(String));
    expect(info).toHaveProperty('userDomain');
  });
});

describe('parseClientHeaders', () => {
  it('reads X-Client-* headers case-insensitively and nulls missing fields', () => {
    expect(parseClientHeaders({
      'X-Client-User-Agent': 'Mozilla/5.0',
      'x-client-language': 'en-US',
      'X-Client-Languages': 'en-US,en',
      'X-Client-Platform': 'Win32',
      'X-Client-Ua-Data': '{"mobile":false,"platform":"Windows"}',
    })).toEqual({
      userAgent: 'Mozilla/5.0',
      language: 'en-US',
      languages: 'en-US,en',
      platform: 'Win32',
      uaData: '{"mobile":false,"platform":"Windows"}',
    });

    expect(parseClientHeaders({})).toEqual({
      userAgent: null,
      language: null,
      languages: null,
      platform: null,
      uaData: null,
    });
  });
});

describe('tryMarkClientLogged', () => {
  it('returns true only once per entity id in this process', () => {
    expect(tryMarkClientLogged('us-uat')).toBe(true);
    expect(tryMarkClientLogged('us-uat')).toBe(false);
    expect(tryMarkClientLogged('eu-prod')).toBe(true);
    expect(tryMarkClientLogged('eu-prod')).toBe(false);
  });
});
