import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  getLocalityCountriesSnapshot,
  getLocalityCountry,
  getLocalitySubdivision,
  getLocalitySubdivisions,
  refreshLocalityCountries,
  searchLocalityLocations,
} from '../api/localitiesApi';
import { timeAgo } from '../api/listsApi';
import type { LocalityCountriesSnapshot, LocalityCountry, LocalityLocation, LocalitySubdivision } from '../types';
import subdivisionsData from '../data/subdivisions.json';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ColumnResizeHandle, ResizableDetailLayout, useColumnWidths } from './ui/Resizable';
import { EmptyPanel, RetrievalProgress, useElapsedMs } from './ui/AsyncState';
import { CountryRegionPicker } from './CountryRegionPicker';

type LocalitiesTab = 'countries' | 'subdivisions' | 'locations';
type SortDir = 1 | -1;

interface SubdivisionOption {
  code: string;
  name: string;
}

const subdivisions = subdivisionsData as Record<string, SubdivisionOption[]>;
const SEARCH_TEXT_SPECIAL_CHARS = /[~!@#$%^&]/;
const LOC_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
const countryColumnDefaults = [100, 360, 160, 110] as const;
const subdivisionColumnDefaults = [150, 360, 110, 110] as const;
const localityColumnDefaults = [280, 150, 110, 160] as const;

const tabs = [
  { id: 'countries', label: 'Countries/Regions', shortLabel: 'Country/region' },
  { id: 'subdivisions', label: 'Subdivisions', shortLabel: 'Subdivision' },
  { id: 'locations', label: 'Locations', shortLabel: 'Locality' },
];

export function LocalitiesView() {
  const [active, setActive] = useState<LocalitiesTab>('countries');
  const [snapshot, setSnapshot] = useState<LocalityCountriesSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [countryCode, setCountryCode] = useState('');
  const [countryRowsOverride, setCountryRowsOverride] = useState<LocalityCountry[] | null>(null);
  const [countryDialog, setCountryDialog] = useState<LocalityCountry | null>(null);
  const [subdivisionCountryCode, setSubdivisionCountryCode] = useState('');
  const [subdivisionCode, setSubdivisionCode] = useState('');
  const [subdivisionsResult, setSubdivisionsResult] = useState<LocalitySubdivision[] | null>(null);
  const [subdivisionDialog, setSubdivisionDialog] = useState<LocalitySubdivision | null>(null);
  const [locationCountry, setLocationCountry] = useState('');
  const [locationSubdivision, setLocationSubdivision] = useState('');
  const [searchText, setSearchText] = useState('');
  const [locCode, setLocCode] = useState('');
  const [locations, setLocations] = useState<LocalityLocation[] | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocalityLocation | null>(null);
  const [working, setWorking] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const elapsedMs = useElapsedMs(task !== null);

  useEffect(() => {
    void loadCountriesSnapshot();
  }, []);

  const locationSubdivisionOptions = useMemo(
    () => (locationCountry ? (subdivisions[locationCountry] ?? []) : []),
    [locationCountry],
  );

  const loadCountriesSnapshot = async () => {
    setSnapshotLoading(true);
    try {
      setSnapshot(await getLocalityCountriesSnapshot());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSnapshotLoading(false);
    }
  };

  const refreshCountries = async () => {
    setRefreshing(true);
    setTask('Refreshing countries/regions from Concur');
    setError(null);
    try {
      setSnapshot(await refreshLocalityCountries());
      setCountryRowsOverride(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
      setTask(null);
    }
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    const runSeq = ++seq.current;
    setWorking(true);
    setTask(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (runSeq === seq.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (runSeq === seq.current) {
        setWorking(false);
        setTask(null);
      }
    }
  };

  const showCountry = async (code: string) => {
    setActive('countries');
    setCountryCode(code);
    await run(`Looking up country/region ${code.trim().toUpperCase()}`, async () => {
      const country = await getLocalityCountry(code);
      setCountryRowsOverride([country]);
    });
  };

  const showSubdivisionsForCountry = async (code: string) => {
    setActive('subdivisions');
    setSubdivisionCountryCode(code);
    setSubdivisionCode('');
    setCountryDialog(null);
    await run(`Listing subdivisions for ${code.trim().toUpperCase()}`, async () => {
      setSubdivisionsResult(await getLocalitySubdivisions(code.trim().toUpperCase()));
      setSubdivisionDialog(null);
    });
  };

  const showLocationsForSubdivision = (subdivision: LocalitySubdivision) => {
    setSubdivisionDialog(null);
    setActive('locations');
    setLocationCountry(subdivision.countryCode ?? subdivision.code.split('-')[0] ?? '');
    setLocationSubdivision(subdivision.code);
    setSearchText('');
    setLocCode('');
    setLocations(null);
    setSelectedLocation(null);
  };

  const showSubdivision = async (code: string) => {
    setActive('subdivisions');
    setSubdivisionCode(code);
    await run(`Looking up subdivision ${code.trim().toUpperCase()}`, async () => {
      const sub = await getLocalitySubdivision(code);
      setSubdivisionsResult([sub]);
      if (sub.countryCode) setSubdivisionCountryCode(sub.countryCode);
    });
  };

  const lookupCountry = async (event: FormEvent) => {
    event.preventDefault();
    if (!countryCode.trim()) return;
    await showCountry(countryCode);
  };

  const listSubdivisions = async (event: FormEvent) => {
    event.preventDefault();
    if (!subdivisionCountryCode.trim()) return;
    await run(`Listing subdivisions for ${subdivisionCountryCode.trim().toUpperCase()}`, async () => {
      const rows = await getLocalitySubdivisions(subdivisionCountryCode.trim().toUpperCase());
      setSubdivisionsResult(rows);
    });
  };

  const lookupSubdivision = async (event: FormEvent) => {
    event.preventDefault();
    if (!subdivisionCode.trim()) return;
    await showSubdivision(subdivisionCode);
  };

  const searchLocations = async (event: FormEvent) => {
    event.preventDefault();
    const loc = locCode.trim();
    const text = searchText.trim();
    if (!loc && !text) return;
    if (loc && !LOC_CODE_PATTERN.test(loc)) {
      setError('LocCode can only contain letters, numbers, hyphen, or underscore');
      return;
    }
    if (!loc && SEARCH_TEXT_SPECIAL_CHARS.test(text)) {
      setError('Search text cannot contain special characters such as ~ ! @ # $ % ^ &');
      return;
    }
    await run('Searching localities', async () => {
      setSelectedLocation(null);
      setLocations(await searchLocalityLocations({
        countryCode: locationCountry || undefined,
        subdivisionCode: locationSubdivision || undefined,
        searchText: loc ? undefined : text,
        locCode: loc || undefined,
      }));
    });
  };

  return (
    <div className="xl:flex xl:h-full xl:min-h-0 xl:flex-col">
      {task && (
        // Every Localities operation is a single Concur request, so there is no
        // page or item count to divide by — elapsed time is all we can honestly
        // report, and inventing a percentage here would be a fake animation.
        <RetrievalProgress label={task} detail="Single Concur request — only elapsed time is known." elapsedMs={elapsedMs} />
      )}

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {active === 'countries' && (
        <CountriesTab
          active={active}
          onScopeChange={setActive}
          snapshot={snapshot}
          snapshotLoading={snapshotLoading}
          refreshing={refreshing}
          rowsOverride={countryRowsOverride}
          countryCode={countryCode}
          countryDialog={countryDialog}
          working={working}
          onCountryCodeChange={setCountryCode}
          onLookupCountry={lookupCountry}
          onRefreshCountries={() => void refreshCountries()}
          onOpenCountry={setCountryDialog}
          onCloseCountry={() => setCountryDialog(null)}
          onViewSubdivisions={(code) => void showSubdivisionsForCountry(code)}
        />
      )}

      {active === 'subdivisions' && (
        <SubdivisionsTab
          active={active}
          onScopeChange={setActive}
          refreshing={refreshing}
          onRefreshCountries={() => void refreshCountries()}
          countryCode={subdivisionCountryCode}
          subdivisionCode={subdivisionCode}
          rows={subdivisionsResult}
          dialogSubdivision={subdivisionDialog}
          working={working}
          onCountryCodeChange={setSubdivisionCountryCode}
          onSubdivisionCodeChange={setSubdivisionCode}
          onList={listSubdivisions}
          onLookup={lookupSubdivision}
          onOpenSubdivision={setSubdivisionDialog}
          onCloseSubdivision={() => setSubdivisionDialog(null)}
          onCountryClick={(code) => void showCountry(code)}
          onLocationsClick={showLocationsForSubdivision}
        />
      )}

      {active === 'locations' && (
        <LocationsTab
          active={active}
          onScopeChange={setActive}
          refreshing={refreshing}
          onRefreshCountries={() => void refreshCountries()}
          countryCode={locationCountry}
          subdivisionCode={locationSubdivision}
          subdivisionOptions={locationSubdivisionOptions}
          searchText={searchText}
          locCode={locCode}
          rows={locations}
          selected={selectedLocation}
          working={working}
          onCountryChange={(code) => {
            setLocationCountry(code);
            setLocationSubdivision('');
            if (code) setLocCode('');
          }}
          onSubdivisionChange={(code) => {
            setLocationSubdivision(code);
            if (code) setLocCode('');
          }}
          onSearchTextChange={(text) => {
            setSearchText(text);
            if (text.trim()) setLocCode('');
          }}
          onLocCodeChange={(code) => {
            setLocCode(code);
            if (code.trim()) {
              setLocationCountry('');
              setLocationSubdivision('');
              setSearchText('');
            }
          }}
          onSearch={searchLocations}
          onSelect={setSelectedLocation}
          onCountryClick={(code) => void showCountry(code)}
          onSubdivisionClick={(code) => void showSubdivision(code)}
        />
      )}
    </div>
  );
}

function LocalityScopeControl({ active, onChange }: { active: LocalitiesTab; onChange: (scope: LocalitiesTab) => void }) {
  return (
    <div role="tablist" aria-label="Search scope" className="inline-flex h-10 rounded-md border border-input bg-muted/40 p-1">
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-label={tab.label}
            aria-selected={selected}
            onClick={() => onChange(tab.id as LocalitiesTab)}
            className={`whitespace-nowrap rounded px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {tab.shortLabel}
          </button>
        );
      })}
    </div>
  );
}

function LocalitiesQueryCard({
  active,
  onScopeChange,
  children,
  headerAction,
}: {
  active: LocalitiesTab;
  onScopeChange: (scope: LocalitiesTab) => void;
  children: ReactNode;
  headerAction?: ReactNode;
}) {
  const helperText: Record<LocalitiesTab, string> = {
    countries: 'Browse cached countries/regions, refresh the local snapshot, or look up one country code.',
    subdivisions: 'List all subdivisions for a country/region, or look up a specific subdivision code.',
    locations: 'Search localities with geography and text filters, or use an exact LocCode.',
  };
  return (
    <section className="mb-3 rounded-lg border bg-card px-4 py-3 shadow-sm" aria-label="Localities query workspace">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Search localities</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{helperText[active]}</p>
        </div>
        {headerAction}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3 xl:flex-nowrap">
        <div className="shrink-0">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Search scope</p>
          <LocalityScopeControl active={active} onChange={onScopeChange} />
        </div>
        {children}
      </div>
      {active === 'locations' && (
        <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">Drill path: Country/region → Subdivision → Locality. Selecting a result retains links to each parent record.</p>
      )}
    </section>
  );
}

function QueryField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function CountriesTab({
  active,
  onScopeChange,
  snapshot,
  snapshotLoading,
  refreshing,
  rowsOverride,
  countryCode,
  countryDialog,
  working,
  onCountryCodeChange,
  onLookupCountry,
  onRefreshCountries,
  onOpenCountry,
  onCloseCountry,
  onViewSubdivisions,
}: {
  active: LocalitiesTab;
  onScopeChange: (scope: LocalitiesTab) => void;
  snapshot: LocalityCountriesSnapshot | null;
  snapshotLoading: boolean;
  refreshing: boolean;
  rowsOverride: LocalityCountry[] | null;
  countryCode: string;
  countryDialog: LocalityCountry | null;
  working: boolean;
  onCountryCodeChange: (value: string) => void;
  onLookupCountry: (event: FormEvent) => void;
  onRefreshCountries: () => void;
  onOpenCountry: (country: LocalityCountry) => void;
  onCloseCountry: () => void;
  onViewSubdivisions: (code: string) => void;
}) {
  const rows = rowsOverride ?? snapshot?.countries ?? [];
  const [sort, setSort] = useState<{ id: 'code' | 'name'; dir: SortDir }>({ id: 'code', dir: 1 });
  const columns = useColumnWidths(countryColumnDefaults);
  const sortedRows = useMemo(() => sortRows(rows, sort.id, sort.dir, (country, id) => (
    id === 'code' ? country.code : displayName(country.names)
  )), [rows, sort]);
  const toggleSort = (id: 'code' | 'name') => setSort((s) => (s.id === id ? { id, dir: s.dir === 1 ? -1 : 1 } : { id, dir: 1 }));
  return (
    <>
      <LocalitiesQueryCard
        active={active}
        onScopeChange={onScopeChange}
        headerAction={<Button type="button" size="sm" variant="ghost" aria-label="Refresh countries/regions" loading={refreshing} onClick={onRefreshCountries}>Refresh countries</Button>}
      >
        <form onSubmit={onLookupCountry} className="flex flex-wrap items-end gap-2">
          <CountryRegionPicker
            value={countryCode}
            disabled={false}
            onChange={onCountryCodeChange}
            fieldLabel="Country code"
            fieldId="locality-country-code"
          />
          <Button type="submit" size="sm" loading={working} disabled={!countryCode.trim()}>
            Lookup country
          </Button>
        </form>
      </LocalitiesQueryCard>
      <section className="min-w-0 xl:min-h-0 xl:flex-1" aria-label="Locality countries/regions">
        {snapshotLoading ? (
          <EmptyPanel title="Loading countries/regions" message="Reading the local countries/regions snapshot." />
        ) : !snapshot && !rowsOverride ? (
          <EmptyPanel title="No countries/regions snapshot" message="Refresh countries/regions to cache Localities v5 country data for this entity." />
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
              {sortedRows.length} countr{sortedRows.length === 1 ? 'y/region' : 'ies/regions'}{snapshot ? ` · retrieved ${timeAgo(snapshot.retrievedAt)}` : ''}
            </div>
            <div className="min-h-0 flex-1 overflow-auto" data-testid="locality-countries-results-scroll-region">
            <table className="text-sm [&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap" style={{ width: columns.totalWidth, minWidth: '100%', tableLayout: 'fixed' }} aria-label="Locality countries/regions">
              <colgroup>
                {columns.widths.map((width, index) => <col key={index} style={{ width }} />)}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {sortHeader('code', 'Code', sort, toggleSort, <ColumnResizeHandle label="Code" width={columns.widths[0]} minWidth={72} onChange={(width) => columns.setWidth(0, width)} onReset={() => columns.resetWidth(0)} />)}
                  {sortHeader('name', 'Name', sort, toggleSort, <ColumnResizeHandle label="Name" width={columns.widths[1]} minWidth={140} onChange={(width) => columns.setWidth(1, width)} onReset={() => columns.resetWidth(1)} />)}
                  <th scope="col" className="relative px-3 py-2">Currency<ColumnResizeHandle label="Currency" width={columns.widths[2]} minWidth={96} onChange={(width) => columns.setWidth(2, width)} onReset={() => columns.resetWidth(2)} /></th>
                  <th scope="col" className="relative px-3 py-2">Status<ColumnResizeHandle label="Status" width={columns.widths[3]} minWidth={88} onChange={(width) => columns.setWidth(3, width)} onReset={() => columns.resetWidth(3)} /></th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((country) => (
                  <tr key={country.code} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-2 font-mono text-xs text-foreground">
                      <button type="button" aria-label={`View country/region ${country.code} by code`} onClick={() => onOpenCountry(country)} className="rounded-sm text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {country.code}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs font-medium text-foreground">
                      <button type="button" aria-label={`View country/region ${country.code} by name`} onClick={() => onOpenCountry(country)} className="rounded-sm text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {displayName(country.names)}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{country.currencies?.map((c) => c.code).filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-3 py-2"><StatusBadge active={country.active} /></td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      <Modal
        open={countryDialog !== null}
        onClose={onCloseCountry}
        title={`Country/Region ${countryDialog?.code ?? ''}`}
        width="max-w-2xl"
        footer={countryDialog ? (
          <Button type="button" size="sm" onClick={() => onViewSubdivisions(countryDialog.code)}>
            View subdivisions for {countryDialog.code}
          </Button>
        ) : undefined}
      >
        {countryDialog && <CountryFields country={countryDialog} />}
      </Modal>
    </>
  );
}

function SubdivisionsTab({
  active,
  onScopeChange,
  refreshing,
  onRefreshCountries,
  countryCode,
  subdivisionCode,
  rows,
  dialogSubdivision,
  working,
  onCountryCodeChange,
  onSubdivisionCodeChange,
  onList,
  onLookup,
  onOpenSubdivision,
  onCloseSubdivision,
  onCountryClick,
  onLocationsClick,
}: {
  active: LocalitiesTab;
  onScopeChange: (scope: LocalitiesTab) => void;
  refreshing: boolean;
  onRefreshCountries: () => void;
  countryCode: string;
  subdivisionCode: string;
  rows: LocalitySubdivision[] | null;
  dialogSubdivision: LocalitySubdivision | null;
  working: boolean;
  onCountryCodeChange: (value: string) => void;
  onSubdivisionCodeChange: (value: string) => void;
  onList: (event: FormEvent) => void;
  onLookup: (event: FormEvent) => void;
  onOpenSubdivision: (subdivision: LocalitySubdivision) => void;
  onCloseSubdivision: () => void;
  onCountryClick: (code: string) => void;
  onLocationsClick: (subdivision: LocalitySubdivision) => void;
}) {
  const [sort, setSort] = useState<{ id: 'code' | 'name'; dir: SortDir } | null>(null);
  const columns = useColumnWidths(subdivisionColumnDefaults);
  const sortedRows = useMemo(() => (
    sort ? sortRows(rows ?? [], sort.id, sort.dir, (sub, id) => (id === 'code' ? sub.code : displayName(sub.names))) : (rows ?? [])
  ), [rows, sort]);
  const toggleSort = (id: 'code' | 'name') => setSort((s) => (s?.id === id ? { id, dir: s.dir === 1 ? -1 : 1 } : { id, dir: 1 }));
  return (
    <>
      <LocalitiesQueryCard
        active={active}
        onScopeChange={onScopeChange}
        headerAction={<Button type="button" size="sm" variant="ghost" aria-label="Refresh countries/regions" loading={refreshing} onClick={onRefreshCountries}>Refresh countries</Button>}
      >
        <div className="flex flex-wrap items-end gap-2">
          <form onSubmit={onList} className="flex items-end gap-2">
            <QueryField label="Country/region code">
              <CountryRegionPicker
                value={countryCode}
                disabled={false}
                onChange={onCountryCodeChange}
                fieldLabel="Subdivision country code"
                fieldId="locality-subdivision-country"
                widthClass="w-64"
              />
            </QueryField>
            <Button type="submit" size="sm" loading={working} disabled={!countryCode.trim()}>List subdivisions</Button>
          </form>
          <form onSubmit={onLookup} className="flex items-end gap-2">
            <input aria-label="Subdivision code" value={subdivisionCode} onChange={(event) => onSubdivisionCodeChange(event.target.value)} placeholder="AU-QLD" className="h-10 w-40 rounded-md border border-input bg-card px-3 text-sm uppercase shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <Button type="submit" size="sm" variant="outline" loading={working} disabled={!subdivisionCode.trim()}>Lookup subdivision</Button>
          </form>
        </div>
      </LocalitiesQueryCard>
      <section className="min-w-0 xl:min-h-0 xl:flex-1" aria-label="Locality subdivisions">
        {!rows ? (
          <EmptyPanel title="Search subdivisions" message="List all subdivisions for a country code, or look up a specific ISO 3166-2 subdivision code." />
        ) : sortedRows.length === 0 ? (
          <EmptyPanel title="No subdivisions found" message="Try another country or subdivision code." />
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">{sortedRows.length} subdivision{sortedRows.length === 1 ? '' : 's'}</div>
            <div className="min-h-0 flex-1 overflow-auto" data-testid="locality-subdivisions-results-scroll-region">
            <table className="text-sm [&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap" style={{ width: columns.totalWidth, minWidth: '100%', tableLayout: 'fixed' }} aria-label="Locality subdivisions">
              <colgroup>
                {columns.widths.map((width, index) => <col key={index} style={{ width }} />)}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {sortHeader('code', 'Code', sort, toggleSort, <ColumnResizeHandle label="Code" width={columns.widths[0]} minWidth={96} onChange={(width) => columns.setWidth(0, width)} onReset={() => columns.resetWidth(0)} />)}
                  {sortHeader('name', 'Name', sort, toggleSort, <ColumnResizeHandle label="Name" width={columns.widths[1]} minWidth={140} onChange={(width) => columns.setWidth(1, width)} onReset={() => columns.resetWidth(1)} />)}
                  <th scope="col" className="relative px-3 py-2">Country<ColumnResizeHandle label="Country" width={columns.widths[2]} minWidth={80} onChange={(width) => columns.setWidth(2, width)} onReset={() => columns.resetWidth(2)} /></th>
                  <th scope="col" className="relative px-3 py-2">Status<ColumnResizeHandle label="Status" width={columns.widths[3]} minWidth={88} onChange={(width) => columns.setWidth(3, width)} onReset={() => columns.resetWidth(3)} /></th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((sub) => (
                  <tr key={sub.code} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-2 font-mono text-xs text-foreground">
                      <button type="button" aria-label={`View subdivision ${sub.code} by code`} onClick={() => onOpenSubdivision(sub)} className="rounded-sm text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {sub.code}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs font-medium text-foreground">
                      <button type="button" aria-label={`View subdivision ${sub.code} by name`} onClick={() => onOpenSubdivision(sub)} className="rounded-sm text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {displayName(sub.names)}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      {sub.countryCode ? <LinkButton label={`Country ${sub.countryCode}`} onClick={() => onCountryClick(sub.countryCode!)}>{sub.countryCode}</LinkButton> : '—'}
                    </td>
                    <td className="px-3 py-2"><StatusBadge active={sub.active} /></td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    <Modal
      open={dialogSubdivision !== null}
      onClose={onCloseSubdivision}
      title={`Subdivision ${dialogSubdivision?.code ?? ''}`}
      width="max-w-2xl"
      footer={dialogSubdivision ? (
        <Button type="button" size="sm" onClick={() => onLocationsClick(dialogSubdivision)}>
          View locations for {dialogSubdivision.code}
        </Button>
      ) : undefined}
    >
      {dialogSubdivision && <SubdivisionFields subdivision={dialogSubdivision} onCountryClick={onCountryClick} />}
    </Modal>
    </>
  );
}

function LocationsTab({
  active,
  onScopeChange,
  refreshing,
  onRefreshCountries,
  countryCode,
  subdivisionCode,
  subdivisionOptions,
  searchText,
  locCode,
  rows,
  selected,
  working,
  onCountryChange,
  onSubdivisionChange,
  onSearchTextChange,
  onLocCodeChange,
  onSearch,
  onSelect,
  onCountryClick,
  onSubdivisionClick,
}: {
  active: LocalitiesTab;
  onScopeChange: (scope: LocalitiesTab) => void;
  refreshing: boolean;
  onRefreshCountries: () => void;
  countryCode: string;
  subdivisionCode: string;
  subdivisionOptions: SubdivisionOption[];
  searchText: string;
  locCode: string;
  rows: LocalityLocation[] | null;
  selected: LocalityLocation | null;
  working: boolean;
  onCountryChange: (value: string) => void;
  onSubdivisionChange: (value: string) => void;
  onSearchTextChange: (value: string) => void;
  onLocCodeChange: (value: string) => void;
  onSearch: (event: FormEvent) => void;
  onSelect: (location: LocalityLocation) => void;
  onCountryClick: (code: string) => void;
  onSubdivisionClick: (code: string) => void;
}) {
  const locCodeMode = locCode.trim() !== '';
  const displaySubdivisionOptions = subdivisionCode && !subdivisionOptions.some((s) => s.code === subdivisionCode)
    ? [{ code: subdivisionCode, name: subdivisionCode }, ...subdivisionOptions]
    : subdivisionOptions;
  const [sort, setSort] = useState<{ id: 'name' | 'locCode' | 'country' | 'subdivision'; dir: SortDir } | null>(null);
  const columns = useColumnWidths(localityColumnDefaults);
  const sortedRows = useMemo(() => (
    sort ? sortRows(rows ?? [], sort.id, sort.dir, (loc, id) => {
      if (id === 'name') return displayName(loc.names);
      if (id === 'locCode') return loc.code ?? '';
      if (id === 'country') return loc.country?.code ?? '';
      return loc.subDivision?.code ?? '';
    }) : (rows ?? [])
  ), [rows, sort]);
  const toggleSort = (id: 'name' | 'locCode' | 'country' | 'subdivision') => setSort((s) => (s?.id === id ? { id, dir: s.dir === 1 ? -1 : 1 } : { id, dir: 1 }));
  return (
    <>
      <LocalitiesQueryCard
        active={active}
        onScopeChange={onScopeChange}
        headerAction={<Button type="button" size="sm" variant="ghost" aria-label="Refresh countries/regions" loading={refreshing} onClick={onRefreshCountries}>Refresh countries</Button>}
      >
        <form onSubmit={onSearch} className="grid min-w-[520px] flex-1 grid-cols-2 items-end gap-3 md:grid-cols-[192px_176px_minmax(144px,1fr)_128px_auto]">
          <QueryField label="Country/region (optional)">
            <CountryRegionPicker value={countryCode} disabled={locCodeMode} onChange={onCountryChange} widthClass="w-full" />
          </QueryField>
          <QueryField label="Subdivision (optional)">
            <select aria-label="Location subdivision" value={subdivisionCode} onChange={(event) => onSubdivisionChange(event.target.value)} disabled={locCodeMode || !subdivisionOptions.length} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
              <option value="">{countryCode ? 'Any subdivision' : 'Select subdivision'}</option>
              {displaySubdivisionOptions.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
            </select>
          </QueryField>
          <QueryField label="Search text (optional)">
            <input aria-label="Search text" value={searchText} onChange={(event) => onSearchTextChange(event.target.value)} disabled={locCodeMode} placeholder="e.g. Seattle or 98101" className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" />
          </QueryField>
          <QueryField label="LocCode (exact)">
            <input aria-label="LocCode" value={locCode} onChange={(event) => onLocCodeChange(event.target.value)} placeholder="e.g. US.WA" className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm uppercase shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </QueryField>
          <Button type="submit" size="md" aria-label="Search localities" loading={working} disabled={!searchText.trim() && !locCode.trim()}>Search</Button>
        </form>
      </LocalitiesQueryCard>
      <ResizableDetailLayout
      label="Resize locality results and details"
      list={(
      <section className="min-w-0 xl:h-full xl:min-h-0" aria-label="Locality locations">
        {!rows ? (
          <LocationsEmptyResults />
        ) : sortedRows.length === 0 ? (
          <EmptyPanel title="No localities found" message="Try another search text, locCode, or filter combination." />
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">{sortedRows.length} localit{sortedRows.length === 1 ? 'y' : 'ies'}</div>
            <div className="min-h-0 flex-1 overflow-auto" data-testid="locality-locations-results-scroll-region">
            <table className="text-sm [&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap" style={{ width: columns.totalWidth, minWidth: '100%', tableLayout: 'fixed' }} aria-label="Locality locations">
              <colgroup>
                {columns.widths.map((width, index) => <col key={index} style={{ width }} />)}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {sortHeader('name', 'Name', sort, toggleSort, <ColumnResizeHandle label="Name" width={columns.widths[0]} minWidth={140} onChange={(width) => columns.setWidth(0, width)} onReset={() => columns.resetWidth(0)} />)}
                  {sortHeader('locCode', 'LocCode', sort, toggleSort, <ColumnResizeHandle label="LocCode" width={columns.widths[1]} minWidth={96} onChange={(width) => columns.setWidth(1, width)} onReset={() => columns.resetWidth(1)} />)}
                  {sortHeader('country', 'Country', sort, toggleSort, <ColumnResizeHandle label="Country" width={columns.widths[2]} minWidth={80} onChange={(width) => columns.setWidth(2, width)} onReset={() => columns.resetWidth(2)} />)}
                  {sortHeader('subdivision', 'Subdivision', sort, toggleSort, <ColumnResizeHandle label="Subdivision" width={columns.widths[3]} minWidth={100} onChange={(width) => columns.setWidth(3, width)} onReset={() => columns.resetWidth(3)} />)}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((loc) => (
                  <tr key={loc.id ?? loc.code ?? displayName(loc.names)} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-2 text-xs font-medium text-foreground">
                      <button type="button" className="rounded-sm text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelect(loc)}>
                        {displayName(loc.names)}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{loc.code ?? '—'}</td>
                    <td className="px-3 py-2">{loc.country?.code ? <LinkButton label={`Country ${loc.country.code}`} onClick={() => onCountryClick(loc.country!.code)}>{loc.country.code}</LinkButton> : '—'}</td>
                    <td className="px-3 py-2">{loc.subDivision?.code ? <LinkButton label={`Subdivision ${loc.subDivision.code}`} onClick={() => onSubdivisionClick(loc.subDivision!.code)}>{loc.subDivision.code}</LinkButton> : '—'}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      )}
      detail={<LocationDetails location={selected} onCountryClick={onCountryClick} onSubdivisionClick={onSubdivisionClick} />}
      />
    </>
  );
}

function CountryFields({ country, onViewSubdivisions }: { country: LocalityCountry; onViewSubdivisions?: (code: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{displayName(country.names)}</h2>
        {onViewSubdivisions && (
          <Button type="button" size="sm" variant="outline" onClick={() => onViewSubdivisions(country.code)}>
            View subdivisions for {country.code}
          </Button>
        )}
      </div>
      <dl className="grid gap-1.5">
        <Field label="Code" value={country.code} mono />
        <Field label="Alpha-3" value={country.alpha3Code} mono />
        <Field label="Numeric" value={country.numCode} mono />
        <Field label="Distance unit" value={country.distanceUnitCode} />
        <Field label="Currencies" value={country.currencies?.map((c) => c.code).filter(Boolean).join(', ')} mono />
        <Field label="Active" value={booleanLabel(country.active)} />
      </dl>
    </div>
  );
}

function SubdivisionFields({ subdivision, onCountryClick }: { subdivision: LocalitySubdivision; onCountryClick: (code: string) => void }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">{displayName(subdivision.names)}</h2>
      <dl className="grid gap-1.5">
        <Field label="Code" value={subdivision.code} mono />
        <Field label="Country" value={subdivision.countryCode ? <LinkButton label={`Country ${subdivision.countryCode}`} onClick={() => onCountryClick(subdivision.countryCode!)}>{subdivision.countryCode}</LinkButton> : undefined} />
        <Field label="Active" value={booleanLabel(subdivision.active)} />
      </dl>
    </div>
  );
}

function LocationDetails({ location, onCountryClick, onSubdivisionClick }: { location: LocalityLocation | null; onCountryClick: (code: string) => void; onSubdivisionClick: (code: string) => void }) {
  return (
    <aside aria-label="Locality location details" className="min-w-0 overflow-hidden rounded-lg border bg-card shadow-sm xl:h-full xl:min-h-0">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Location details</h2>
      </div>
      {!location ? <NoSelection title="No locality selected" message="Select a row from the results to view details." /> : (
        <div className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">{displayName(location.names)}</h2>
          <dl className="grid gap-1.5">
            <Field label="LocCode" value={location.code} mono />
            <Field label="ID" value={location.id} mono />
            <Field label="Legacy key" value={location.legacyKey} mono />
            <Field label="Time zone offset" value={location.timeZoneOffset} />
            <Field label="Active" value={booleanLabel(location.active)} />
            <Field label="Latitude" value={location.point?.latitude} mono />
            <Field label="Longitude" value={location.point?.longitude} mono />
            <Field label="Country" value={location.country?.code ? <LinkButton label={`Country ${location.country.code}`} onClick={() => onCountryClick(location.country!.code)}>{displayName(location.country.names)} ({location.country.code})</LinkButton> : undefined} />
            <Field label="Subdivision" value={location.subDivision?.code ? <LinkButton label={`Subdivision ${location.subDivision.code}`} onClick={() => onSubdivisionClick(location.subDivision!.code)}>{displayName(location.subDivision.names)} ({location.subDivision.code})</LinkButton> : undefined} />
            <Field label="Admin region" value={displayName(location.administrativeRegion?.names)} />
            <Links links={location.links} />
          </dl>
        </div>
      )}
    </aside>
  );
}

function LocationsEmptyResults() {
  return (
    <div className="min-h-[500px] overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Results</h2>
        <Badge tone="muted">0</Badge>
      </div>
      <div className="grid grid-cols-[1fr_1.2fr_1fr_0.8fr] border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
        <span>LocCode</span>
        <span>Name</span>
        <span>Subdivision</span>
        <span>Country</span>
      </div>
      <div className="flex min-h-[390px] flex-col items-center justify-center px-6 text-center">
        <h2 className="text-base font-semibold">Enter search criteria and click Search</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">Results will appear here.</p>
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
        <span>25 per page</span>
        <span>0 results</span>
      </div>
    </div>
  );
}

function sortRows<T, K extends string>(
  rows: T[],
  id: K,
  dir: SortDir,
  valueFor: (row: T, id: K) => string,
): T[] {
  return [...rows].sort((a, b) => valueFor(a, id).localeCompare(valueFor(b, id)) * dir);
}

function sortHeader<K extends string>(
  id: K,
  label: string,
  sort: { id: K; dir: SortDir } | null,
  onToggle: (id: K) => void,
  resizeHandle?: ReactNode,
) {
  const active = sort?.id === id;
  const arrow = active ? (sort.dir === 1 ? ' ↑' : ' ↓') : '';
  return (
    <th key={id} scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className="relative p-0">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full truncate px-3 py-2 pr-5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}{arrow}
      </button>
      {resizeHandle}
    </th>
  );
}

function NoSelection({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-[500px] flex-col items-center justify-center px-6 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value?: ReactNode; mono?: boolean }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-all text-xs text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function Links({ links }: { links?: { rel?: string; href?: string }[] }) {
  if (!links?.length) return null;
  return <Field label="Links" value={links.map((l) => `${l.rel ?? 'link'}: ${l.href ?? '—'}`).join(' | ')} mono />;
}

function StatusBadge({ active }: { active?: boolean }) {
  if (active === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  return <Badge tone={active ? 'success' : 'muted'}>{active ? 'Active' : 'Inactive'}</Badge>;
}

function LinkButton({ label, children, onClick }: { label: string; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="rounded-sm font-mono text-xs text-primary underline decoration-primary/40 underline-offset-2 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </button>
  );
}

function displayName(names?: { name?: string; langCode?: string }[]): string {
  return names?.find((n) => n.langCode === 'en')?.name ?? names?.find((n) => n.name)?.name ?? '—';
}

function booleanLabel(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ? 'Yes' : 'No';
}
