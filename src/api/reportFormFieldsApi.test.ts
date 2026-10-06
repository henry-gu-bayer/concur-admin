import { beforeEach, describe, expect, it, vi } from 'vitest';
import { concurGet } from './concurFetch';
import { fetchLinkedReportValue, fetchReportFormFields } from './reportFormFieldsApi';

vi.mock('./concurFetch', () => ({ concurGet: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe('report form fields API', () => {
  it('uses the report ID and captured entity via the authenticated proxy', async () => {
    const fields = [{ fieldId: 'Name', isRequired: false, maximumLength: 0, futureAttribute: { value: 'kept' } }];
    vi.mocked(concurGet).mockResolvedValue(fields);
    const signal = new AbortController().signal;
    expect(await fetchReportFormFields(' report/id ', 'eu-uat', signal)).toEqual(fields);
    expect(concurGet).toHaveBeenCalledWith('/expensereports/v4/reports/report%2Fid/formFields', { headers: { 'X-Concur-Entity': 'eu-uat' }, signal });
  });
  it('uses the report policy by default and rejects missing report IDs', async () => {
    vi.mocked(concurGet).mockResolvedValue([]);
    await fetchReportFormFields('rpt-1', 'us-uat');
    expect(concurGet).toHaveBeenCalledWith('/expensereports/v4/reports/rpt-1/formFields', expect.any(Object));
    await expect(fetchReportFormFields(' ', 'us-uat')).rejects.toThrow('report ID');
    expect(concurGet).toHaveBeenCalledTimes(1);
  });
  it.each([{}, null, [null], ['invalid']])('reports invalid payload %j', async payload => {
    vi.mocked(concurGet).mockResolvedValue(payload);
    await expect(fetchReportFormFields('rpt-1', 'us-uat')).rejects.toThrow('invalid');
  });
});

describe('linked report value', () => {
  it('retains the link query and entity while reading the list item value', async () => {
    vi.mocked(concurGet).mockResolvedValue([{ value: 'Operations – Boston' }]);
    const signal = new AbortController().signal;
    expect(await fetchLinkedReportValue('https://us.api.concursolutions.com/list/v4/items?id=item-1', 'us-uat', signal)).toBe('Operations – Boston');
    expect(concurGet).toHaveBeenCalledWith('/list/v4/items?id=item-1', { headers: { 'X-Concur-Entity': 'us-uat' }, signal });
  });
  it('rejects links outside the Concur API and a response without a display value', async () => {
    await expect(fetchLinkedReportValue('https://example.com/value', 'us-uat')).rejects.toThrow('Concur API');
    expect(concurGet).not.toHaveBeenCalled();
    vi.mocked(concurGet).mockResolvedValue({ id: 'item-1' });
    await expect(fetchLinkedReportValue('https://us.api.concursolutions.com/list/v4/items/item-1', 'us-uat')).rejects.toThrow('display value');
  });
});
