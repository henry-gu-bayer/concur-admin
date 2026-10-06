import { concurGet } from './concurFetch';

/** The API may add attributes; preserve them so the inspector can show every
 * non-null value instead of silently dropping fields outside a fixed schema. */
export interface ReportFormField extends Record<string, unknown> {
  fieldId?: string | null;
  formFieldId?: string | null;
  fieldName?: string | null;
  fieldSequence?: number | null;
  controlType?: string | null;
  dataType?: string | null;
  fieldAccess?: string | null;
  isRequired?: boolean | null;
  maximumLength?: number | null;
}

/** Reports v4 expects the report ID, not the form/form-field ID. Explicitly
 * bind the entity before token refresh, so switching entities cannot reroute it.
 * Omit the optional policy override: v3 PolicyID is not a valid v4 policy ID. */
export async function fetchReportFormFields(reportId: string, entityId: string, signal?: AbortSignal): Promise<ReportFormField[]> {
  const id = reportId.trim();
  if (!id) throw new Error('A report ID is required for header form fields.');
  const fields = await concurGet<unknown>(`/expensereports/v4/reports/${encodeURIComponent(id)}/formFields`, {
    headers: { 'X-Concur-Entity': entityId }, signal,
  });
  if (!Array.isArray(fields) || fields.some(field => !field || typeof field !== 'object' || Array.isArray(field))) {
    throw new Error('Concur returned an invalid header form-fields response.');
  }
  return fields;
}

/** Follow only Concur API resource URLs supplied by a report value. Preserve
 * the query string when passing the path through the existing logged proxy. */
export async function fetchLinkedReportValue(href: string, entityId: string, signal?: AbortSignal): Promise<string> {
  const url = new URL(href);
  if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*api\.concursolutions\.com$/i.test(url.hostname)) {
    throw new Error('The linked value does not point to a Concur API resource.');
  }
  const resource = await concurGet<unknown>(`${url.pathname}${url.search}`, { headers: { 'X-Concur-Entity': entityId }, signal });
  const single = Array.isArray(resource) && resource.length === 1 ? resource[0] : resource;
  if (single && typeof single === 'object' && !Array.isArray(single)) {
    const item = single as Record<string, unknown>;
    const value = item.value ?? item.name ?? item.displayName;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  throw new Error('The linked resource did not return a display value.');
}
