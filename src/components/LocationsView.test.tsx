import { render, screen, waitFor, within, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLocationsCsv, LocationsView } from './LocationsView';
import {
  getLocationsSearchSnapshot,
  resetLocationsSearchStore,
  startLocationsSearch,
  updateLocationsDraft,
} from './locationsSearchStore';
import type { LocationSearchResult } from '../types';

const { searchLocations, fetchAllLocations, refreshLocationsSnapshot } = vi.hoisted(() => ({
  searchLocations: vi.fn(),
  fetchAllLocations: vi.fn(),
  refreshLocationsSnapshot: vi.fn(),
}));

vi.mock('../api/locationsApi', () => ({
  searchLocations,
  fetchAllLocations,
  refreshLocationsSnapshot,
}));

const SEATAC = {
  ID: 'loc-1',
  Name: 'Seattle-Tacoma International Airport',
  Country: 'US',
  CountrySubdivision: 'US-WA',
  AdministrativeRegion: 'King County',
  IATACode: 'SEA',
  IsAirport: true,
  IsBookingTool: true,
  Latitude: 47.4435,
  Longitude: -122.3016,
  URI: 'https://us.api.concursolutions.com/api/v3.0/common/locations/loc-1',
  LocationNameId: 'guid-1',
  LocCode: 'USSEA',
};

const REDMOND = {
  ID: 'loc-2',
  Name: 'Redmond',
  Country: 'US',
  CountrySubdivision: 'US-WA',
  LocCode: 'USRED',
  IsAirport: false,
  IsBookingTool: false,
};

function result(locations: unknown[], hasMore = false): LocationSearchResult {
  return { locations: locations as LocationSearchResult['locations'], hasMore };
}

