import { ReactNode } from 'react';
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
