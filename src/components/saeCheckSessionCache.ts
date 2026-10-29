import type { SaeCheckResponse } from '../api/saeCheckApi';
import { createEntitySessionCache } from '../state/entitySessionCache';

/** Keeps the last check result and path when the admin switches categories. */
export interface SaeCheckViewSession {
  path: string;
  result: SaeCheckResponse | null;
  selectedFile: string | null;
}

export const saeCheckViewSessions = createEntitySessionCache<SaeCheckViewSession>();
