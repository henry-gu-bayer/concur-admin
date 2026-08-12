import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildEntriesPath,
  buildReportsPath,
  fetchAllReports,
  fetchReportEntries,
  searchReports,
  PAGE_LIMIT,
} from './reportsApi';

const { concurGet } = vi.hoisted(() => ({ concurGet: vi.fn() }));

vi.mock('./concurFetch', () => ({ concurGet }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildReportsPath', () => {
  it('combines all filters into one query string', () => {
    const path = buildReportsPath({
      loginId: 'jane.doe@example.com',
      approvalStatusCode: 'A_PEND',
      paymentStatusCode: 'P_NOTP',
      countryCode: 'US',
      createdAfter: '2026-01-01',
      createdBefore: '2026-01-31',
      submittedAfter: '2026-02-01',
      submittedBefore: '2026-02-28',
      paidAfter: '2026-03-01',
      paidBefore: '2026-03-31',
    });
    expect(path).toBe(
      '/api/v3.0/expense/reports?limit=100&user=jane.doe%40example.com&approvalStatusCode=A_PEND&paymentStatusCode=P_NOTP&countryCode=US' +
        '&createDateAfter=2026-01-01&createDateBefore=2026-01-31&submitDateAfter=2026-02-01&submitDateBefore=2026-02-28' +
        '&paidDateAfter=2026-03-01&paidDateBefore=2026-03-31',
    );
  });

  it('defaults user to ALL when no login ID is given', () => {
    expect(buildReportsPath({ countryCode: 'DE' })).toBe(
      '/api/v3.0/expense/reports?limit=100&user=ALL&countryCode=DE',
    );
  });

  it('trims values and uppercases the country code', () => {
    expect(buildReportsPath({ loginId: '  user1 ', countryCode: ' cn ' })).toBe(
      '/api/v3.0/expense/reports?limit=100&user=user1&countryCode=CN',
    );
  });

  it('omits empty filters', () => {
    expect(buildReportsPath({ loginId: 'user1', approvalStatusCode: '', submittedAfter: '' })).toBe(
      '/api/v3.0/expense/reports?limit=100&user=user1',
    );
  });

  it('throws when no criterion is provided', () => {
    expect(() => buildReportsPath({})).toThrow(/at least one/i);
    expect(() => buildReportsPath({ loginId: '  ' })).toThrow(/at least one/i);
  });
});

describe('searchReports', () => {
  it('fetches the first page and reports hasMore when NextPage is present', async () => {
    concurGet.mockResolvedValue({
      Items: [{ ID: 'r1', Name: 'Trip to Berlin' }],
      NextPage: 'https://us.api.concursolutions.com/api/v3.0/expense/reports?offset=100&limit=100&user=ALL',
    });

    const result = await searchReports({ countryCode: 'DE' });
    expect(concurGet).toHaveBeenCalledWith('/api/v3.0/expense/reports?limit=100&user=ALL&countryCode=DE');
    expect(result.reports).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('reports hasMore=false when there is no NextPage', async () => {
    concurGet.mockResolvedValue({ Items: [{ ID: 'r1' }], NextPage: null });
    const result = await searchReports({ loginId: 'user1' });
    expect(result.hasMore).toBe(false);
  });

  it('treats a missing Items array as empty', async () => {
    concurGet.mockResolvedValue({});
    const result = await searchReports({ loginId: 'user1' });
    expect(result.reports).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});

describe('fetchAllReports', () => {
  it('follows NextPage until exhausted, preserving the query string of absolute URIs', async () => {
    concurGet
      .mockResolvedValueOnce({
        Items: [{ ID: 'r1' }],
        NextPage: 'https://us.api.concursolutions.com/api/v3.0/expense/reports?offset=100&limit=100&user=ALL',
      })
      .mockResolvedValueOnce({ Items: [{ ID: 'r2' }], NextPage: null });

    const result = await fetchAllReports({ approvalStatusCode: 'A_APPR' });
    expect(concurGet).toHaveBeenNthCalledWith(1, '/api/v3.0/expense/reports?limit=100&user=ALL&approvalStatusCode=A_APPR');
    expect(concurGet).toHaveBeenNthCalledWith(2, '/api/v3.0/expense/reports?offset=100&limit=100&user=ALL');
    expect(result.reports.map((r) => r.ID)).toEqual(['r1', 'r2']);
    expect(result.hasMore).toBe(false);
  });

  it('caps the total page count as a safety valve', async () => {
    const page = (offset: number) => ({
      Items: [{ ID: `id-${offset}` }],
      NextPage: `https://x/api/v3.0/expense/reports?offset=${offset + PAGE_LIMIT}`,
    });
    let call = 0;
    concurGet.mockImplementation(() => Promise.resolve(page(call++ * PAGE_LIMIT)));

    const result = await fetchAllReports({ loginId: 'user1' });
    expect(result.reports.length).toBeLessThanOrEqual(100 * PAGE_LIMIT);
    expect(concurGet.mock.calls.length).toBeLessThanOrEqual(100);
  });
});

describe('buildEntriesPath', () => {
  it('builds the entries path with report ID and login ID', () => {
    expect(buildEntriesPath('REPORT123', 'jane.doe@example.com')).toBe(
      '/api/v3.0/expense/entries?limit=100&reportID=REPORT123&user=jane.doe%40example.com',
    );
  });

  it('omits the user parameter when no login ID is available', () => {
    expect(buildEntriesPath('REPORT123')).toBe(
      '/api/v3.0/expense/entries?limit=100&reportID=REPORT123',
    );
  });

  it('trims the report ID and rejects an empty one', () => {
    expect(buildEntriesPath('  R1  ', 'u')).toBe('/api/v3.0/expense/entries?limit=100&reportID=R1&user=u');
    expect(() => buildEntriesPath('  ')).toThrow(/report id/i);
  });
});

describe('fetchReportEntries', () => {
  it('fetches all pages following NextPage links', async () => {
    concurGet
      .mockResolvedValueOnce({
        Items: [{ ID: 'e1', ExpenseTypeName: 'Hotel' }],
        NextPage: 'https://us.api.concursolutions.com/api/v3.0/expense/entries?offset=100&limit=100&reportID=R1',
      })
      .mockResolvedValueOnce({ Items: [{ ID: 'e2', ExpenseTypeName: 'Meal' }], NextPage: null });

    const result = await fetchReportEntries('R1', 'user1');
    expect(concurGet).toHaveBeenNthCalledWith(1, '/api/v3.0/expense/entries?limit=100&reportID=R1&user=user1');
    expect(concurGet).toHaveBeenNthCalledWith(2, '/api/v3.0/expense/entries?offset=100&limit=100&reportID=R1');
    expect(result.entries.map((e) => e.ID)).toEqual(['e1', 'e2']);
    expect(result.hasMore).toBe(false);
  });

  it('treats a missing Items array as empty', async () => {
    concurGet.mockResolvedValue({});
    const result = await fetchReportEntries('R1', 'user1');
    expect(result.entries).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});
