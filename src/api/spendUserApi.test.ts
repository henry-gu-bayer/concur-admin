import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSpendUser } from './spendUserApi';

const { concurGet } = vi.hoisted(() => ({
  concurGet: vi.fn(),
}));

vi.mock('./concurFetch', () => ({
  concurGet,
}));

describe('spendUserApi', () => {
  beforeEach(() => {
    concurGet.mockReset();
    concurGet.mockResolvedValue({ id: 'user-1' });
  });

  it('gets a spend user by UUID through the Concur proxy', async () => {
    const result = await getSpendUser(' 55b626dd-66a4-4722-af6d-d855ca8ded6c ');

    expect(concurGet).toHaveBeenCalledWith('/profile/spend/v4.1/Users/55b626dd-66a4-4722-af6d-d855ca8ded6c');
    expect(result).toEqual({ id: 'user-1' });
  });

  it('rejects a blank user ID before requesting a spend user', async () => {
    await expect(getSpendUser('   ')).rejects.toThrow('User ID is required');
    expect(concurGet).not.toHaveBeenCalled();
  });
});
