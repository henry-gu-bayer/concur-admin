import { ReactNode, useEffect, useState } from 'react';
import { Button } from './Button';

export function EmptyPanel({ title, message, action, className = '' }: { title: string; message: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-56 flex-1 flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-12 text-center ${className}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorPanel({ title, message, onRetry, retryLabel = 'Retry' }: { title: string; message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-16 text-center" role="alert">
      <h2 className="text-base font-semibold text-destructive">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry ? <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>{retryLabel}</Button> : null}
    </div>
  );
}

/**
 * Determinate/indeterminate retrieval bar with a live status line.
 *
 * `percent === undefined` means the total genuinely is not known — the bar
 * pulses instead of inventing a number. Callers that can only measure elapsed
 * time (single-request operations) must use that variant rather than animating
 * a fake percentage.
 */
export function RetrievalProgress({
  label,
  detail,
  percent,
  elapsedMs,
  action,
}: {
  label: string;
  detail?: string;
  percent?: number;
  elapsedMs?: number;
  action?: ReactNode;
}) {
  const determinate = percent !== undefined;
  return (
    <div className="mb-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-primary">
        <span className="font-semibold text-foreground">{label}</span>
        {detail ? <span className="min-w-0 truncate text-muted-foreground">{detail}</span> : null}
        {elapsedMs === undefined ? null : (
          <span className="shrink-0 tabular-nums text-muted-foreground">{formatElapsed(elapsedMs)}</span>
        )}
        <span className="ml-auto shrink-0 font-semibold tabular-nums text-primary">
          {determinate ? `${percent}%` : 'In progress'}
        </span>
        {action ? <span className="shrink-0">{action}</span> : null}
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? percent : undefined}
      >
        <div
          className={`h-full rounded-full bg-primary transition-[width] duration-300 ${determinate ? '' : 'animate-pulse'}`}
          style={{ width: determinate ? `${percent}%` : '34%' }}
        />
      </div>
    </div>
  );
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

/** Ticks once a second while `active`, so elapsed time in a bar stays live. */
export function useElapsedMs(active: boolean): number | undefined {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setStartedAt(null);
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    setStartedAt(start);
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return startedAt === null ? undefined : elapsedMs;
}

export function LoadingRows({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card" aria-busy="true" aria-label={label}>
      <div className="border-b bg-muted/50 px-4 py-3 sm:px-6">
        <div className="h-3 w-52 rounded bg-muted-foreground/20 animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]" />
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0 sm:px-6">
          <div className="h-4 flex-1 rounded bg-muted animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]" />
        </div>
      ))}
    </div>
  );
}
