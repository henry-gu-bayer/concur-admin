import { ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getActiveEntityId } from '../entities/entityStore';
import type { ConcurLocation, LocationQuery } from '../types';
import countriesData from '../data/countries.json';
import subdivisionsData from '../data/subdivisions.json';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ColumnResizeHandle, ResizableDetailLayout, useColumnWidths } from './ui/Resizable';
import {
  cancelLocationsTask,
  exportLocationResults,
  getLocationsSearchSnapshot,
  loadAllLocationResults,
  refreshLocationResults,
  selectLocation,
  setLocationsSort,
  startLocationsSearch,
  subscribeLocationsSearch,
  updateLocationsDraft,
} from './locationsSearchStore';

export { buildLocationsCsv } from './locationsCsv';

interface CountryOption {
  code: string;
  name: string;
}

interface SubdivisionOption {
  code: string;
  name: string;
  type?: string;
}

const countries = countriesData as CountryOption[];
const subdivisions = subdivisionsData as Record<string, SubdivisionOption[]>;
const countryNameByCode = new Map(countries.map((c) => [c.code, c.name]));
const frequentCountryCodes = ['US', 'CN'];
const locationColumnDefaults = [220, 250, 120, 130, 90, 80, 90] as const;

export function LocationsView({ entityId = getActiveEntityId() }: { entityId?: string }) {
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countryLookup, setCountryLookup] = useState('');
  const subscribe = useCallback((listener: () => void) => subscribeLocationsSearch(entityId, listener), [entityId]);
  const getSnapshot = useCallback(() => getLocationsSearchSnapshot(entityId), [entityId]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { country, subdivision, city, name, result, selectedId, sort, action, phase, error } = state;
  const searching = action === 'search';
  const loadingAll = action === 'load-all';
  const exportingCsv = action === 'export';
  const refreshingSnapshot = action === 'refresh';

  const countryPickerRef = useRef<HTMLDivElement>(null);
  const countryCode = country.trim().toUpperCase();
  const countryCodeIsValid = !countryCode || /^[A-Z]{2}$/.test(countryCode);

  const matchingCountries = useMemo(() => {
    const lookup = countryLookup.trim().toLocaleLowerCase();
    if (!lookup) return countries;
    return countries.filter(({ code, name }) => (
      code.toLocaleLowerCase().includes(lookup) || name.toLocaleLowerCase().includes(lookup)
    ));
  }, [countryLookup]);

  const frequentCountries = useMemo(
    () => frequentCountryCodes.map((code) => countries.find((countryOption) => countryOption.code === code)).filter((countryOption): countryOption is CountryOption => Boolean(countryOption)),
    [],
  );

  useEffect(() => {
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (!countryPickerRef.current?.contains(event.target as Node)) {
        setCountryPickerOpen(false);
        setCountryLookup('');
      }
    };
    document.addEventListener('mousedown', closeOnOutsidePress);
    return () => document.removeEventListener('mousedown', closeOnOutsidePress);
  }, []);

  const subdivisionOptions = useMemo(
    () => (countryCode ? (subdivisions[countryCode] ?? []) : []),
    [countryCode],
  );

  const query: LocationQuery = {
    country: countryCode || undefined,
    countrySubdivision: subdivision || undefined,
    city: city.trim() || undefined,
    name: name.trim() || undefined,
  };
  const canSearch = countryCodeIsValid && Boolean(query.country || query.countrySubdivision || query.city || query.name);
  const locations = result?.locations ?? [];
  const sortedLocations = useMemo(() => sortLocationRows(locations, sort), [locations, sort]);
  const selected = locations.find((l) => locationKey(l) === selectedId) ?? null;
  const columns = useColumnWidths(locationColumnDefaults);
  const toggleSort = (id: 'name' | 'locCode') => setLocationsSort(entityId, (
    sort?.id === id ? { id, dir: sort.dir === 1 ? -1 : 1 } : { id, dir: 1 }
  ));

  return (
    <div className="xl:flex xl:h-full xl:min-h-0 xl:flex-col">
      <form onSubmit={(event) => { event.preventDefault(); if (canSearch && !searching) void startLocationsSearch(entityId); }} className="mb-3 flex max-w-5xl flex-wrap items-center gap-2">
        <div ref={countryPickerRef} className="relative w-64 shrink-0">
          <label className="sr-only" htmlFor="location-country">Country / region code</label>
          <div className="flex h-10 overflow-hidden rounded-md border border-input bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <input
              id="location-country"
              aria-label="Country/Region"
              aria-describedby="location-country-help"
              aria-controls="location-country-menu"
              aria-expanded={countryPickerOpen}
              value={country}
              onFocus={() => setCountryPickerOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setCountryPickerOpen(false);
                  setCountryLookup('');
                }
              }}
              onChange={(event) => {
                updateLocationsDraft(entityId, { country: event.target.value.toUpperCase(), subdivision: '' });
                setCountryPickerOpen(true);
              }}
              placeholder="e.g. CN"
              maxLength={2}
              autoCapitalize="characters"
              className="min-w-0 flex-1 bg-transparent px-3 text-sm uppercase text-foreground placeholder:normal-case placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="button"
              aria-label={countryPickerOpen ? 'Close country browser' : 'Browse countries'}
              aria-expanded={countryPickerOpen}
              onClick={() => {
                setCountryPickerOpen((open) => !open);
                setCountryLookup('');
              }}
              className="border-l border-input px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              Browse
            </button>
          </div>
          <span id="location-country-help" className="sr-only">Enter a two-letter country code such as CN or US, or browse and search the country list.</span>
          {countryPickerOpen && (
            <div id="location-country-menu" role="dialog" aria-label="Browse countries" className="absolute z-20 mt-1 w-80 overflow-hidden rounded-md border border-input bg-card shadow-lg">
              <div className="border-b border-border px-3 py-2">
                <p className="text-sm font-semibold text-foreground">Browse countries</p>
                <input
                  aria-label="Search countries"
                  value={countryLookup}
                  onChange={(event) => setCountryLookup(event.target.value)}
                  placeholder="Search by country name or code"
                  className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="max-h-64 overflow-y-auto py-1" role="listbox" aria-label="Country suggestions">
                {!countryLookup && (
                  <>
                    <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">Frequent</p>
                    {frequentCountries.map(({ code, name }) => (
                      <CountryOptionRow
                        key={code}
                        code={code}
                        name={name}
                        selected={code === countryCode}
                        onSelect={() => {
                          updateLocationsDraft(entityId, { country: code, subdivision: '' });
                          setCountryPickerOpen(false);
                          setCountryLookup('');
                        }}
                      />
                    ))}
                    <div className="my-1 border-t border-border" />
                    <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">All countries</p>
                  </>
                )}
                {matchingCountries.length > 0 ? matchingCountries.filter(({ code }) => countryLookup || !frequentCountryCodes.includes(code)).map(({ code, name }) => (
                  <CountryOptionRow
                    key={code}
                    code={code}
                    name={name}
                    selected={code === countryCode}
                    onSelect={() => {
                      updateLocationsDraft(entityId, { country: code, subdivision: '' });
                      setCountryPickerOpen(false);
                      setCountryLookup('');
                    }}
                  />
                )) : (
                  <p className="px-3 py-5 text-center text-sm text-muted-foreground">No matching countries</p>
                )}
              </div>
              <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Enter a two-letter code directly, or choose a country above.</p>
            </div>
          )}
        </div>

        <label className="sr-only" htmlFor="location-subdivision">Subdivision</label>
        <select
          id="location-subdivision"
          aria-label="Subdivision"
          value={subdivision}
          onChange={(event) => updateLocationsDraft(entityId, { subdivision: event.target.value })}
          disabled={subdivisionOptions.length === 0}
          className="h-10 w-52 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">
            {countryCode ? 'Subdivision (any)' : 'Subdivision (enter a country code)'}
          </option>
          {subdivisionOptions.map((s) => (
            <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
          ))}
        </select>

        <label className="sr-only" htmlFor="location-city">City</label>
        <input
          id="location-city"
          aria-label="City"
          value={city}
          onChange={(event) => updateLocationsDraft(entityId, { city: event.target.value })}
          placeholder="City"
          className="h-10 w-40 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <label className="sr-only" htmlFor="location-name">Name</label>
        <input
          id="location-name"
          aria-label="Name"
          value={name}
          onChange={(event) => updateLocationsDraft(entityId, { name: event.target.value })}
          placeholder="Name"
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <Button type="submit" size="sm" loading={searching} disabled={!canSearch} className="h-10 shrink-0">
          {searching ? 'Searching…' : 'Search'}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={locations.length === 0} loading={exportingCsv} onClick={() => void exportLocationResults(entityId)} className="h-10 shrink-0">
          {exportingCsv ? 'Preparing CSV…' : 'Export CSV'}
        </Button>
      </form>

      {action && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary" role="status">
          <span>
            {phase === 'matching-localities'
              ? 'Matching Localities v5 records… You can switch to another feature while this continues.'
              : action === 'export'
                ? 'Preparing the complete CSV export… You can switch to another feature while this continues.'
                : 'Retrieving Locations v3 data… You can switch to another feature while this continues.'}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => cancelLocationsTask(entityId)}>Cancel query</Button>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {result?.snapshotCountry && (
        <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-2 text-xs ${result.snapshotStale || result.snapshotComplete === false ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'}`}>
          <span>
            {result.source === 'cache' ? 'Using local' : 'Saved new'} {result.snapshotCountry} snapshot
            {result.snapshotAt ? ` from ${new Date(result.snapshotAt).toLocaleString()}` : ''}.
            {result.snapshotStale ? ' Snapshot is older than 24 hours.' : ''}
            {result.snapshotComplete === false ? ' Snapshot is incomplete because the pagination safety limit was reached.' : ''}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void refreshLocationResults(entityId)} loading={refreshingSnapshot}>
            {refreshingSnapshot ? 'Refreshing…' : 'Refresh from Concur'}
          </Button>
        </div>
      )}

      <ResizableDetailLayout
        label="Resize location results and details"
        list={(
        <section aria-label="Location search results" className="min-w-0 xl:h-full xl:min-h-0">
          {result === null ? (
            <EmptyPanel
              title="Search Concur locations"
              message="Combine country, subdivision, city, and name filters (at least one). Select a location to inspect its details."
            />
          ) : locations.length === 0 ? (
            <EmptyPanel title="No locations found" message="Try different filters or broaden the query." />
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
                {locations.length} result{locations.length === 1 ? '' : 's'}
                {result.hasMore ? ' (first page)' : ''}
              </div>
              {result.hasMore && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <span>More locations match the current filters. Refine the filters or load all records.</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => void loadAllLocationResults(entityId)} loading={loadingAll}>
                    {loadingAll ? 'Loading all…' : 'Load all'}
                  </Button>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto" data-testid="locations-results-scroll-region">
                <table className="text-sm [&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap" style={{ width: columns.totalWidth, minWidth: '100%', tableLayout: 'fixed' }} aria-label="Location search results">
                <colgroup>
                  {columns.widths.map((width, index) => <col key={index} style={{ width }} />)}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <SortableHeader id="name" label="Name" sort={sort} onToggle={toggleSort} resizeHandle={<ColumnResizeHandle label="Name" width={columns.widths[0]} minWidth={120} onChange={(width) => columns.setWidth(0, width)} onReset={() => columns.resetWidth(0)} />} />
                    <th scope="col" className="relative px-3 py-2">Location ID<ColumnResizeHandle label="Location ID" width={columns.widths[1]} minWidth={140} onChange={(width) => columns.setWidth(1, width)} onReset={() => columns.resetWidth(1)} /></th>
                    <SortableHeader id="locCode" label="LocCode" sort={sort} onToggle={toggleSort} resizeHandle={<ColumnResizeHandle label="LocCode" width={columns.widths[2]} minWidth={88} onChange={(width) => columns.setWidth(2, width)} onReset={() => columns.resetWidth(2)} />} />
                    <th scope="col" className="relative px-3 py-2">Subdivision<ColumnResizeHandle label="Subdivision" width={columns.widths[3]} minWidth={96} onChange={(width) => columns.setWidth(3, width)} onReset={() => columns.resetWidth(3)} /></th>
                    <th scope="col" className="relative hidden px-3 py-2 md:table-cell">Country<ColumnResizeHandle label="Country" width={columns.widths[4]} minWidth={72} onChange={(width) => columns.setWidth(4, width)} onReset={() => columns.resetWidth(4)} /></th>
                    <th scope="col" className="relative hidden px-3 py-2 md:table-cell">IATA<ColumnResizeHandle label="IATA" width={columns.widths[5]} minWidth={64} onChange={(width) => columns.setWidth(5, width)} onReset={() => columns.resetWidth(5)} /></th>
                    <th scope="col" className="relative px-3 py-2">Type<ColumnResizeHandle label="Type" width={columns.widths[6]} minWidth={72} onChange={(width) => columns.setWidth(6, width)} onReset={() => columns.resetWidth(6)} /></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLocations.map((location) => {
                    const key = locationKey(location);
                    const isSelected = key === selectedId;
                    return (
                      <tr
                        key={key}
                        aria-selected={isSelected}
                        className={`border-b last:border-0 hover:bg-accent/40 ${isSelected ? 'bg-accent/60' : ''}`}
                      >
                        <td className="px-3 py-2 text-xs font-medium text-foreground">
                          <button
                            type="button"
                            onClick={() => selectLocation(entityId, key)}
                            className="rounded-sm text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {location.Name ?? '—'}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{location.ID ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{location.LocCode ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{location.CountrySubdivision ?? '—'}</td>
                        <td className="hidden px-3 py-2 font-mono text-xs text-muted-foreground md:table-cell">{location.Country ?? '—'}</td>
                        <td className="hidden px-3 py-2 font-mono text-xs text-muted-foreground md:table-cell">{location.IATACode ?? '—'}</td>
                        <td className="px-3 py-2">
                          {location.IsAirport ? <Badge tone="primary">Airport</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
        )}
        detail={<LocationDetailsPanel location={selected} />}
      />
    </div>
  );
}

function CountryOptionRow({ code, name, selected, onSelect }: { code: string; name: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={`grid w-full grid-cols-[3rem_1fr] items-center px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none ${selected ? 'bg-primary/10 text-primary' : 'text-foreground'}`}
    >
      <span className="font-mono text-xs font-semibold">{code}</span>
      <span>{name}</span>
    </button>
  );
}

function locationKey(location: ConcurLocation): string {
  return location.ID ?? location.LocationNameId ?? `${location.Name ?? ''}-${location.IATACode ?? ''}`;
}

function sortLocationRows(
  locations: ConcurLocation[],
  sort: { id: 'name' | 'locCode'; dir: 1 | -1 } | null,
): ConcurLocation[] {
  if (!sort) return locations;
  return [...locations].sort((a, b) => {
    const aValue = sort.id === 'name' ? (a.Name ?? '') : (a.LocCode ?? '');
    const bValue = sort.id === 'name' ? (b.Name ?? '') : (b.LocCode ?? '');
    return aValue.localeCompare(bValue) * sort.dir;
  });
}

function SortableHeader({
  id,
  label,
  sort,
  onToggle,
  resizeHandle,
}: {
  id: 'name' | 'locCode';
  label: string;
  sort: { id: 'name' | 'locCode'; dir: 1 | -1 } | null;
  onToggle: (id: 'name' | 'locCode') => void;
  resizeHandle?: ReactNode;
}) {
  const active = sort?.id === id;
  return (
    <th scope="col" aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'} className="relative p-0">
      <button type="button" onClick={() => onToggle(id)} className="w-full truncate px-3 py-2 pr-5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {label}{active ? (sort!.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
      {resizeHandle}
    </th>
  );
}

function EmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function LocationDetailsPanel({ location }: { location: ConcurLocation | null }) {
  return (
    <aside aria-label="Location details" className="min-w-0 rounded-lg border bg-card p-4 shadow-sm xl:h-full xl:min-h-0 xl:overflow-hidden">
      {!location ? (
        <div className="flex min-h-56 flex-col items-center justify-center text-center">
          <h2 className="text-base font-semibold">No location selected</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Choose a location from the search results to inspect its details.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex min-w-0 items-baseline gap-x-2">
            <h2 className="min-w-0 break-all text-sm font-semibold text-foreground">{location.Name ?? 'Unnamed location'}</h2>
            {location.ID && <p className="shrink-0 break-all font-mono text-xs text-muted-foreground">{location.ID}</p>}
          </div>
          <dl className="grid gap-1.5">
            <Field label="Country" value={countryLabel(location.Country)} />
            <Field label="Subdivision" value={subdivisionLabel(location.CountrySubdivision)} />
            <Field label="Region" value={location.AdministrativeRegion} />
            <Field label="IATA code" value={location.IATACode} mono />
            <Field label="LocCode" value={location.LocCode} mono />
            <Field label="Airport" value={booleanLabel(location.IsAirport)} />
            <Field label="Booking tool" value={booleanLabel(location.IsBookingTool)} />
            <Field label="Latitude" value={location.Latitude} mono />
            <Field label="Longitude" value={location.Longitude} mono />
            <Field label="Location name ID" value={location.LocationNameId} mono />
            <Field label="URI" value={location.URI} mono />
          </dl>
        </div>
      )}
    </aside>
  );
}

function Field({ label, value, mono = false }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-all text-xs text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function countryLabel(code?: string): string | undefined {
  if (!code) return undefined;
  const name = countryNameByCode.get(code);
  return name ? `${name} (${code})` : code;
}

function subdivisionLabel(code?: string): string | undefined {
  if (!code) return undefined;
  const countryCode = code.split('-')[0];
  const entry = subdivisions[countryCode]?.find((s) => s.code === code);
  return entry ? `${entry.name} (${code})` : code;
}

function booleanLabel(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ? 'Yes' : 'No';
}
