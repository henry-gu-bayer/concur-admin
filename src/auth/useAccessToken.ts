import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, TokenSnapshot } from './tokenStore';

/**
 * Reactive access to the global Concur access token.
 * Re-renders the consuming component whenever the token, expiry, or status changes.
 */
export function useAccessToken(): TokenSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Seconds until the current access token expires (0 when unknown/expired). */
export function secondsUntilExpiry(s: TokenSnapshot): number {
  if (!s.expiresAt) return 0;
  return Math.max(0, Math.floor((s.expiresAt - Date.now()) / 1000));
}
