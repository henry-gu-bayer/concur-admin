import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationsView } from './LocationsView';
import type { LocationSearchResult } from '../types';

const { searchLocations, fetchAllLocations } = vi.hoisted(() => ({
  searchLocations: vi.fn(),
  fetchAllLocations: vi.fn(),
}));

vi.mock('../api/locationsApi', () => ({
  searchLocations,
  fetchAllLocations,
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
};

const REDMOND = {
  ID: 'loc-2',
  Name: 'Redmond',
  Country: 'US',
  CountrySubdivision: 'US-WA',
  IsAirport: false,
  IsBookingTool: false,
};

function result(locations: unknown[], hasMore = false): LocationSearchResult {
  return { locations: locations as LocationSearchResult['locations'], hasMore };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('LocationsView', () => {
  it('renders the combined filter bar with all four criteria and a disabled search', () => {
    render(<LocationsView />);
    expect(screen.getByLabelText('Country/Region')).toBeInTheDocument();
    expect(screen.getByLabelText('Subdivision')).toBeDisabled();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled();
    expect(screen.getByText(/search concur locations/i)).toBeInTheDocument();
  });

  it('filters subdivision options by the selected country and enables search with any single criterion', async () => {
    const user = userEvent.setup();
    render(<LocationsView />);

    await user.selectOptions(screen.getByLabelText('Country/Region'), 'US');
    const subdivision = screen.getByLabelText('Subdivision');
    expect(subdivision).toBeEnabled();
    expect(within(subdivision).getByRole('option', { name: /washington/i })).toHaveValue('US-WA');
    expect(within(subdivision).queryByRole('option', { name: /bayern/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();

    // Switching country clears the subdivision.
    await user.selectOptions(screen.getByLabelText('Subdivision'), 'US-WA');
    await user.selectOptions(screen.getByLabelText('Country/Region'), 'DE');
    expect(screen.getByLabelText('Subdivision')).toHaveValue('');
    expect(within(screen.getByLabelText('Subdivision')).getByRole('option', { name: /bayern/i })).toHaveValue('DE-BY');
  });

  it('searches with the combined filters and renders the result list', async () => {
    const user = userEvent.setup();
    searchLocations.mockResolvedValue(result([SEATAC, REDMOND]));
    render(<LocationsView />);

    await user.selectOptions(screen.getByLabelText('Country/Region'), 'US');
    await user.selectOptions(screen.getByLabelText('Subdivision'), 'US-WA');
    await user.type(screen.getByLabelText('City'), 'Sea');
    await user.type(screen.getByLabelText('Name'), 'port');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(searchLocations).toHaveBeenCalledWith({
      country: 'US', countrySubdivision: 'US-WA', city: 'Sea', name: 'port',
    }));

    const table = await screen.findByRole('table', { name: /location search results/i });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Seattle-Tacoma International Airport')).toBeInTheDocument();
    expect(within(rows[0]).getByText('US-WA')).toBeInTheDocument();
    expect(within(rows[0]).getByText('SEA')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Airport')).toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();
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

    await waitFor(() => expect(fetchAllLocations).toHaveBeenCalledWith({ country: undefined, countrySubdivision: undefined, city: undefined, name: 'a' }));
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
});
