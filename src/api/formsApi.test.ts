import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFormsSnapshot, refreshForms } from './formsApi';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function sseResponse(frames: string, status = 200) {
  const encoded = new TextEncoder().encode(frames);
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: () => {
          if (sent) return Promise.resolve({ done: true, value: undefined });
          sent = true;
          return Promise.resolve({ done: false, value: encoded });
        },
      }),
    },
    text: () => Promise.resolve(frames),
  };
}

const snapshot = {
  retrievedAt: '2026-08-07T00:00:00.000Z',
  formTypes: [
    { name: 'Expense Report Header', formCode: 'RPTINFO', forms: [{ name: 'Default Report Information', formId: 'f$1', fields: [] }] },
  ],
};

describe('formsApi', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('returns null when no snapshot has been fetched yet (404)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'no snapshot' }, 404));
    await expect(getFormsSnapshot()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/local/forms', expect.objectContaining({ cache: 'no-store' }));
  });

  it('returns the parsed snapshot when present', async () => {
    fetchMock.mockResolvedValue(jsonResponse(snapshot));
    await expect(getFormsSnapshot()).resolves.toEqual(snapshot);
  });

  it('throws on unexpected errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    await expect(getFormsSnapshot()).rejects.toThrow('HTTP 500');
  });

  it('streams refresh progress and done summary from SSE frames', async () => {
    const frames = [
      'event: progress\ndata: {"phase":"types","types":2}\n\n',
      'event: progress\ndata: {"phase":"done-form","formName":"Default Report Information","formsFetched":1,"formsTotal":3}\n\n',
      'event: done\ndata: {"types":2,"forms":3,"fields":42,"failed":0}\n\n',
    ].join('');
    fetchMock.mockResolvedValue(sseResponse(frames));

    const progress: { phase: string }[] = [];
    const done: { fields?: number }[] = [];
    await refreshForms({ onProgress: (p) => progress.push(p), onDone: (s) => done.push(s) });

    expect(fetchMock).toHaveBeenCalledWith('/api/local/forms/refresh', expect.objectContaining({ method: 'POST' }));
    expect(progress.map((p) => p.phase)).toEqual(['types', 'done-form']);
    expect(done).toEqual([{ types: 2, forms: 3, fields: 42, failed: 0 }]);
  });

  it('reports refresh failures via onError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'denied' }, 500));
    const errors: string[] = [];
    await refreshForms({ onError: (message) => errors.push(message) });
    expect(errors[0]).toContain('HTTP 500');
  });
});
