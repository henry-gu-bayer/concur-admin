import type {
  ActiveUsersSummary,
  SpendFilterGroup,
  SpendProfileLocalDetail,
  SpendProfilesBrowseProgress,
  SpendProfilesProgress,
  SpendProfilesQueryResult,
  SpendProfilesSummary,
} from '../types';
import { entityRequestHeaders } from '../entities/entityStore';

interface TravelSummaryResponse {
  summary: (Omit<SpendProfilesSummary, 'spendFields'> & { travelFields: string[] }) | null;
  identitySummary: ActiveUsersSummary | null;
}

async function jsonRequest<T>(path: string, options: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `${fallback}: HTTP ${response.status}`);
  return body;
}

function travelSummary(summary: TravelSummaryResponse['summary']): SpendProfilesSummary | null {
  return summary ? { ...summary, spendFields: summary.travelFields } : null;
}

function travelProgress(progress: SpendProfilesProgress & { travelFields?: string[] }): SpendProfilesProgress {
  return { ...progress, spendFields: progress.travelFields ?? progress.spendFields ?? [] };
}

export async function getTravelProfilesSummary(): Promise<{ summary: SpendProfilesSummary | null; identitySummary: ActiveUsersSummary | null }> {
  const response = await jsonRequest<TravelSummaryResponse>('/api/local/travel-profiles/summary', { method: 'GET', headers: entityRequestHeaders() }, 'Travel Profile summary request failed');
  return { summary: travelSummary(response.summary), identitySummary: response.identitySummary };
}

export async function getTravelProfilesProgress(): Promise<SpendProfilesProgress> {
  const body = await jsonRequest<{ progress?: SpendProfilesProgress & { travelFields?: string[] } }>('/api/local/travel-profiles/progress', { method: 'GET', headers: entityRequestHeaders() }, 'Travel Profile progress request failed');
  if (!body.progress) throw new Error('The Travel Profile progress response was empty.');
  return travelProgress(body.progress);
}

export async function getTravelProfilesBrowseProgress(): Promise<SpendProfilesBrowseProgress> {
  return { state: 'complete', sourceGeneration: 'travel-profiles', phase: 'complete', percent: 100 };
}

export async function resumeTravelProfilesBrowseIndex(): Promise<SpendProfilesBrowseProgress> {
  return { state: 'complete', sourceGeneration: 'travel-profiles', phase: 'complete', percent: 100 };
}

async function startRetrieval(path: string): Promise<SpendProfilesProgress> {
  const body = await jsonRequest<{ progress?: SpendProfilesProgress & { travelFields?: string[] } }>(path, { method: 'POST', headers: entityRequestHeaders() }, 'Travel Profile retrieval request failed');
  if (!body.progress) throw new Error('The Travel Profile retrieval response was empty.');
  return travelProgress(body.progress);
}

export function refreshTravelProfilesSnapshot(): Promise<SpendProfilesProgress> { return startRetrieval('/api/local/travel-profiles/refresh'); }
export function resumeTravelProfilesSnapshot(): Promise<SpendProfilesProgress> { return startRetrieval('/api/local/travel-profiles/resume'); }
export function restartTravelProfilesSnapshot(): Promise<SpendProfilesProgress> { return startRetrieval('/api/local/travel-profiles/restart'); }

export async function queryTravelProfilesLocal(options: {
  offset: number;
  limit?: number;
  filters: SpendFilterGroup;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  includeOrphans?: boolean;
  source?: 'latest' | 'complete';
}): Promise<SpendProfilesQueryResult | null> {
  const body = await jsonRequest<{ result: SpendProfilesQueryResult | null }>('/api/local/travel-profiles/query', {
    method: 'POST', headers: { ...entityRequestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...options, limit: options.limit ?? 200 }),
  }, 'Travel Profile query failed');
  return body.result;
}

export async function getTravelProfileLocalDetail(userId: string, source: 'latest' | 'complete' = 'latest'): Promise<SpendProfileLocalDetail> {
  const body = await jsonRequest<{ detail?: SpendProfileLocalDetail }>(`/api/local/travel-profiles/detail/${encodeURIComponent(userId)}?source=${source}`, { method: 'GET', headers: entityRequestHeaders() }, 'Travel Profile detail request failed');
  if (!body.detail) throw new Error('The local Travel Profile detail response was empty.');
  return body.detail;
}

export async function downloadTravelProfilesCsv(options: { filters: SpendFilterGroup; sortBy: string; sortDir: 'asc' | 'desc'; columns: string[]; includeOrphans?: boolean; source?: 'latest' | 'complete' }): Promise<void> {
  const response = await fetch('/api/local/travel-profiles/export', { method: 'POST', headers: { ...entityRequestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(options) });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error ?? `Travel Profile CSV export failed: HTTP ${response.status}`); }
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `concur-travel-profiles-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`; link.click(); URL.revokeObjectURL(url);
}
