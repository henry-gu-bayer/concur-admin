import type {
  TravelRequestCustomFieldV4,
  TravelRequestDestinationV4,
  TravelRequestExpectedExpenseV4,
  TravelRequestMoneyV4,
  TravelRequestOwnerV4,
  TravelRequestV4,
} from '../types';

export interface TravelRequestDisplayField {
  label: string;
  value: string;
}

const LINK_KEYS = new Set(['href', 'url', 'uri', 'link', 'links', 'template', 'operations']);
const URI_VALUE_PATTERN = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/i;

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

function humanize(key: string): string {
  const label = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!label) return key;
  const titled = label.charAt(0).toUpperCase() + label.slice(1);
  return titled.replace(/\bUrl\b/g, 'URL').replace(/\bId\b/g, 'ID');
}

function scalarValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value).trim();
}

function moneyValue(value: TravelRequestMoneyV4 | null | undefined): string | null {
  if (value?.value == null) return null;
  const amount = value.value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return [amount, value.currency?.trim() || value.currencyCode?.trim()].filter(Boolean).join(' ');
}

function ownerValue(owner: TravelRequestOwnerV4 | null | undefined): string | null {
  if (!owner) return null;
  const name = owner.name?.trim()
    || [owner.firstName?.trim(), owner.lastName?.trim()].filter(Boolean).join(' ');
  const login = owner.loginId?.trim();
  return [name, login].filter(Boolean).join(' · ') || owner.id?.trim() || null;
}

function destinationValue(destination: TravelRequestDestinationV4 | string | null | undefined): string | null {
  if (typeof destination === 'string') return destination.trim() || null;
  if (!destination) return null;
  return [
    destination.name?.trim() || destination.city?.trim(),
    destination.countrySubDivisionCode?.trim(),
    destination.countryCode?.trim(),
  ].filter(Boolean).join(', ') || null;
}

/** Build the stable summary shown at the top of a Travel Request card. */
export function travelRequestSummary(request: TravelRequestV4): TravelRequestDisplayField[] {
  const dates = [request.startDate?.trim(), request.endDate?.trim()].filter(Boolean).join(' – ');
  const fields: Array<[string, string | null | undefined]> = [
    ['Name', request.name?.trim()],
    ['Request ID', request.requestId?.trim() || request.id?.trim()],
    ['Owner', ownerValue(request.owner)],
    ['Status', request.approvalStatus?.name?.trim() || request.status?.trim()
      || request.approvalStatus?.code?.trim() || request.statusCode?.trim()],
    ['Dates', dates],
    ['Destination', destinationValue(request.mainDestination ?? request.destination)],
    ['Purpose', request.businessPurpose?.trim() || request.purpose?.trim()],
    ['Requested amount', moneyValue(request.totalRequestedAmount)],
    ['Approved amount', moneyValue(request.totalApprovedAmount)],
    ['Posted amount', moneyValue(request.totalPostedAmount)],
    ['Remaining amount', moneyValue(request.totalRemainingAmount)],
  ];
  return fields
    .filter((field): field is [string, string] => Boolean(field[1]))
    .map(([label, value]) => ({ label, value }));
}

function isLinkKey(key: string): boolean {
  return LINK_KEYS.has(key.toLowerCase());
}

function isUriValue(value: string): boolean {
  return URI_VALUE_PATTERN.test(value.trim());
}

function flatten(value: unknown, path: string[], result: TravelRequestDisplayField[]): void {
  if (isEmpty(value)) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const formatted = scalarValue(value);
    if (!formatted || (typeof value === 'string' && isUriValue(formatted))) return;
    result.push({ label: path.join(' › '), value: formatted });
    return;
  }
  if (Array.isArray(value)) {
    const arrayLabel = path[path.length - 1];
    value.forEach((item, index) => flatten(item, [...path.slice(0, -1), `${arrayLabel} [${index + 1}]`], result));
    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      if (!isLinkKey(key)) flatten(child, [...path, humanize(key)], result);
    });
  }
}

function sortedFields(value: unknown): TravelRequestDisplayField[] {
  const result: TravelRequestDisplayField[] = [];
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      if (!isLinkKey(key)) flatten(child, [humanize(key)], result);
    });
  }
  return result.sort((a, b) => a.label.localeCompare(b.label));
}

/** Flatten populated ordinary request data, excluding links and separately rendered sections. */
export function travelRequestAllFields(request: TravelRequestV4): TravelRequestDisplayField[] {
  const ordinaryEntries = Object.fromEntries(Object.entries(request).filter(([key]) => (
    !['expenses', 'customdata', 'customfields'].includes(key.toLowerCase())
    && !/^custom\d+$/i.test(key)
  )));
  return sortedFields(ordinaryEntries);
}

function customFieldValue(field: TravelRequestCustomFieldV4): string | null {
  const value = typeof field.value === 'string'
    || typeof field.value === 'number'
    || typeof field.value === 'boolean'
    ? scalarValue(field.value)
    : '';
  const displayValue = typeof field.value === 'string' && isUriValue(value) ? '' : value;
  const code = field.code?.trim() ?? '';
  const displayCode = isUriValue(code) ? '' : code;
  if (displayValue && displayCode) return `${displayValue} (${displayCode})`;
  return displayValue || displayCode || null;
}

/** Extract populated top-level and array-backed custom fields without metadata. */
export function travelRequestCustomFields(request: TravelRequestV4): TravelRequestDisplayField[] {
  const result: TravelRequestDisplayField[] = [];
  Object.entries(request).forEach(([key, value]) => {
    if (!/^custom\d+$/i.test(key) || value === null || typeof value !== 'object' || Array.isArray(value)) return;
    const formatted = customFieldValue(value as TravelRequestCustomFieldV4);
    if (formatted) result.push({ label: humanize(key), value: formatted });
  });

  const arrayFields = [
    ...(request.customData ?? []),
    ...(request.customFields ?? []),
  ];
  arrayFields.forEach((field, index) => {
    const formatted = customFieldValue(field);
    if (!formatted) return;
    const label = field.id?.trim() || field.name?.trim() || field.label?.trim() || `Custom ${index + 1}`;
    result.push({ label, value: formatted });
  });
  return result;
}

/** Return unique expected-expense links in API order. */
export function travelRequestExpenseReferences(
  request: TravelRequestV4,
): Array<{ id: string; href: string }> {
  const seen = new Set<string>();
  const result: Array<{ id: string; href: string }> = [];
  (request.expenses ?? []).forEach((expense, index) => {
    const href = expense.href?.trim();
    if (!href || seen.has(href)) return;
    seen.add(href);
    result.push({ id: expense.id?.trim() || `Expected expense ${index + 1}`, href });
  });
  return result;
}

/** Flatten populated expected-expense data while excluding links and URL values. */
export function expectedExpenseFields(
  expense: TravelRequestExpectedExpenseV4,
): TravelRequestDisplayField[] {
  return sortedFields(expense);
}

/**
 * Temporary compatibility for the current report detail view. Link values are
 * filtered even though that view still checks the former optional property.
 */
export function flattenTravelRequestFields(
  request: TravelRequestV4,
): Array<TravelRequestDisplayField & { url?: undefined }> {
  return travelRequestAllFields(request);
}
