import { entityRequestHeaders } from '../entities/entityStore';

/* Mirrors server/saeValidator.ts; src/ must not import server modules. */

export type SaeSeverity = 'error' | 'warning';

export interface SaeFinding {
  rule: string;
  severity: SaeSeverity;
  message: string;
  line?: number;
  sequence?: string;
  column?: number;
  columnName?: string;
  value?: string;
  reportId?: string;
}

export interface SaeRuleSummary {
  rule: string;
  title: string;
  severity: SaeSeverity;
  errors: number;
  warnings: number;
  findings: SaeFinding[];
}

export interface SaeFileResult {
  name: string;
  path: string;
  size: number;
  version: 'V2' | 'V3' | 'unknown';
  header: { batchDate?: string; recordCount?: string; journalTotal?: string; batchId?: string };
  batchId?: string;
  detailRows: number;
  reportCount: number;
  computedJournalTotal?: string;
  errors: number;
  warnings: number;
  rules: SaeRuleSummary[];
}

export interface SaeCrossFileFinding {
  rule: string;
  severity: SaeSeverity;
  title: string;
  message: string;
  files: string[];
}

export interface SaeCheckResponse {
  target: string;
  kind: 'file' | 'directory';
  checkedAt: string;
  files: SaeFileResult[];
  crossFile: SaeCrossFileFinding[];
  skipped: { name: string; reason: string }[];
}

/** Validate one SAE file or every `.txt` extract in a folder; blank uses the server default folder. */
export async function checkSaeFiles(path: string): Promise<SaeCheckResponse> {
  const response = await fetch('/api/local/sae/check', {
    method: 'POST',
    headers: { ...entityRequestHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error ?? `SAE check failed: HTTP ${response.status}`);
  }
  return response.json() as Promise<SaeCheckResponse>;
}
