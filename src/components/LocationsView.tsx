import { FormEvent, useMemo, useRef, useState } from 'react';
import { fetchAllLocations, searchLocations } from '../api/locationsApi';
import type { ConcurLocation, LocationQuery, LocationSearchResult } from '../types';
import countriesData from '../data/countries.json';
import subdivisionsData from '../data/subdivisions.json';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

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

export function LocationsView() {
  const [country, setCountry] = useState('');
  const [subdivision, setSubdivision] = useState('');
  const [city, setCity] = useState('');
  const [name, setName] = useState('');
  const [searching, setSearching] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LocationSearchResult | null>(null);
  const [lastQuery, setLastQuery] = useState<LocationQuery | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const searchSeq = useRef(0);

  const subdivisionOptions = useMemo(
    () => (country ? (subdivisions[country] ?? []) : []),
    [country],
  );

  const query: LocationQuery = {
    country: country || undefined,
    countrySubdivision: subdivision || undefined,
    city: city.trim() || undefined,
    name: name.trim() || undefined,
  };
  const canSearch = Boolean(query.country || query.countrySubdivision || query.city || query.name);
  const locations = result?.locations ?? [];
  const selected = locations.find((l) => locationKey(l) === selectedId) ?? null;

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSearch || searching) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    setError(null);
    setSelectedId(null);
    try {
      const firstPage = await searchLocations(query);
      if (seq !== searchSeq.current) return;
      setResult(firstPage);
      setLastQuery(query);
    } catch (err) {
      if (seq !== searchSeq.current) return;
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const loadAll = async () => {
    if (!lastQuery || loadingAll) return;
    const seq = searchSeq.current;
    setLoadingAll(true);
    setError(null);
    try {
      const all = await fetchAllLocations(lastQuery);
      if (seq !== searchSeq.current) return;
      setResult(all);
    } catch (err) {
      if (seq !== searchSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === searchSeq.current) setLoadingAll(false);
    }
  };

  return (
    <div>
      <form onSubmit={search} className="mb-3 flex max-w-5xl flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="location-country">Country/Region</label>
        <select
          id="location-country"
          aria-label="Country/Region"
          value={country}
          onChange={(event) => {
            setCountry(event.target.value);
            setSubdivision('');
          }}
          className="h-10 w-52 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Country/Region (any)</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
          ))}
        </select>

        <label className="sr-only" htmlFor="location-subdivision">Subdivision</label>
        <select
          id="location-subdivision"
          aria-label="Subdivision"
          value={subdivision}
          onChange={(event) => setSubdivision(event.target.value)}
          disabled={subdivisionOptions.length === 0}
          className="h-10 w-52 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">
            {country ? 'Subdivision (any)' : 'Subdivision (pick a country)'}
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
          onChange={(event) => setCity(event.target.value)}
          placeholder="City"
          className="h-10 w-40 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <label className="sr-only" htmlFor="location-name">Name</label>
        <input
          id="location-name"
          aria-label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <Button type="submit" size="sm" loading={searching} disabled={!canSearch} className="h-10 shrink-0">
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <section aria-label="Location search results" className="min-w-0">
          {result === null ? (
            <EmptyPanel
              title="Search Concur locations"
              message="Combine country, subdivision, city, and name filters (at least one). Select a location to inspect its details."
            />
          ) : locations.length === 0 ? (
            <EmptyPanel title="No locations found" message="Try different filters or broaden the query." />
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
                {locations.length} result{locations.length === 1 ? '' : 's'}
                {result.hasMore ? ' (first page)' : ''}
              </div>
              {result.hasMore && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <span>More locations match the current filters. Refine the filters or load all records.</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => void loadAll()} loading={loadingAll}>
                    {loadingAll ? 'Loading all…' : 'Load all'}
                  </Button>
                </div>
              )}
              <table className="w-full text-sm" aria-label="Location search results">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-2">Name</th>
                    <th scope="col" className="px-3 py-2">Subdivision</th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">Country</th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">IATA</th>
                    <th scope="col" className="px-3 py-2">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((location) => {
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
                            onClick={() => setSelectedId(key)}
                            className="rounded-sm text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {location.Name ?? '—'}
                          </button>
                        </td>
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
          )}
        </section>

        <LocationDetailsPanel location={selected} />
      </div>
    </div>
  );
}

function locationKey(location: ConcurLocation): string {
  return location.ID ?? location.LocationNameId ?? `${location.Name ?? ''}-${location.IATACode ?? ''}`;
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
    <aside aria-label="Location details" className="min-w-0 rounded-lg border bg-card p-4 shadow-sm">
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
