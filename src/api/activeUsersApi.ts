import type { ActiveUserSortKey, ActiveUsersLocalResult, ActiveUsersProgress, ActiveUsersSnapshot, ActiveUsersSummary, SpendFilterGroup } from '../types';
import { entityRequestHeaders } from '../entities/entityStore';

interface ActiveUsersEnvelope {
  snapshot: ActiveUsersSnapshot | null;
  error?: string;
}

interface ActiveUsersProgressEnvelope {
  progress?: ActiveUsersProgress;
  error?: string;
}

interface ActiveUsersSummaryEnvelope {
  summary: ActiveUsersSummary | null;
  error?: string;
}

interface ActiveUsersQueryEnvelope {
  result: ActiveUsersLocalResult | null;
  error?: string;
}

async function request(path: string, method: 'GET' | 'POST'): Promise<ActiveUsersSnapshot | null> {
  const response = await fetch(path, { method, headers: entityRequestHeaders() });
  const body = await response.json().catch(() => ({})) as ActiveUsersEnvelope;
  if (!response.ok) throw new Error(body.error ?? `Active user snapshot request failed: HTTP ${response.status}`);
  return body.snapshot;
}

export function getActiveUsersSnapshot(): Promise<ActiveUsersSnapshot | null> {
  return request('/api/local/users', 'GET');
}

async function startRetrieval(path: string): Promise<ActiveUsersProgress> {
  const response = await fetch(path, { method: 'POST', headers: entityRequestHeaders() });
  const body = await response.json().catch(() => ({})) as { progress?: ActiveUsersProgress; error?: string };
  if (!response.ok) throw new Error(body.error ?? `Active user retrieval request failed: HTTP ${response.status}`);
  if (!body.progress) throw new Error('The active user retrieval response was empty.');
  return body.progress;
}

export function refreshActiveUsersSnapshot(): Promise<ActiveUsersProgress> {
  return startRetrieval('/api/local/users/refresh');
}

export function resumeActiveUsersSnapshot(): Promise<ActiveUsersProgress> {
  return startRetrieval('/api/local/users/resume');
}

export function restartActiveUsersSnapshot(): Promise<ActiveUsersProgress> {
  return startRetrieval('/api/local/users/restart');
}

export async function getActiveUsersProgress(): Promise<ActiveUsersProgress> {
  const response = await fetch('/api/local/users/progress', { method: 'GET', headers: entityRequestHeaders() });
  const body = await response.json().catch(() => ({})) as ActiveUsersProgressEnvelope;
  if (!response.ok) throw new Error(body.error ?? `Active user progress request failed: HTTP ${response.status}`);
  if (!body.progress) throw new Error('The active user progress response was empty.');
  return body.progress;
}

export async function getActiveUsersSummary(): Promise<ActiveUsersSummary | null> {
  const response = await fetch('/api/local/users/summary', { method: 'GET', headers: entityRequestHeaders() });
  const body = await response.json().catch(() => ({})) as ActiveUsersSummaryEnvelope;
  if (!response.ok) throw new Error(body.error ?? `Active user summary request failed: HTTP ${response.status}`);
  return body.summary;
}

export async function queryActiveUsersLocal(options: {
  offset: number;
  limit?: number;
  q?: string;
  filters?: SpendFilterGroup;
  sortBy: ActiveUserSortKey;
  sortDir: 'asc' | 'desc';
}): Promise<ActiveUsersLocalResult | null> {
  const response = await fetch('/api/local/users/query', {
    method: 'POST',
    headers: { ...entityRequestHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...options, limit: options.limit ?? 200 }),
  });
  const body = await response.json().catch(() => ({})) as ActiveUsersQueryEnvelope;
  if (!response.ok) throw new Error(body.error ?? `Active user query failed: HTTP ${response.status}`);
  return body.result;
}

export async function downloadActiveUsersCsv(options: { q?: string; filters?: SpendFilterGroup; sortBy: ActiveUserSortKey; sortDir: 'asc' | 'desc'; columns?: string[] }): Promise<void> {
  const response = await fetch('/api/local/users/export', {
    method: 'POST',
    headers: { ...entityRequestHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Active user CSV export failed: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `concur-user-profiles-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
