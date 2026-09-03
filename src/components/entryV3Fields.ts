import type { ExpenseEntry } from '../types';

export interface EntryV3RawField {
  key: string;
  value: string;
}

const TRANSPORT_KEYS = new Set(['URI', 'Links', 'links']);

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Produces a complete payload-oriented view of one Entries v3 record. Unlike
 * the friendly grouped fields, raw API names and duplicate values are retained
 * so administrators can confirm exactly which populated properties arrived.
 */
export function entryV3RawFields(entry: ExpenseEntry): EntryV3RawField[] {
  return Object.entries(entry as unknown as Record<string, unknown>)
    .flatMap(([key, value]) => {
      if (TRANSPORT_KEYS.has(key) || !hasValue(value)) return [];
      return [{ key, value: formatValue(value) }];
    })
    .sort((left, right) => left.key.localeCompare(right.key, undefined, { sensitivity: 'base' }));
}
