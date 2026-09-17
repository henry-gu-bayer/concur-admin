/**
 * Local operator / browser-client identity helpers for audit logging.
 *
 * The Concur OAuth credentials are shared per entity; these helpers capture
 * who is running the Node process and which browser first contacted each
 * entity — without treating that as a Concur end-user identity.
 */

import os from 'node:os';

export interface LocalOperatorInfo {
  username: string | null;
  userDomain: string | null;
  hostname: string;
  platform: string;
  release: string;
  arch: string;
}

export interface ClientInfo {
  userAgent: string | null;
  language: string | null;
  languages: string | null;
  platform: string | null;
  uaData: string | null;
}

const loggedClientEntities = new Set<string>();

function resolveUsername(): string | null {
  try {
    const name = os.userInfo().username?.trim();
    if (name) return name;
  } catch {
    /* fall through to env fallbacks */
  }
  const fallback = (process.env.USERNAME ?? process.env.USER ?? '').trim();
  return fallback || null;
}

/** Snapshot of the OS account and host running this Node process. */
export function getLocalOperatorInfo(): LocalOperatorInfo {
  const domain = (process.env.USERDOMAIN ?? '').trim();
  return {
    username: resolveUsername(),
    userDomain: domain || null,
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
  };
}

function headerString(headers: Record<string, unknown>, name: string): string | null {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (typeof entry?.[1] !== 'string') return null;
  const value = entry[1].trim();
  return value || null;
}

/** Parse SPA-supplied browser metadata from `/auth/token` request headers. */
export function parseClientHeaders(headers: Record<string, unknown> = {}): ClientInfo {
  return {
    userAgent: headerString(headers, 'x-client-user-agent'),
    language: headerString(headers, 'x-client-language'),
    languages: headerString(headers, 'x-client-languages'),
    platform: headerString(headers, 'x-client-platform'),
    uaData: headerString(headers, 'x-client-ua-data'),
  };
}

/**
 * Returns true the first time `entityId` is seen in this process, then false.
 * Used so each Concur entity logs browser client info only once per startup.
 */
export function tryMarkClientLogged(entityId: string): boolean {
  if (loggedClientEntities.has(entityId)) return false;
  loggedClientEntities.add(entityId);
  return true;
}

/** Test-only: clear the process-scoped first-client marks. */
export function resetClientLogState(): void {
  loggedClientEntities.clear();
}
