import { describe, expect, it } from 'vitest';
import { clientInfoHeaders } from './clientInfo';

describe('clientInfoHeaders', () => {
  it('maps navigator fields onto X-Client-* headers', () => {
    expect(clientInfoHeaders({
      userAgent: 'Mozilla/5.0',
      language: 'en-US',
      languages: ['en-US', 'en'],
      platform: 'Win32',
      userAgentData: { brands: [{ brand: 'Chromium', version: '120' }], mobile: false, platform: 'Windows' },
    })).toEqual({
      'X-Client-User-Agent': 'Mozilla/5.0',
      'X-Client-Language': 'en-US',
      'X-Client-Languages': 'en-US,en',
      'X-Client-Platform': 'Win32',
      'X-Client-Ua-Data': JSON.stringify({ brands: [{ brand: 'Chromium', version: '120' }], mobile: false, platform: 'Windows' }),
    });
  });

  it('omits unavailable fields including userAgentData', () => {
    expect(clientInfoHeaders({ userAgent: 'Mozilla/5.0' })).toEqual({
      'X-Client-User-Agent': 'Mozilla/5.0',
    });
  });
});
