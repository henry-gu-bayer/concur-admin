import { entityRequestHeaders } from '../entities/entityStore';

export interface ApiLogFile {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface ApiLogEntry {
  requestDateTime?: string;
  method?: string;
  url?: string;
  responseStatus?: number;
  responseTimeMs?: number;
  correlationId?: string | null;
  responseBody?: unknown;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: entityRequestHeaders(), cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load API logs: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function getLogFiles(): Promise<ApiLogFile[]> {
  return (await getJson<{ files: ApiLogFile[] }>('/api/local/api-logs')).files;
}

export async function getLogEntries(name: string): Promise<ApiLogEntry[]> {
  return (await getJson<{ entries: ApiLogEntry[] }>(`/api/local/api-logs/${encodeURIComponent(name)}`)).entries;
}
