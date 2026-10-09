import { concurGet } from './concurFetch';
import type { ReportFormField } from './reportFormFieldsApi';

/** Expense form metadata uses the v4 expense UUID, not the Entries v3 ID.
 * Bind the entity before token refresh, as with report header form fields. */
export async function fetchExpenseFormFields(reportId: string, expenseId: string, entityId: string, signal?: AbortSignal): Promise<ReportFormField[]> {
  const report = reportId.trim();
  const expense = expenseId.trim();
  if (!report) throw new Error('A report ID is required for expense form fields.');
  if (!expense) throw new Error('An expense ID is required for expense form fields.');
  const fields = await concurGet<unknown>(`/expensereports/v4/reports/${encodeURIComponent(report)}/expenses/${encodeURIComponent(expense)}/formFields`, {
    headers: { 'X-Concur-Entity': entityId }, signal,
  });
  if (!Array.isArray(fields) || fields.some(field => !field || typeof field !== 'object' || Array.isArray(field))) {
    throw new Error('Concur returned an invalid expense form-fields response.');
  }
  return fields;
}
