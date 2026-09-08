import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTravelUser } from './travelUserApi';

const { concurGet } = vi.hoisted(() => ({
  concurGet: vi.fn(),
}));

vi.mock('./concurFetch', () => ({
  concurGet,
}));

describe('travelUserApi', () => {
  beforeEach(() => {
    concurGet.mockReset();
    concurGet.mockResolvedValue({ id: 'user-1' });
  });

  it('gets a travel user by UUID through the Concur proxy', async () => {
    const result = await getTravelUser(' 55b626dd-66a4-4722-af6d-d855ca8ded6c ');

    expect(concurGet).toHaveBeenCalledWith('/travel/v4/Users/55b626dd-66a4-4722-af6d-d855ca8ded6c');
    expect(result).toEqual({ id: 'user-1' });
  });

  it('rejects a blank user ID before requesting a travel user', async () => {
    await expect(getTravelUser('   ')).rejects.toThrow('User ID is required');
    expect(concurGet).not.toHaveBeenCalled();
  });
});
