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
import countriesData from '../data/countries.json';
import subdivisionsData from '../data/subdivisions.json';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { TabPanel, Tabs } from './ui/Tabs';

type LocalitiesTab = 'countries' | 'subdivisions' | 'locations';
type SortDir = 1 | -1;

interface CountryOption {
  code: string;
  name: string;
}

interface SubdivisionOption {
  code: string;
  name: string;
}

const countries = countriesData as CountryOption[];
const subdivisions = subdivisionsData as Record<string, SubdivisionOption[]>;
const SEARCH_TEXT_SPECIAL_CHARS = /[~!@#$%^&]/;
const LOC_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

const tabs = [
  { id: 'countries', label: 'Countries/Regions' },
  { id: 'subdivisions', label: 'Subdivisions' },
  { id: 'locations', label: 'Locations' },
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
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

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
    setError(null);
    try {
      setSnapshot(await refreshLocalityCountries());
      setCountryRowsOverride(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const run = async (fn: () => Promise<void>) => {
    const runSeq = ++seq.current;
    setWorking(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (runSeq === seq.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (runSeq === seq.current) setWorking(false);
    }
  };

  const showCountry = async (code: string) => {
    setActive('countries');
    setCountryCode(code);
    await run(async () => {
      const country = await getLocalityCountry(code);
      setCountryRowsOverride([country]);
    });
  };

  const showSubdivisionsForCountry = async (code: string) => {
    setActive('subdivisions');
    setSubdivisionCountryCode(code);
    setSubdivisionCode('');
    setCountryDialog(null);
    await run(async () => {
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
    await run(async () => {
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
    await run(async () => {
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
    await run(async () => {
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
    <div>
      <Tabs tabs={tabs} active={active} onChange={(id) => setActive(id as LocalitiesTab)} />

      {error && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {active === 'countries' && (
        <TabPanel>
          <CountriesTab
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
        </TabPanel>
      )}

      {active === 'subdivisions' && (
        <TabPanel>
          <SubdivisionsTab
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
        </TabPanel>
      )}

      {active === 'locations' && (
        <TabPanel>
          <LocationsTab
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
        </TabPanel>
      )}
    </div>
  );
}

function CountriesTab({
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
  const sortedRows = useMemo(() => sortRows(rows, sort.id, sort.dir, (country, id) => (
    id === 'code' ? country.code : displayName(country.names)
  )), [rows, sort]);
  const toggleSort = (id: 'code' | 'name') => setSort((s) => (s.id === id ? { id, dir: s.dir === 1 ? -1 : 1 } : { id, dir: 1 }));
  return (
    <>
      <section className="min-w-0" aria-label="Locality countries/regions">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <form onSubmit={onLookupCountry} className="flex items-center gap-2">
            <input
              aria-label="Country code"
              value={countryCode}
              onChange={(event) => onCountryCodeChange(event.target.value)}
              placeholder="CN"
              className="h-10 w-32 rounded-md border border-input bg-card px-3 text-sm uppercase text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" size="sm" loading={working} disabled={!countryCode.trim()}>
              Lookup country
            </Button>
          </form>
          <Button type="button" size="sm" variant="outline" loading={refreshing} onClick={onRefreshCountries}>
            Refresh countries/regions
          </Button>
        </div>
        {snapshotLoading ? (
          <EmptyPanel title="Loading countries/regions" message="Reading the local countries/regions snapshot." />
        ) : !snapshot && !rowsOverride ? (
          <EmptyPanel title="No countries/regions snapshot" message="Refresh countries/regions to cache Localities v5 country data for this entity." />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
              {sortedRows.length} countr{sortedRows.length === 1 ? 'y/region' : 'ies/regions'}{snapshot ? ` · retrieved ${timeAgo(snapshot.retrievedAt)}` : ''}
            </div>
            <table className="w-full text-sm" aria-label="Locality countries/regions">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {sortHeader('code', 'Code', sort, toggleSort)}
                  {sortHeader('name', 'Name', sort, toggleSort)}
                  <th scope="col" className="px-3 py-2">Currency</th>
                  <th scope="col" className="px-3 py-2">Status</th>
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
  const sortedRows = useMemo(() => (
    sort ? sortRows(rows ?? [], sort.id, sort.dir, (sub, id) => (id === 'code' ? sub.code : displayName(sub.names))) : (rows ?? [])
  ), [rows, sort]);
  const toggleSort = (id: 'code' | 'name') => setSort((s) => (s?.id === id ? { id, dir: s.dir === 1 ? -1 : 1 } : { id, dir: 1 }));
  return (
    <>
      <section className="min-w-0" aria-label="Locality subdivisions">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <form onSubmit={onList} className="flex items-center gap-2">
            <input aria-label="Subdivision country code" value={countryCode} onChange={(event) => onCountryCodeChange(event.target.value.toUpperCase())} placeholder="AU" className="h-10 w-36 rounded-md border border-input bg-card px-3 text-sm uppercase shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <Button type="submit" size="sm" loading={working} disabled={!countryCode.trim()}>List subdivisions</Button>
          </form>
          <form onSubmit={onLookup} className="flex items-center gap-2">
            <input aria-label="Subdivision code" value={subdivisionCode} onChange={(event) => onSubdivisionCodeChange(event.target.value)} placeholder="AU-QLD" className="h-10 w-40 rounded-md border border-input bg-card px-3 text-sm uppercase shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <Button type="submit" size="sm" variant="outline" loading={working} disabled={!subdivisionCode.trim()}>Lookup subdivision</Button>
          </form>
        </div>
        {!rows ? (
          <EmptyPanel title="Search subdivisions" message="List all subdivisions for a country code, or look up a specific ISO 3166-2 subdivision code." />
        ) : sortedRows.length === 0 ? (
          <EmptyPanel title="No subdivisions found" message="Try another country or subdivision code." />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">{sortedRows.length} subdivision{sortedRows.length === 1 ? '' : 's'}</div>
            <table className="w-full text-sm" aria-label="Locality subdivisions">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {sortHeader('code', 'Code', sort, toggleSort)}
                  {sortHeader('name', 'Name', sort, toggleSort)}
                  <th scope="col" className="px-3 py-2">Country</th>
                  <th scope="col" className="px-3 py-2">Status</th>
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
      <section className="min-w-0" aria-label="Locality locations">
        <form onSubmit={onSearch} className="mb-3 flex max-w-5xl flex-wrap items-center gap-2">
          <select aria-label="Location country/region" value={countryCode} onChange={(event) => onCountryChange(event.target.value)} disabled={locCodeMode} className="h-10 w-52 rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
            <option value="">Country/Region (any)</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
          </select>
          <select aria-label="Location subdivision" value={subdivisionCode} onChange={(event) => onSubdivisionChange(event.target.value)} disabled={locCodeMode || !subdivisionOptions.length} className="h-10 w-52 rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
            <option value="">{countryCode ? 'Subdivision (any)' : 'Subdivision (pick a country)'}</option>
            {displaySubdivisionOptions.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
          </select>
          <input aria-label="Search text" value={searchText} onChange={(event) => onSearchTextChange(event.target.value)} disabled={locCodeMode} placeholder="Search text" className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" />
          <input aria-label="LocCode" value={locCode} onChange={(event) => onLocCodeChange(event.target.value)} placeholder="LocCode" className="h-10 w-32 rounded-md border border-input bg-card px-3 text-sm uppercase shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <Button type="submit" size="sm" loading={working} disabled={!searchText.trim() && !locCode.trim()}>Search localities</Button>
        </form>
        {!rows ? (
          <EmptyPanel title="Search localities" message="Use search text with optional country/subdivision filters, or look up a specific locCode." />
        ) : sortedRows.length === 0 ? (
          <EmptyPanel title="No localities found" message="Try another search text, locCode, or filter combination." />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">{sortedRows.length} localit{sortedRows.length === 1 ? 'y' : 'ies'}</div>
            <table className="w-full text-sm" aria-label="Locality locations">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {sortHeader('name', 'Name', sort, toggleSort)}
                  {sortHeader('locCode', 'LocCode', sort, toggleSort)}
                  {sortHeader('country', 'Country', sort, toggleSort)}
                  {sortHeader('subdivision', 'Subdivision', sort, toggleSort)}
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
        )}
      </section>
      <LocationDetails location={selected} onCountryClick={onCountryClick} onSubdivisionClick={onSubdivisionClick} />
    </div>
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
    <aside aria-label="Locality location details" className="min-w-0 rounded-lg border bg-card p-4 shadow-sm">
      {!location ? <NoSelection title="No locality selected" message="Choose a locality from the search results to inspect details." /> : (
        <div className="space-y-3">
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
) {
  const active = sort?.id === id;
  const arrow = active ? (sort.dir === 1 ? ' ↑' : ' ↓') : '';
  return (
    <th key={id} scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className="p-0">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full px-3 py-2 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}{arrow}
      </button>
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

function NoSelection({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center text-center">
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
