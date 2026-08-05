import { describe, expect, it, vi } from 'vitest';
import { createTokenManager } from './concurAuth';
import type { ConcurEntity } from './entities';

const us: ConcurEntity = {
  id: 'us-uat',
  label: 'US UAT',
  baseUrl: 'https://us.example.test',
  clientId: 'us-client',
  clientSecret: 'us-secret',
  refreshToken: 'us-refresh',
};

const eu: ConcurEntity = {
  ...us,
  id: 'eu-prod',
  label: 'Europe Production',
  baseUrl: 'https://eu.example.test',
  clientId: 'eu-client',
  refreshToken: 'eu-refresh',
};

describe('entity-scoped token manager', () => {
  it('caches and refreshes access tokens independently per entity', async () => {
    const exchange = vi.fn(async (entity: ConcurEntity, refreshToken: string) => ({
      accessToken: `${entity.id}-${refreshToken}-token`,
      refreshToken,
      expiresAt: Date.now() + 60 * 60 * 1000,
    }));
    const tokens = createTokenManager(exchange);

    await expect(tokens.get(us)).resolves.toBe('us-uat-us-refresh-token');
    await expect(tokens.get(us)).resolves.toBe('us-uat-us-refresh-token');
    await expect(tokens.get(eu)).resolves.toBe('eu-prod-eu-refresh-token');
    await expect(tokens.refresh(us)).resolves.toBe('us-uat-us-refresh-token');

    expect(exchange).toHaveBeenCalledTimes(3);
    expect(exchange).toHaveBeenNthCalledWith(1, us, 'us-refresh');
    expect(exchange).toHaveBeenNthCalledWith(2, eu, 'eu-refresh');
    expect(exchange).toHaveBeenNthCalledWith(3, us, 'us-refresh');
  });
});
