import type { ConcurLocation } from '../types';

const CSV_COLUMNS: { header: string; value: (location: ConcurLocation) => string | number | boolean | undefined }[] = [
  { header: 'Location ID', value: (location) => location.ID },
  { header: 'Name', value: (location) => location.Name },
  { header: 'LocCode', value: (location) => location.LocCode },
  { header: 'City', value: (location) => location.City },
  { header: 'Country', value: (location) => location.Country },
  { header: 'Country Subdivision', value: (location) => location.CountrySubdivision },
  { header: 'Administrative Region', value: (location) => location.AdministrativeRegion },
  { header: 'IATA Code', value: (location) => location.IATACode },
  { header: 'Is Airport', value: (location) => location.IsAirport },
  { header: 'Is Booking Tool', value: (location) => location.IsBookingTool },
  { header: 'Latitude', value: (location) => location.Latitude },
  { header: 'Longitude', value: (location) => location.Longitude },
  { header: 'Location Name ID', value: (location) => location.LocationNameId },
  { header: 'URI', value: (location) => location.URI },
];

function csvCell(value: string | number | boolean | undefined): string {
  const text = value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildLocationsCsv(locations: ConcurLocation[]): string {
  const header = CSV_COLUMNS.map((column) => csvCell(column.header)).join(',');
  const rows = locations.map((location) => CSV_COLUMNS.map((column) => csvCell(column.value(location))).join(','));
  return [header, ...rows].join('\r\n');
}

export function downloadLocationsCsv(locations: ConcurLocation[]): void {
  if (locations.length === 0) return;
  const blob = new Blob([`\uFEFF${buildLocationsCsv(locations)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `concur-locations-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
