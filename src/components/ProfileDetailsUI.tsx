import { ReactNode, useId, useState } from 'react';

export interface ProfileIdentifier {
  label: string;
  value?: string | number | null;
  mono?: boolean;
}

export interface ProfileDataRow {
  label: string;
  value: string;
  mono?: boolean;
}

export const profileDetailsPanelClass = 'min-h-[360px] min-w-0 overflow-auto rounded-lg border bg-card shadow-sm xl:min-h-0';

export function ProfileDetailsState({
  ariaLabel,
  title,
  description,
  loading = false,
}: {
  ariaLabel: string;
  title: string;
  description: string;
  loading?: boolean;
}) {
  return (
    <aside aria-label={ariaLabel} aria-busy={loading} className={`${profileDetailsPanelClass} flex items-center justify-center px-6 text-center`}>
      <ProfileDetailsStateContent title={title} description={description} />
    </aside>
  );
}

export function ProfileDetailsStateContent({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-xs">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Profile details</p>
      <h2 className="mt-2 text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

export function ProfileDetailsHeader({
  name,
  recordId,
  identifiers,
  status = 'Local snapshot',
  caption,
}: {
  name: string;
  recordId?: string | null;
  identifiers: ProfileIdentifier[];
  status?: string;
  caption?: string;
}) {
  const visibleIdentifiers = identifiers.filter(({ value }) => value !== undefined && value !== null && value !== '');
  return (
    <header className="border-b bg-muted/20 px-4 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Profile details</p>
          <h2 className="mt-1 truncate text-base font-semibold text-foreground" title={name}>{name}</h2>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
          {status}
        </span>
      </div>
      {visibleIdentifiers.length ? (
        <dl className="mt-3 divide-y divide-border/70 rounded-md border bg-background/80 px-3">
          {visibleIdentifiers.map(({ label, value, mono }) => (
            <div key={label} className="grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-2 py-1.5">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className={`min-w-0 break-all text-[11px] text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {recordId ? <p className="mt-2 min-w-0 break-all font-mono text-[10px] text-muted-foreground"><span className="mr-1.5 font-sans font-medium uppercase tracking-wide">Record ID</span>{recordId}</p> : null}
      {caption ? <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{caption}</p> : null}
    </header>
  );
}

export function ProfileDetailSection({
  title,
  children,
  defaultOpen = false,
  compact = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className={`overflow-hidden rounded-md border bg-card transition-colors ${open ? 'border-primary/30' : 'border-border'}`}>
      <button
        type="button"
        aria-label={title}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center justify-between gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} ${open ? 'bg-primary/5 text-primary' : 'bg-muted/20 text-foreground hover:bg-accent/60'}`}
      >
        <span className={`${compact ? 'text-[11px]' : 'text-xs'} font-semibold`}>{title}</span>
        <span aria-hidden="true" className="text-[10px] font-medium text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? <div id={contentId} className={`${compact ? 'px-2.5' : 'px-3'} border-t border-border/70 bg-card`}>{children}</div> : null}
    </section>
  );
}

export function ProfileDetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
}) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <dl className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-x-3 border-b border-border/60 py-2 last:border-b-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-all text-xs text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </dl>
  );
}

export function ProfileDataTable({
  label,
  rows,
}: {
  label: string;
  rows: ProfileDataRow[];
}) {
  if (!rows.length) return <p className="py-2.5 text-xs text-muted-foreground">No data returned for this schema.</p>;
  return (
    <div className="overflow-x-auto py-2.5">
      <table aria-label={label} className="w-full table-fixed border-separate border-spacing-0 text-left text-xs">
        <colgroup><col className="w-[38%]" /><col /></colgroup>
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="border-b border-border/70 px-2 py-1.5 font-medium">Field</th>
            <th scope="col" className="border-b border-border/70 px-2 py-1.5 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.label}-${index}`} className="align-top">
              <th scope="row" className={`break-words px-2 py-1.5 text-[11px] font-medium text-muted-foreground ${index === rows.length - 1 ? '' : 'border-b border-border/50'}`}>{row.label}</th>
              <td className={`break-all px-2 py-1.5 text-foreground ${index === rows.length - 1 ? '' : 'border-b border-border/50'} ${row.mono ? 'font-mono text-[11px]' : ''}`}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function profileDataRows(value: unknown, excludedKeys: string[] = []): ProfileDataRow[] {
  const rows: ProfileDataRow[] = [];
  appendProfileRows(rows, value, '', new Set(excludedKeys));
  return rows;
}

function appendProfileRows(rows: ProfileDataRow[], value: unknown, path: string, excludedKeys: Set<string>): void {
  if (value === undefined) return;
  if (value === null) {
    if (path) rows.push({ label: path, value: '—' });
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      if (path) rows.push({ label: path, value: '—' });
      return;
    }
    if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      rows.push({ label: path, value: value.map(formatProfileValue).join(', ') });
      return;
    }
    value.forEach((item, index) => appendProfileRows(rows, item, `${path} ${index + 1}`.trim(), excludedKeys));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      if (excludedKeys.has(key) || nested === undefined) return;
      const label = path ? `${path} · ${humanizeProfileField(key)}` : humanizeProfileField(key);
      appendProfileRows(rows, nested, label, excludedKeys);
    });
    return;
  }
  if (path) rows.push({ label: path, value: formatProfileValue(value), mono: profileValueIsMachineReadable(path, value) });
}

function formatProfileValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function humanizeProfileField(value: string): string {
  const known: Record<string, string> = {
    id: 'ID', href: 'Link', userName: 'Login ID', employeeNumber: 'Employee ID',
    syncGuid: 'Sync GUID', canUseBi: 'Can use BI', biManager: 'BI manager',
  };
  if (known[value]) return known[value];
  const words = value.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.replace(/^./, (character) => character.toUpperCase());
}

function profileValueIsMachineReadable(label: string, value: unknown): boolean {
  return typeof value === 'string' && (/(^|\s)(id|guid|code|number|login)(\s|$)/i.test(label) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value));
}
