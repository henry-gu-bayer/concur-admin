import { beforeEach, describe, expect, it, vi } from 'vitest';
import { concurGet } from './concurFetch';
import { fetchExpenseFormFields } from './expenseFormFieldsApi';

vi.mock('./concurFetch', () => ({ concurGet: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe('expense form fields API', () => {
  it('uses the report ID, expense UUID, and selected entity through the authenticated proxy', async () => {
    const fields = [{ fieldId: 'ExpName', futureAttribute: { value: 'kept' } }];
    vi.mocked(concurGet).mockResolvedValue(fields);
    const signal = new AbortController().signal;
    expect(await fetchExpenseFormFields(' report/id ', ' expense/id ', 'eu-uat', signal)).toEqual(fields);
    expect(concurGet).toHaveBeenCalledWith('/expensereports/v4/reports/report%2Fid/expenses/expense%2Fid/formFields', { headers: { 'X-Concur-Entity': 'eu-uat' }, signal });
  });

  it.each([[' ', 'expense-id'], ['report-id', ' ']])('rejects missing IDs', async (reportId, expenseId) => {
    await expect(fetchExpenseFormFields(reportId, expenseId, 'us-uat')).rejects.toThrow(/ID is required/);
    expect(concurGet).not.toHaveBeenCalled();
  });

  it.each([{}, null, [null], ['invalid']])('rejects invalid response %j', async payload => {
    vi.mocked(concurGet).mockResolvedValue(payload);
    await expect(fetchExpenseFormFields('rpt-1', 'exp-1', 'us-uat')).rejects.toThrow('invalid');
  });
});
