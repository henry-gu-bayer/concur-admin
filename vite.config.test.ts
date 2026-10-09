// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from 'vite';
import config from './vite.config';

vi.mock('vite', async (importOriginal) => ({
  ...await importOriginal<typeof import('vite')>(),
  loadEnv: vi.fn(),
}));

async function resolveConfig() {
  if (typeof config !== 'function') throw new Error('Expected a Vite config function');
  return config({ command: 'serve', mode: 'test' });
}

describe('local server port', () => {
  beforeEach(() => {
    vi.mocked(loadEnv).mockReturnValue({});
  });

  it.each([undefined, '', '   '])('defaults to 5173 when PORT is %j', async (port) => {
    vi.mocked(loadEnv).mockReturnValue(port === undefined ? {} : { PORT: port });
    const resolved = await resolveConfig();
    expect(resolved.server?.port).toBe(5173);
    expect(resolved.preview?.port).toBe(5173);
  });

  it.each(['6666', '5180', ' 5180 ', '1', '65535'])('uses PORT=%j for dev and preview', async (port) => {
    vi.mocked(loadEnv).mockReturnValue({ PORT: port });
    const resolved = await resolveConfig();
    expect(resolved.server?.port).toBe(Number(port));
    expect(resolved.preview?.port).toBe(Number(port));
    expect(resolved.server?.strictPort).toBe(true);
    expect(resolved.preview?.strictPort).toBe(true);
  });

  it.each(['abc', '0', '-1', '65536', '5173.5'])('rejects invalid PORT=%j', async (port) => {
    vi.mocked(loadEnv).mockReturnValue({ PORT: port });
    await expect(resolveConfig()).rejects.toThrow('PORT must be an integer between 1 and 65535.');
  });
});
