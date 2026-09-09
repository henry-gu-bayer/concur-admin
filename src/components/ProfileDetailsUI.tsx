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

interface ProfileDataGroup {
  label: string;
  rows: ProfileDataRow[];
  groups: ProfileDataGroup[];
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
  lastModified,
  employeeId,
  startDate,
  terminationDate,
  action,
}: {
  name: string;
  recordId?: string | null;
  identifiers: ProfileIdentifier[];
  status?: string;
  caption?: string;
  lastModified?: string | null;
  employeeId?: string | number | null;
  startDate?: string | null;
  terminationDate?: string | null;
  action?: ReactNode;
}) {
  const visibleIdentifiers = identifiers.filter(({ value }) => value !== undefined && value !== null && value !== '');
  const headerIdentifiers = [
    ...visibleIdentifiers,
    ...(employeeId !== undefined && employeeId !== null && employeeId !== '' ? [{ label: 'Employee ID', value: employeeId, mono: true }] : []),
  ];
  return (
    <header className="border-b bg-muted/20 px-4 py-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Profile details</p>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
            {status}
          </span>
        </div>
      </div>
      <div className="mt-1 min-w-0">
        <h2 className="min-w-0 truncate text-base font-semibold text-foreground" title={name}>{name}</h2>
      </div>
      {headerIdentifiers.length ? <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {headerIdentifiers.map(({ label, value, mono }) => (
          <div key={label} className="flex min-w-0 items-baseline gap-1">
            <dt className="shrink-0 font-medium uppercase tracking-wide">{label}</dt>
            <dd className={`min-w-0 break-all text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
          </div>
        ))}
      </dl> : null}
      {startDate || terminationDate || lastModified ? <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {startDate ? <div className="flex items-baseline gap-1"><dt className="font-medium uppercase tracking-wide">Start date</dt><dd><time dateTime={startDate}>{formatProfileDateTime(startDate)}</time></dd></div> : null}
        {terminationDate ? <div className="flex items-baseline gap-1"><dt className="font-medium uppercase tracking-wide">Terminate date</dt><dd><time dateTime={terminationDate}>{formatProfileDateTime(terminationDate)}</time></dd></div> : null}
        {lastModified ? <div className="flex items-baseline gap-1"><dt className="font-medium uppercase tracking-wide">Last modified</dt><dd><time dateTime={lastModified}>{formatProfileDateTime(lastModified)}</time></dd></div> : null}
      </dl> : null}
      {recordId ? <p className="mt-2 min-w-0 break-all font-mono text-[10px] text-muted-foreground"><span className="mr-1.5 font-sans font-medium uppercase tracking-wide">USER UUID</span>{recordId}</p> : null}
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

export function ProfileSchemaTable({
  label,
  value,
  excludedKeys = [],
}: {
  label: string;
  value: unknown;
  excludedKeys?: string[];
}) {
  const data = profileDataGroup(label, value, new Set(excludedKeys));
  if (!data.rows.length && !data.groups.length) return <p className="py-2.5 text-xs text-muted-foreground">No data returned for this schema.</p>;
  return (
    <div className="space-y-2 py-2.5">
      {data.rows.length ? <ProfileDataTable label={label} rows={data.rows} /> : null}
      {data.groups.map((group) => <ProfileNestedDataGroup key={group.label} group={group} />)}
    </div>
  );
}

function ProfileNestedDataGroup({ group }: { group: ProfileDataGroup }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <section className="overflow-hidden rounded-md border border-border/70 bg-muted/10">
      <button
        type="button"
        aria-label={group.label}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{group.label}</span>
        <span aria-hidden="true" className="text-[10px] text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <div id={contentId} className="space-y-2 border-t border-border/60 px-2.5 pb-2">
          {group.rows.length ? <ProfileDataTable label={`${group.label} fields`} rows={group.rows} /> : null}
          {group.groups.map((nested) => <ProfileNestedDataGroup key={nested.label} group={nested} />)}
        </div>
      ) : null}
    </section>
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

function profileDataGroup(label: string, value: unknown, excludedKeys: Set<string>): ProfileDataGroup {
  const group: ProfileDataGroup = { label, rows: [], groups: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    appendProfileRows(group.rows, value, label, excludedKeys);
    return group;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
    if (excludedKeys.has(key) || nested === undefined) return;
    const fieldLabel = humanizeProfileField(key);
    if (Array.isArray(nested) && nested.some((item) => item && typeof item === 'object')) {
      const itemLabel = singularProfileLabel(fieldLabel);
      nested.forEach((item, index) => {
        const child = profileDataGroup(`${itemLabel} ${index + 1}`, item, excludedKeys);
        if (child.rows.length || child.groups.length) group.groups.push(child);
      });
    } else if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const child = profileDataGroup(fieldLabel, nested, excludedKeys);
      if (child.rows.length || child.groups.length) group.groups.push(child);
    } else {
      appendProfileRows(group.rows, nested, fieldLabel, excludedKeys);
    }
  });
  return group;
}

function singularProfileLabel(value: string): string {
  const known: Record<string, string> = {
    Addresses: 'Address',
    Emails: 'Email',
    'Phone numbers': 'Phone number',
  };
  if (known[value]) return known[value];
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`;
  if (value.endsWith('s') && !value.endsWith('ss')) return value.slice(0, -1);
  return value;
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

function formatProfileDateTime(value: string): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  const part = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}:${part(date.getHours())}:${part(date.getMinutes())}`;
}
