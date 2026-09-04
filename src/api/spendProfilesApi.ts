import type {
  ActiveUsersSummary,
  SpendFilterGroup,
  SpendProfileLocalDetail,
  SpendProfilesProgress,
  SpendProfilesQueryResult,
  SpendProfilesSummary,
} from '../types';
import { entityRequestHeaders } from '../entities/entityStore';

interface SummaryEnvelope {
  summary: SpendProfilesSummary | null;
  identitySummary: ActiveUsersSummary | null;
  error?: string;
}

async function jsonRequest<T>(path: string, options: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `${fallback}: HTTP ${response.status}`);
  return body;
}

export async function getSpendProfilesSummary(): Promise<SummaryEnvelope> {
  return jsonRequest('/api/local/spend-profiles/summary', { method: 'GET', headers: entityRequestHeaders() }, 'Spend Profile summary request failed');
}

export async function getSpendProfilesProgress(): Promise<SpendProfilesProgress> {
  const body = await jsonRequest<{ progress?: SpendProfilesProgress }>('/api/local/spend-profiles/progress', { method: 'GET', headers: entityRequestHeaders() }, 'Spend Profile progress request failed');
  if (!body.progress) throw new Error('The Spend Profile progress response was empty.');
  return body.progress;
}

async function startRetrieval(path: string): Promise<SpendProfilesProgress> {
  const body = await jsonRequest<{ progress?: SpendProfilesProgress }>(path, { method: 'POST', headers: entityRequestHeaders() }, 'Spend Profile retrieval request failed');
  if (!body.progress) throw new Error('The Spend Profile retrieval response was empty.');
  return body.progress;
}

export function refreshSpendProfilesSnapshot(): Promise<SpendProfilesProgress> {
  return startRetrieval('/api/local/spend-profiles/refresh');
}

export function resumeSpendProfilesSnapshot(): Promise<SpendProfilesProgress> {
  return startRetrieval('/api/local/spend-profiles/resume');
}

export function restartSpendProfilesSnapshot(): Promise<SpendProfilesProgress> {
  return startRetrieval('/api/local/spend-profiles/restart');
}

export async function querySpendProfilesLocal(options: {
  offset: number;
  limit?: number;
  filters: SpendFilterGroup;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  includeOrphans?: boolean;
}): Promise<SpendProfilesQueryResult | null> {
  const body = await jsonRequest<{ result: SpendProfilesQueryResult | null }>('/api/local/spend-profiles/query', {
    method: 'POST',
    headers: { ...entityRequestHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...options, limit: options.limit ?? 200 }),
  }, 'Spend Profile query failed');
  return body.result;
}

export async function getSpendProfileLocalDetail(userId: string): Promise<SpendProfileLocalDetail> {
  const body = await jsonRequest<{ detail?: SpendProfileLocalDetail }>(`/api/local/spend-profiles/detail/${encodeURIComponent(userId)}`, { method: 'GET', headers: entityRequestHeaders() }, 'Spend Profile detail request failed');
  if (!body.detail) throw new Error('The local Spend Profile detail response was empty.');
  return body.detail;
}

export async function downloadSpendProfilesCsv(options: {
  filters: SpendFilterGroup;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  columns: string[];
  includeOrphans?: boolean;
}): Promise<void> {
  const response = await fetch('/api/local/spend-profiles/export', {
    method: 'POST',
    headers: { ...entityRequestHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Spend Profile CSV export failed: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `concur-spend-profiles-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
