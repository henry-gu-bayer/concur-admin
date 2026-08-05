import { describe, expect, it } from 'vitest';
import { createEntityRegistry } from './entities';

describe('entity registry', () => {
  it('parses named entities and exposes only safe metadata', () => {
    const registry = createEntityRegistry({
      CONCUR_ENTITIES: 'us-uat, eu-prod',
      CONCUR_US_UAT_LABEL: 'US UAT',
      CONCUR_US_UAT_BASE_URL: 'https://us.example.test/',
      CONCUR_US_UAT_CLIENT_ID: 'us-client',
      CONCUR_US_UAT_CLIENT_SECRET: 'us-secret',
      CONCUR_US_UAT_REFRESH_TOKEN: 'us-refresh',
      CONCUR_EU_PROD_LABEL: 'Europe Production',
      CONCUR_EU_PROD_BASE_URL: 'https://eu.example.test',
      CONCUR_EU_PROD_CLIENT_ID: 'eu-client',
      CONCUR_EU_PROD_CLIENT_SECRET: 'eu-secret',
      CONCUR_EU_PROD_REFRESH_TOKEN: 'eu-refresh',
    });

    expect(registry.list()).toEqual([
      { id: 'us-uat', label: 'US UAT' },
      { id: 'eu-prod', label: 'Europe Production' },
    ]);
    expect(registry.require('us-uat')).toMatchObject({
      id: 'us-uat',
      baseUrl: 'https://us.example.test',
      clientId: 'us-client',
    });
    expect(JSON.stringify(registry.list())).not.toContain('secret');
    expect(() => registry.require('unknown')).toThrow('Unknown Concur entity "unknown"');
  });

  it('uses legacy credentials as the default us-uat entity when named entities are absent', () => {
    const registry = createEntityRegistry({
      BASE_URL: 'https://legacy.example.test/',
      CLIENT_ID: 'legacy-client',
      CLIENT_SECRET: 'legacy-secret',
      REFRESH_TOKEN: 'legacy-refresh',
    });

    expect(registry.defaultId).toBe('us-uat');
    expect(registry.require()).toMatchObject({
      id: 'us-uat',
      label: 'us-uat',
      baseUrl: 'https://legacy.example.test',
      clientId: 'legacy-client',
    });
  });

  it('rejects blank or incomplete selected entities', () => {
    expect(() => createEntityRegistry({ CONCUR_ENTITIES: 'us-uat, ,' })).toThrow('CONCUR_ENTITIES contains an empty entity ID');
    expect(() => createEntityRegistry({
      CONCUR_ENTITIES: 'us-uat',
      CONCUR_US_UAT_BASE_URL: 'https://us.example.test',
    })).toThrow('Concur entity "us-uat" is not configured');
  });
});
