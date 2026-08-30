import { describe, expect, it, vi } from 'vitest';
import { dedupeRefresh } from './refreshCoordinator';

describe('refresh coordinator', () => {
  it('shares a running refresh and permits a later refresh after completion', async () => {
    let resolve!: (value: number) => void;
    const task = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
    const first = dedupeRefresh('lists:us-uat', task);
    const second = dedupeRefresh('lists:us-uat', task);
    expect(first).toBe(second);
    expect(task).toHaveBeenCalledTimes(1);
    resolve(3);
    await expect(first).resolves.toBe(3);
    await dedupeRefresh('lists:us-uat', async () => 4);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
