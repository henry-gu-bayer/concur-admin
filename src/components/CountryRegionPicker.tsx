import { useEffect, useMemo, useRef, useState } from 'react';
import countriesData from '../data/countries.json';

interface CountryOption { code: string; name: string }
const countries = countriesData as CountryOption[];
const frequentCountryCodes = ['US', 'CN'];
const frequentCountries = frequentCountryCodes.map((code) => countries.find((country) => country.code === code)).filter((country): country is CountryOption => Boolean(country));

export function CountryRegionPicker({
  value,
  disabled = false,
  onChange,
  fieldLabel = 'Location country/region',
  fieldId = 'country-region',
  widthClass = 'w-64',
}: {
  value: string;
  disabled?: boolean;
  onChange: (code: string) => void;
  fieldLabel?: string;
  fieldId?: string;
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [lookup, setLookup] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const normalizedValue = value.trim().toUpperCase();
  const browserSubject = fieldLabel === 'Location country/region' ? 'location countries' : 'countries';
  const matchingCountries = useMemo(() => {
    const term = lookup.trim().toLocaleLowerCase();
    if (!term) return countries;
    return countries.filter(({ code, name }) => code.toLocaleLowerCase().includes(term) || name.toLocaleLowerCase().includes(term));
  }, [lookup]);

  useEffect(() => {
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setLookup('');
      }
    };
    document.addEventListener('mousedown', closeOnOutsidePress);
    return () => document.removeEventListener('mousedown', closeOnOutsidePress);
  }, []);

  const chooseCountry = (code: string) => {
    onChange(code);
    setOpen(false);
    setLookup('');
  };

  return (
    <div ref={pickerRef} className={`relative shrink-0 ${widthClass}`}>
      <label className="sr-only" htmlFor={fieldId}>{fieldLabel}</label>
      <div className="flex h-10 overflow-hidden rounded-md border border-input bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring disabled:opacity-50">
        <input id={fieldId} aria-label={fieldLabel} aria-describedby={`${fieldId}-help`} aria-controls={`${fieldId}-menu`} aria-expanded={open} value={value} disabled={disabled}
          onFocus={() => setOpen(true)} onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); setLookup(''); } }}
          onChange={(event) => { onChange(event.target.value.toUpperCase()); setOpen(true); }} placeholder="e.g. CN" maxLength={2} autoCapitalize="characters"
          className="min-w-0 flex-1 bg-transparent px-3 text-sm uppercase text-foreground placeholder:normal-case placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed" />
        <button type="button" aria-label={open ? `Close ${browserSubject}` : `Browse ${browserSubject}`} aria-expanded={open} disabled={disabled}
          onClick={() => { setOpen((current) => !current); setLookup(''); }}
          className="border-l border-input px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">Browse</button>
      </div>
      <span id={`${fieldId}-help`} className="sr-only">Enter a two-letter country code such as CN or US, or browse and search the country list.</span>
      {open && !disabled ? (
        <div id={`${fieldId}-menu`} role="dialog" aria-label={`Browse ${browserSubject}`} className="absolute z-20 mt-1 w-80 overflow-hidden rounded-md border border-input bg-card shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-semibold text-foreground">Browse countries</p>
            <input aria-label={`Search ${browserSubject}`} value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="Search by country name or code" className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
          <div className="max-h-64 overflow-y-auto py-1" role="listbox" aria-label={`${fieldLabel} suggestions`}>
            {!lookup ? <><p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">Frequent</p>{frequentCountries.map((country) => <CountryOptionRow key={country.code} {...country} selected={country.code === normalizedValue} onSelect={() => chooseCountry(country.code)} />)}<div className="my-1 border-t border-border" /><p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">All countries</p></> : null}
            {matchingCountries.length ? matchingCountries.filter(({ code }) => lookup || !frequentCountryCodes.includes(code)).map((country) => <CountryOptionRow key={country.code} {...country} selected={country.code === normalizedValue} onSelect={() => chooseCountry(country.code)} />) : <p className="px-3 py-5 text-center text-sm text-muted-foreground">No matching countries</p>}
          </div>
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Enter a two-letter code directly, or choose a country above.</p>
        </div>
      ) : null}
    </div>
  );
}

function CountryOptionRow({ code, name, selected, onSelect }: CountryOption & { selected: boolean; onSelect: () => void }) {
  return <button type="button" role="option" aria-selected={selected} onClick={onSelect} className={`grid w-full grid-cols-[3rem_1fr] items-center px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none ${selected ? 'bg-primary/10 text-primary' : 'text-foreground'}`}><span className="font-mono text-xs font-semibold">{code}</span><span>{name}</span></button>;
}
