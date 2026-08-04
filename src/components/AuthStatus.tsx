import { REFRESH_LEEWAY_SEC } from '../auth/config';
import { retryAuth } from '../auth/tokenStore';
import { useAccessToken } from '../auth/useAccessToken';
import { formatCountdown, useCountdown } from '../auth/useCountdown';
import { Badge } from './ui/Badge';

/**
 * Top-bar auth status: live countdown to access-token expiry + connection state.
 * Reads the global token store reactively; ticks once per second.
 */
export function AuthStatus() {
  const { accessToken, expiresAt, status, error } = useAccessToken();
  const remaining = useCountdown(expiresAt);

  if (status === 'error') {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="destructive" dot>
          Auth error
        </Badge>
        <button
          onClick={() => void retryAuth()}
          title={error ?? 'Retry authentication'}
          className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  if (status === 'initializing' || (status === 'refreshing' && !accessToken)) {
    return (
      <Badge tone="muted" dot>
        <span className="animate-pulse">Connecting…</span>
      </Badge>
    );
  }

  const refreshing = status === 'refreshing';
  const expiringSoon = remaining > 0 && remaining <= REFRESH_LEEWAY_SEC;
  const tone = refreshing ? 'primary' : expiringSoon ? 'warning' : 'success';

  return (
    <span
      title={
        refreshing
          ? 'Refreshing the access token…'
          : `Access token expires in ${formatCountdown(remaining)}. Auto-refreshes ${REFRESH_LEEWAY_SEC / 60} min before expiry.`
      }
      aria-live="polite"
    >
      <Badge tone={tone} dot>
        {refreshing ? 'Refreshing…' : `Token ${formatCountdown(remaining)}`}
      </Badge>
    </span>
  );
}
