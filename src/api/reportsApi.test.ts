import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildEntriesPath,
  buildReportsPath,
  fetchAllReports,
  fetchExpenseCommentsV4,
  fetchExpenseAttendeeAssociationsV4,
  fetchAttendeesV4ByIds,
  fetchExpenseAttendeesV4,
  fetchExpenseExceptionsV4,
  fetchReportById,
  fetchReportCommentsV4,
  fetchReportExceptionsV4,
  fetchReportExpensesV4,
  fetchReportV4,
  fetchReportEntries,
  resolveIdentityUserIdV4,
  resolveReportOwnerLoginId,
  searchReports,
  PAGE_LIMIT,
} from './reportsApi';

const { concurGet, concurFetch } = vi.hoisted(() => ({
  concurGet: vi.fn(),
  concurFetch: vi.fn(),
}));

vi.mock('./concurFetch', () => ({ concurGet, concurFetch }));

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

  it('adds the expense type and boolean image/attendee filters', () => {
    expect(buildReportsPath({
      loginId: 'user1',
      expenseTypeCode: ' AIRFR ',
      hasImages: true,
      hasAttendees: false,
    })).toBe(
      '/api/v3.0/expense/reports?limit=100&user=user1&expenseTypeCode=AIRFR&hasImages=true&hasAttendees=false',
    );
  });

  it('treats each new filter as a valid standalone criterion', () => {
    expect(buildReportsPath({ hasImages: false })).toBe(
      '/api/v3.0/expense/reports?limit=100&user=ALL&hasImages=false',
    );
    expect(buildReportsPath({ hasAttendees: true })).toBe(
      '/api/v3.0/expense/reports?limit=100&user=ALL&hasAttendees=true',
    );
    expect(buildReportsPath({ expenseTypeCode: 'TAXIC' })).toBe(
      '/api/v3.0/expense/reports?limit=100&user=ALL&expenseTypeCode=TAXIC',
    );
  });

  it('throws when no criterion is provided', () => {
    expect(() => buildReportsPath({})).toThrow(/at least one/i);
    expect(() => buildReportsPath({ loginId: '  ' })).toThrow(/at least one/i);
    expect(() => buildReportsPath({ expenseTypeCode: '  ' })).toThrow(/at least one/i);
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

describe('fetchReportById', () => {
  it('requests the report resource with the owner login ID as user, trimming and encoding the ID', async () => {
    concurGet.mockResolvedValue({ ID: 'rpt-1', Name: 'Berlin trip' });

    const report = await fetchReportById('  rpt/1  ', ' jane.doe@example.com ');
    expect(concurGet).toHaveBeenCalledWith('/api/v3.0/expense/reports/rpt%2F1?user=jane.doe%40example.com');
    expect(report.ID).toBe('rpt-1');
  });

  it('rejects an empty report ID without calling the API', async () => {
    await expect(fetchReportById('   ', 'user1')).rejects.toThrow(/report id/i);
    expect(concurGet).not.toHaveBeenCalled();
  });

  it('requires the owner login ID without calling the API', async () => {
    await expect(fetchReportById('rpt-1', '   ')).rejects.toThrow(/login id/i);
    expect(concurGet).not.toHaveBeenCalled();
  });

  it('throws the ReportsExceptionStatus message returned with HTTP 200', async () => {
    concurGet.mockResolvedValue({ Error: { Message: 'No report found with the specified ID' } });
    await expect(fetchReportById('bad-id', 'user1')).rejects.toThrow(/no report found/i);
  });

  it('falls back to a generic message when the Error payload has no message', async () => {
    concurGet.mockResolvedValue({ Error: {} });
    await expect(fetchReportById('bad-id', 'user1')).rejects.toThrow(/error/i);
  });
});

const SAMPLE_V2_XML = `<?xml version="1.0"?>
<ReportDetails xmlns="http://www.concursolutions.com/api/expense/expensereport/2012/07">
  <UserLoginID>admin-GERAP_EU@bayer.com</UserLoginID>
  <ReportID>A936F95349584D38B4B1</ReportID>
</ReportDetails>`;

describe('resolveReportOwnerLoginId', () => {
  it('calls Report v2 and returns UserLoginID from XML', async () => {
    concurFetch.mockResolvedValue(new Response(SAMPLE_V2_XML, { status: 200 }));

    await expect(resolveReportOwnerLoginId('  A936F95349584D38B4B1  '))
      .resolves.toBe('admin-GERAP_EU@bayer.com');

    expect(concurFetch).toHaveBeenCalledWith(
      '/api/expense/expensereport/v2.0/report/A936F95349584D38B4B1',
      expect.objectContaining({ headers: expect.anything() }),
    );
    const init = concurFetch.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Accept')).toMatch(/xml/i);
  });

  it('rejects an empty report ID without calling the API', async () => {
    await expect(resolveReportOwnerLoginId('   ')).rejects.toThrow(/report id/i);
    expect(concurFetch).not.toHaveBeenCalled();
  });

  it('throws on HTTP non-OK', async () => {
    concurFetch.mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(resolveReportOwnerLoginId('missing')).rejects.toThrow(/404|not found|report/i);
  });

  it('throws when UserLoginID is missing', async () => {
    concurFetch.mockResolvedValue(new Response('<ReportDetails></ReportDetails>', { status: 200 }));
    await expect(resolveReportOwnerLoginId('rpt-1')).rejects.toThrow(/login id|UserLoginID/i);
  });
});

describe('Reports v4 enrichment', () => {
  it('resolves the owner UUID through Identity v4 and retrieves the report with TRAVELER context', async () => {
    concurGet
      .mockResolvedValueOnce({
        totalResults: 1,
        Resources: [{ id: 'user/uuid', userName: 'jane.doe@example.com' }],
      })
      .mockResolvedValueOnce({ reportId: 'rpt/1', businessPurpose: 'Customer meeting' });

    await expect(fetchReportV4(' rpt/1 ', ' jane.doe@example.com ')).resolves.toEqual({
      userId: 'user/uuid',
      report: { reportId: 'rpt/1', businessPurpose: 'Customer meeting' },
    });

    expect(concurGet).toHaveBeenNthCalledWith(
      1,
      '/profile/identity/v4/Users?filter=userName+eq+%22jane.doe%40example.com%22&attributes=id%2CuserName&count=2',
    );
    expect(concurGet).toHaveBeenNthCalledWith(
      2,
      '/expensereports/v4/users/user%2Fuuid/context/TRAVELER/reports/rpt%2F1',
    );
  });

  it('requires an exact or unambiguous Identity v4 result', async () => {
    concurGet.mockResolvedValue({ totalResults: 0, Resources: [] });
    await expect(resolveIdentityUserIdV4('missing@example.com')).rejects.toThrow(/did not return a user id/i);
  });

  it('validates Reports v4 inputs before making requests', async () => {
    await expect(fetchReportV4('  ', 'user@example.com')).rejects.toThrow(/report id/i);
    await expect(resolveIdentityUserIdV4('  ')).rejects.toThrow(/login id/i);
    expect(concurGet).not.toHaveBeenCalled();
  });
});

describe('Exceptions v4', () => {
  it('retrieves report-header exceptions with TRAVELER context and excludes expense exceptions', async () => {
    const exceptions = [{ exceptionCode: 'ITEMDIFF', isBlocking: true, message: 'Report totals differ' }];
    concurGet.mockResolvedValue(exceptions);

    await expect(fetchReportExceptionsV4(' rpt/1 ', ' user/uuid ')).resolves.toEqual(exceptions);
    expect(concurGet).toHaveBeenCalledWith(
      '/expensereports/v4/users/user%2Fuuid/context/TRAVELER/reports/rpt%2F1/exceptions?excludeExpenses=true',
    );
  });

  it('validates exception request inputs before making a request', async () => {
    await expect(fetchReportExceptionsV4(' ', 'user-id')).rejects.toThrow(/report id/i);
    await expect(fetchReportExceptionsV4('report-id', ' ')).rejects.toThrow(/user id/i);
    expect(concurGet).not.toHaveBeenCalled();
  });
});

describe('Comments v4', () => {
  it('retrieves report-header comments through the system-user endpoint', async () => {
    const comments = [{ comment: 'Reviewed by Finance', isLatest: true }];
    concurGet.mockResolvedValue(comments);

    await expect(fetchReportCommentsV4(' rpt/1 ')).resolves.toEqual(comments);
    expect(concurGet).toHaveBeenCalledWith(
      '/expensereports/v4/reports/rpt%2F1/comments?includeAllComments=false',
    );
  });

  it('validates the report ID before making a comments request', async () => {
    await expect(fetchReportCommentsV4(' ')).rejects.toThrow(/report id/i);
    expect(concurGet).not.toHaveBeenCalled();
  });
});

describe('Expenses v4', () => {
  it('retrieves all expenses for a report with TRAVELER context', async () => {
    const expenses = [{ expenseId: 'exp-1', vendorDescription: 'Hotel' }];
    concurGet.mockResolvedValue(expenses);

    await expect(fetchReportExpensesV4(' rpt/1 ', ' user/uuid ')).resolves.toEqual(expenses);
    expect(concurGet).toHaveBeenCalledWith(
      '/expensereports/v4/users/user%2Fuuid/context/TRAVELER/reports/rpt%2F1/expenses',
    );
  });

  it('normalizes a wrapped expenses payload to an array', async () => {
    concurGet.mockResolvedValue({ expenses: [{ expenseId: 'exp-1' }] });
    await expect(fetchReportExpensesV4('rpt-1', 'user-1')).resolves.toEqual([{ expenseId: 'exp-1' }]);
    concurGet.mockResolvedValue({ Items: [{ expenseId: 'exp-2' }] });
    await expect(fetchReportExpensesV4('rpt-1', 'user-1')).resolves.toEqual([{ expenseId: 'exp-2' }]);
  });

  it('validates expense request inputs before making a request', async () => {
    await expect(fetchReportExpensesV4(' ', 'user-1')).rejects.toThrow(/report id/i);
    await expect(fetchReportExpensesV4('report-id', ' ')).rejects.toThrow(/user id/i);
    expect(concurGet).not.toHaveBeenCalled();
  });
});

describe('Expense Exceptions v4', () => {
  it('retrieves expense-level exceptions through the system-user endpoint', async () => {
    const exceptions = [{ exceptionCode: 'MISSINGRECEIPT', expenseId: 'exp-1', isBlocking: false }];
    concurGet.mockResolvedValue(exceptions);

    await expect(fetchExpenseExceptionsV4(' rpt/1 ', ' exp/1 ')).resolves.toEqual(exceptions);
    expect(concurGet).toHaveBeenCalledWith(
      '/expensereports/v4/reports/rpt%2F1/exceptions?expenseId=exp%2F1',
    );
  });

  it('validates inputs before making a request', async () => {
    await expect(fetchExpenseExceptionsV4(' ', 'exp-1')).rejects.toThrow(/report id/i);
    await expect(fetchExpenseExceptionsV4('rpt-1', ' ')).rejects.toThrow(/expense id/i);
    expect(concurGet).not.toHaveBeenCalled();
  });
});

describe('Expense Comments v4', () => {
  it('retrieves expense-level comments through the system-user endpoint', async () => {
    const comments = [{ comment: 'Taxi fare', expenseId: 'exp-1', isLatest: true }];
    concurGet.mockResolvedValue(comments);

    await expect(fetchExpenseCommentsV4(' rpt/1 ', ' exp/1 ')).resolves.toEqual(comments);
    expect(concurGet).toHaveBeenCalledWith(
      '/expensereports/v4/reports/rpt%2F1/comments?expenseId=exp%2F1&includeAllComments=true',
    );
  });

  it('validates inputs before making a request', async () => {
    await expect(fetchExpenseCommentsV4(' ', 'exp-1')).rejects.toThrow(/report id/i);
    await expect(fetchExpenseCommentsV4('rpt-1', ' ')).rejects.toThrow(/expense id/i);
    expect(concurGet).not.toHaveBeenCalled();
  });
});

describe('Expense Attendees v4', () => {
  it('retrieves expense attendee associations through the system-user endpoint', async () => {
    const response = { noShowAttendeeCount: 1, expenseAttendeeList: [{ attendeeId: 'attendee/1' }] };
    concurGet.mockResolvedValue(response);

    await expect(fetchExpenseAttendeeAssociationsV4(' rpt/1 ', ' exp/1 ')).resolves.toEqual(response);
    expect(concurGet).toHaveBeenCalledWith(
      '/expensereports/v4/reports/rpt%2F1/expenses/exp%2F1/attendees',
    );
  });

  it('validates association inputs before making a request', async () => {
    await expect(fetchExpenseAttendeeAssociationsV4(' ', 'exp-1')).rejects.toThrow(/report id/i);
    await expect(fetchExpenseAttendeeAssociationsV4('rpt-1', ' ')).rejects.toThrow(/expense id/i);
    expect(concurGet).not.toHaveBeenCalled();
  });

  it('retrieves attendee details in parallel batches of at most 10 unique IDs', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `attendee-${index + 1}`);
    concurGet
      .mockResolvedValueOnce({ items: ids.slice(0, 10).map((id) => ({ id })) })
      .mockResolvedValueOnce({ Items: ids.slice(10).map((id) => ({ id })) });

    await expect(fetchAttendeesV4ByIds([...ids, ids[0], ' '])).resolves.toHaveLength(12);
    expect(concurGet).toHaveBeenCalledTimes(2);
    expect(concurGet).toHaveBeenNthCalledWith(1, `/v4/attendees?id=${ids.slice(0, 10).join('%2C')}`);
    expect(concurGet).toHaveBeenNthCalledWith(2, `/v4/attendees?id=${ids.slice(10).join('%2C')}`);
  });

  it('joins associations to attendee details while preserving missing attendee IDs', async () => {
    concurGet
      .mockResolvedValueOnce({
        noShowAttendeeCount: 2,
        expenseAttendeeList: [{ attendeeId: 'attendee-1', isTraveling: true }, { attendeeId: 'attendee-2' }],
      })
      .mockResolvedValueOnce({ items: [{ id: 'attendee-1', firstName: 'Jane', lastName: 'Doe' }] });

    await expect(fetchExpenseAttendeesV4('rpt-1', 'exp-1')).resolves.toEqual({
      noShowAttendeeCount: 2,
      attendees: [
        { id: 'attendee-1', firstName: 'Jane', lastName: 'Doe', association: { attendeeId: 'attendee-1', isTraveling: true } },
        { id: 'attendee-2', association: { attendeeId: 'attendee-2' } },
      ],
    });
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
