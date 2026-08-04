import { useEffect, useState } from 'react';

/**
 * Live countdown to an epoch-ms target. Ticks once per second.
 * Returns remaining whole seconds (0 when the target is null or passed).
 */
export function useCountdown(targetEpochMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!targetEpochMs) return 0;
  return Math.max(0, Math.floor((targetEpochMs - now) / 1000));
}

/** Format seconds as H:MM:SS (or M:SS under an hour). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