beforeEach(() => {
  resetLocationsSearchStore();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('LocationsView', () => {
  it('continues a search after unmount and restores the result when remounted', async () => {
    const user = userEvent.setup();
    let resolveSearch!: (value: LocationSearchResult) => void;
    searchLocations.mockImplementation(() => new Promise<LocationSearchResult>((resolve) => { resolveSearch = resolve; }));
    const firstMount = render(<LocationsView entityId="entity-a" />);

    await user.type(screen.getByLabelText('Name'), 'seattle');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/continues/i);
    firstMount.unmount();

    resolveSearch(result([SEATAC]));
    await waitFor(() => expect(getLocationsSearchSnapshot('entity-a').result?.locations).toHaveLength(1));

    render(<LocationsView entityId="entity-a" />);
    expect(screen.getByLabelText('Name')).toHaveValue('seattle');
    expect(await screen.findByText('Seattle-Tacoma International Airport')).toBeInTheDocument();
    expect(searchLocations).toHaveBeenCalledTimes(1);
  });

  it('keeps Entity search state isolated and ignores an older superseded result', async () => {
    let resolveFirst!: (value: LocationSearchResult) => void;
    let resolveSecond!: (value: LocationSearchResult) => void;
    searchLocations
      .mockImplementationOnce(() => new Promise<LocationSearchResult>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<LocationSearchResult>((resolve) => { resolveSecond = resolve; }));

    updateLocationsDraft('entity-a', { name: 'first' });
    const first = startLocationsSearch('entity-a');
    updateLocationsDraft('entity-a', { name: 'second' });
    const second = startLocationsSearch('entity-a');
    resolveSecond(result([REDMOND]));
    await second;
    resolveFirst(result([SEATAC]));
    await first;

    expect(getLocationsSearchSnapshot('entity-a').result?.locations[0].ID).toBe('loc-2');
    expect(getLocationsSearchSnapshot('entity-b').result).toBeNull();
    expect(getLocationsSearchSnapshot('entity-b').name).toBe('');
  });

  it('only aborts a background query when the user explicitly cancels it', async () => {
    const user = userEvent.setup();
    searchLocations.mockImplementation(() => new Promise<LocationSearchResult>(() => undefined));
    render(<LocationsView entityId="entity-a" />);
    await user.type(screen.getByLabelText('Name'), 'long-running');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    const signal = searchLocations.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await user.click(screen.getByRole('button', { name: /cancel query/i }));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });


  it('renders the combined filter bar with all four criteria and a disabled search', () => {
    render(<LocationsView />);
    expect(screen.getByLabelText('Country/Region')).toBeInTheDocument();
    expect(screen.getByLabelText('Subdivision')).toBeDisabled();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled();
    expect(screen.getByText(/search concur locations/i)).toBeInTheDocument();
  });

  it('accepts a typed country code, browses country suggestions, and filters subdivisions', async () => {
    const user = userEvent.setup();
    render(<LocationsView />);

    const country = screen.getByLabelText('Country/Region');
    expect(screen.getByRole('button', { name: /browse countries/i })).toBeInTheDocument();
    await user.type(country, 'us');
    expect(country).toHaveValue('US');
    const subdivision = screen.getByLabelText('Subdivision');
    expect(subdivision).toBeEnabled();
    expect(within(subdivision).getByRole('option', { name: /washington/i })).toHaveValue('US-WA');
    expect(within(subdivision).queryByRole('option', { name: /bayern/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();

    // Switching country clears the subdivision.
    await user.selectOptions(screen.getByLabelText('Subdivision'), 'US-WA');
    await user.clear(country);
    await user.type(country, 'DE');
    expect(screen.getByLabelText('Subdivision')).toHaveValue('');
    expect(within(screen.getByLabelText('Subdivision')).getByRole('option', { name: /bayern/i })).toHaveValue('DE-BY');
  });

  it('lets users browse and search countries by name before selecting a code', async () => {
    const user = userEvent.setup();
    render(<LocationsView />);

    await user.click(screen.getByRole('button', { name: /browse countries/i }));
    expect(screen.getByRole('dialog', { name: /browse countries/i })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /search countries/i }), 'china');
    expect(screen.getByRole('option', { name: /^cn.*china/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^us/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /^cn.*china/i }));

    expect(screen.getByLabelText('Country/Region')).toHaveValue('CN');
    expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();
    expect(screen.queryByRole('dialog', { name: /browse countries/i })).not.toBeInTheDocument();
  });

  it('searches with the combined filters and renders the result list', async () => {
    const user = userEvent.setup();
    searchLocations.mockResolvedValue(result([SEATAC, REDMOND]));
    render(<LocationsView />);

    await user.type(screen.getByLabelText('Country/Region'), 'US');
    await user.selectOptions(screen.getByLabelText('Subdivision'), 'US-WA');
    await user.type(screen.getByLabelText('City'), 'Sea');
    await user.type(screen.getByLabelText('Name'), 'port');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(searchLocations).toHaveBeenCalledWith(
      { country: 'US', countrySubdivision: 'US-WA', city: 'Sea', name: 'port' },
      expect.objectContaining({ onPhase: expect.any(Function) }),
    ));

    const table = await screen.findByRole('table', { name: /location search results/i });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Seattle-Tacoma International Airport')).toBeInTheDocument();
    expect(within(rows[0]).getByText('loc-1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('US-WA')).toBeInTheDocument();
    expect(within(rows[0]).getByText('USSEA')).toBeInTheDocument();
    expect(within(rows[0]).getByText('SEA')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Airport')).toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();

    const scrollRegion = screen.getByTestId('locations-results-scroll-region');
    expect(scrollRegion).toHaveClass('min-h-0', 'flex-1', 'overflow-auto');
    expect(table.querySelector('thead')).toHaveClass('sticky', 'top-0');
    expect(screen.getByRole('complementary', { name: /location details/i })).toHaveClass('xl:overflow-hidden');

    const nameResizeHandle = screen.getByRole('separator', { name: /resize name column/i });
    expect(nameResizeHandle).toHaveAttribute('aria-valuenow', '220');
    nameResizeHandle.focus();
    await user.keyboard('{ArrowRight}');
    expect(nameResizeHandle).toHaveAttribute('aria-valuenow', '236');
    Object.defineProperties(nameResizeHandle, {
      setPointerCapture: { value: vi.fn(), configurable: true },
      hasPointerCapture: { value: () => false, configurable: true },
    });
    fireEvent.pointerDown(nameResizeHandle, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(nameResizeHandle, { pointerId: 1, clientX: 140 });
    fireEvent.pointerUp(nameResizeHandle, { pointerId: 1, clientX: 140 });
    expect(nameResizeHandle).toHaveAttribute('aria-valuenow', '276');

    const paneResizeHandle = screen.getByRole('separator', { name: /resize location results and details/i });
    expect(paneResizeHandle).toHaveAttribute('aria-valuenow', '58');
    paneResizeHandle.focus();
    await user.keyboard('{End}');
    expect(paneResizeHandle).toHaveAttribute('aria-valuenow', '72');
  });

  it('sorts the result list by name and locCode in both directions', async () => {
    const user = userEvent.setup();
    searchLocations.mockResolvedValue(result([SEATAC, REDMOND]));
    render(<LocationsView />);
    await user.type(screen.getByLabelText('Name'), 'wa');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    const table = await screen.findByRole('table', { name: /location search results/i });
    const names = () => within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);
    const locCodes = () => within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[2].textContent);

    await user.click(within(table).getByRole('button', { name: 'Name' }));
    expect(names()).toEqual(['Redmond', 'Seattle-Tacoma International Airport']);
    await user.click(within(table).getByRole('button', { name: 'Name ↑' }));
    expect(names()).toEqual(['Seattle-Tacoma International Airport', 'Redmond']);

    await user.click(within(table).getByRole('button', { name: 'LocCode' }));
    expect(locCodes()).toEqual(['USRED', 'USSEA']);
    await user.click(within(table).getByRole('button', { name: 'LocCode ↑' }));
    expect(locCodes()).toEqual(['USSEA', 'USRED']);
  });

  it('builds an Excel-compatible CSV containing Location ID and locCode', () => {
    const csv = buildLocationsCsv([{ ...SEATAC, Name: 'Seattle, "Airport"' }]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('"Location ID"');
    expect(lines[0]).toContain('"LocCode"');
    expect(lines[1]).toContain('"loc-1"');
    expect(lines[1]).toContain('"USSEA"');
    expect(lines[1]).toContain('"Seattle, ""Airport"""');
  });

  it('enables CSV export only after a query returns rows', async () => {
    const user = userEvent.setup();
    searchLocations.mockResolvedValue(result([SEATAC]));
    render(<LocationsView />);
    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled();
    await user.type(screen.getByLabelText('Name'), 'seattle');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    expect(await screen.findByRole('button', { name: /export csv/i })).toBeEnabled();
  });

  it('shows the location details panel when a result row is selected', async () => {
    const user = userEvent.setup();
    searchLocations.mockResolvedValue(result([SEATAC]));
    render(<LocationsView />);
    await user.type(screen.getByLabelText('Name'), 'seattle');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    const row = await screen.findByText('Seattle-Tacoma International Airport');
    await user.click(row);

    const panel = screen.getByRole('complementary', { name: /location details/i });
    expect(within(panel).getByRole('heading', { name: 'Seattle-Tacoma International Airport' })).toBeInTheDocument();
    expect(within(panel).getByText('loc-1')).toBeInTheDocument();
    expect(within(panel).getByText(/United States of America \(US\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/Washington \(US-WA\)/)).toBeInTheDocument();
    expect(within(panel).getByText('King County')).toBeInTheDocument();
    expect(within(panel).getByText('SEA')).toBeInTheDocument();
    expect(within(panel).getByText('47.4435')).toBeInTheDocument();
    expect(within(panel).getByText('-122.3016')).toBeInTheDocument();
  });

  it('offers loading all records when more than one page exists', async () => {
    const user = userEvent.setup();
    searchLocations.mockResolvedValue(result([SEATAC], true));
    fetchAllLocations.mockResolvedValue(result([SEATAC, REDMOND], false));
    render(<LocationsView />);
    await user.type(screen.getByLabelText('Name'), 'a');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(screen.getByText(/more locations match/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /load all/i }));

    await waitFor(() => expect(fetchAllLocations).toHaveBeenCalledWith(
      { country: undefined, countrySubdivision: undefined, city: undefined, name: 'a' },
      expect.objectContaining({ onPhase: expect.any(Function) }),
    ));
    expect(await screen.findByText('Redmond')).toBeInTheDocument();
    expect(screen.queryByText(/more locations match/i)).not.toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();
  });

  it('shows an error alert when the search fails', async () => {
    const user = userEvent.setup();
    searchLocations.mockRejectedValue(new Error('HTTP 403 — Forbidden'));
    render(<LocationsView />);
    await user.type(screen.getByLabelText('Name'), 'x');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403 — Forbidden');
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    searchLocations.mockResolvedValue(result([]));
    render(<LocationsView />);
    await user.type(screen.getByLabelText('City'), 'Nowhere');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    expect(await screen.findByText(/no locations found/i)).toBeInTheDocument();
  });

  it('shows country snapshot status and refreshes it on demand', async () => {
    const user = userEvent.setup();
    searchLocations.mockResolvedValue({
      ...result([SEATAC]),
      source: 'cache',
      snapshotCountry: 'US',
      snapshotAt: '2026-08-12T08:00:00.000Z',
      snapshotStale: true,
      snapshotComplete: true,
    });
    refreshLocationsSnapshot.mockResolvedValue({
      ...result([SEATAC, REDMOND]),
      source: 'concur',
      snapshotCountry: 'US',
      snapshotAt: '2026-08-13T08:00:00.000Z',
      snapshotStale: false,
      snapshotComplete: true,
    });
    render(<LocationsView />);

    await user.type(screen.getByLabelText('Country/Region'), 'US');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByText(/using local us snapshot/i)).toBeInTheDocument();
    expect(screen.getByText(/older than 24 hours/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /refresh from concur/i }));

    await waitFor(() => expect(refreshLocationsSnapshot).toHaveBeenCalledWith(
      { country: 'US', countrySubdivision: undefined, city: undefined, name: undefined },
      expect.objectContaining({ onPhase: expect.any(Function) }),
    ));
    expect(await screen.findByText(/saved new us snapshot/i)).toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();
  });
});
