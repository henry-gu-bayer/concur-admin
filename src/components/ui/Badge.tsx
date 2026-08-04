import { ReactNode } from 'react';

export type BadgeTone = 'muted' | 'primary' | 'success' | 'warning' | 'destructive';

const toneCls: Record<BadgeTone, string> = {
  muted: 'bg-muted text-muted-foreground border-border',
  primary: 'bg-primary/10 text-primary border-primary/25',
  success: 'bg-success/10 text-success border-success/25',
  warning: 'bg-warning/10 text-warning border-warning/30',
  destructive: 'bg-destructive/10 text-destructive border-destructive/30',
};

/**
 * Generic status/label pill. Semantic tones only — never decorative color.
 * Dot is optional; pass `dot` to show a leading status indicator.
 */
export function Badge({
  children,
  tone = 'muted',
  dot = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  const dotCls: Record<BadgeTone, string> = {
    muted: 'bg-muted-foreground',
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneCls[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotCls[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}
