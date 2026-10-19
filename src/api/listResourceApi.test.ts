import { beforeEach, describe, expect, it, vi } from 'vitest';
import { concurGet } from './concurFetch';
import { getListResource } from './listResourceApi';

vi.mock('./concurFetch', () => ({ concurGet: vi.fn() }));

describe('list resource details', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['lists', 'listitems'])('dereferences %s through the entity-scoped authenticated proxy', async resource => {
    vi.mocked(concurGet).mockResolvedValue({ ID: 'legacy', ExtraField: false });
    const signal = new AbortController().signal;
    expect(await getListResource(`https://eu.api.concursolutions.com/api/v3.0/common/${resource}/legacy?user=ALL`, 'eu-uat', signal)).toEqual({ ID: 'legacy', ExtraField: false });
    expect(concurGet).toHaveBeenCalledWith(`/api/v3.0/common/${resource}/legacy?user=ALL`, { headers: { 'X-Concur-Entity': 'eu-uat' }, signal });
  });

  it.each([
    'https://evil.example/api/v3.0/common/lists/a',
    'https://us.api.concursolutions.com.evil.example/api/v3.0/common/lists/a',
    'http://us.api.concursolutions.com/api/v3.0/common/lists/a',
    'https://secret@us.api.concursolutions.com/api/v3.0/common/lists/a',
    '/api/v3.0/expense/reports/a',
    '/api/v3.0/common/lists/../secrets/a',
  ])('rejects an untrusted resource URL: %s', async uri => {
    await expect(getListResource(uri, 'us-uat')).rejects.toThrow();
    expect(concurGet).not.toHaveBeenCalled();
  });

  it('rejects invalid detail data', async () => {
    vi.mocked(concurGet).mockResolvedValue('not a record');
    await expect(getListResource('/api/v3.0/common/lists/a', 'us-uat')).rejects.toThrow('invalid list detail');
  });
});
