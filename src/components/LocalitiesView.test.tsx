import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalitiesView } from './LocalitiesView';

const {
  getLocalityCountriesSnapshot,
  refreshLocalityCountries,
  getLocalityCountry,
  getLocalitySubdivisions,
  getLocalitySubdivision,
  searchLocalityLocations,
} = vi.hoisted(() => ({
  getLocalityCountriesSnapshot: vi.fn(),
  refreshLocalityCountries: vi.fn(),
  getLocalityCountry: vi.fn(),
  getLocalitySubdivisions: vi.fn(),
  getLocalitySubdivision: vi.fn(),
  searchLocalityLocations: vi.fn(),
}));

vi.mock('../api/localitiesApi', () => ({
  getLocalityCountriesSnapshot,
  refreshLocalityCountries,
  getLocalityCountry,
  getLocalitySubdivisions,
  getLocalitySubdivision,
  searchLocalityLocations,
}));

vi.mock('../api/listsApi', () => ({
  timeAgo: () => 'just now',
}));

const CN = {
  code: 'CN',
  active: true,
  alpha3Code: 'CHN',
  numCode: 156,
  distanceUnitCode: 'KM',
  names: [{ name: 'CHINA', langCode: 'en' }],
  currencies: [{ code: 'CNY' }],
  links: [{ rel: 'self', href: 'https://us2.api.concursolutions.com/localities/v5/countries/CN' }],
};

const US = {
  code: 'US',
  active: true,
  names: [{ name: 'UNITED STATES', langCode: 'en' }],
  currencies: [{ code: 'USD' }],
};

const SH = {
  code: 'CN-SH',
  active: true,
  countryCode: 'CN',
  names: [{ name: 'Shanghai', langCode: 'en' }],
  links: [{ rel: 'country', href: 'https://us2.api.concursolutions.com/localities/v5/countries/CN' }],
};

const BJ = {
  code: 'CN-11',
  active: true,
  countryCode: 'CN',
  names: [{ name: 'Beijing', langCode: 'en' }],
};

const SHANGHAI = {
  code: 'CNSHA',
  id: 'loc-1',
  active: true,
  timeZoneOffset: 480,
  point: { latitude: 31.2304, longitude: 121.4737 },
  names: [{ name: 'Shanghai', langCode: 'en' }],
  country: CN,
  subDivision: SH,
  links: [{ rel: 'self', href: 'https://us2.api.concursolutions.com/localities/v5/locations/loc-1' }],
};

const MUNICH = {
  code: 'DEMUC',
  id: 'loc-2',
  active: true,
  names: [{ name: 'Munich', langCode: 'en' }],
  country: { code: 'DE', names: [{ name: 'GERMANY', langCode: 'en' }] },
  subDivision: { code: 'DE-BY', names: [{ name: 'Bayern', langCode: 'en' }], countryCode: 'DE' },
};

beforeEach(() => {
  vi.clearAllMocks();
  getLocalityCountriesSnapshot.mockResolvedValue({
    retrievedAt: '2026-08-11T00:00:00.000Z',
    countries: [CN, US],
  });
});

afterEach(cleanup);

describe('LocalitiesView', () => {
  it('loads and displays cached countries, then refreshes the snapshot on demand', async () => {
    const user = userEvent.setup();
    refreshLocalityCountries.mockResolvedValue({
      retrievedAt: '2026-08-11T01:00:00.000Z',
      countries: [CN],
    });

    render(<LocalitiesView />);

    expect(screen.getByRole('tab', { name: 'Countries/Regions' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByText(/2 countries\/regions/)).toBeInTheDocument());
    expect(screen.getAllByText('CHINA').length).toBeGreaterThan(0);
    expect(screen.getByText('CNY')).toBeInTheDocument();
    expect(screen.getByTestId('locality-countries-results-scroll-region')).toHaveClass('min-h-0', 'flex-1', 'overflow-auto');
    expect(screen.getByRole('table', { name: /locality countries\/regions/i }).querySelector('thead')).toHaveClass('sticky', 'top-0');
    const countryNameResizeHandle = screen.getByRole('separator', { name: /resize name column/i });
    expect(countryNameResizeHandle).toHaveAttribute('aria-valuenow', '360');
    countryNameResizeHandle.focus();
    await user.keyboard('{ArrowLeft}');
    expect(countryNameResizeHandle).toHaveAttribute('aria-valuenow', '344');

    await user.click(screen.getByRole('button', { name: /refresh countries\/regions/i }));
    await waitFor(() => expect(refreshLocalityCountries).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/1 country\/region/)).toBeInTheDocument();
  });

  it('opens a country details dialog from the country list', async () => {
    const user = userEvent.setup();
    render(<LocalitiesView />);

    await waitFor(() => expect(screen.getByText('CHINA')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /view country\/region CN by name/i }));

    const dialog = screen.getByRole('dialog', { name: /country\/region CN/i });
    expect(within(dialog).getByText('CHN')).toBeInTheDocument();
    expect(within(dialog).queryByText('Links')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /view subdivisions for CN/i })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /locality country\/region details/i })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: /view country\/region CN by code/i }));
    expect(screen.getByRole('dialog', { name: /country\/region CN/i })).toBeInTheDocument();
  });

  it('sorts countries/regions by code and name in both directions', async () => {
    const user = userEvent.setup();
    render(<LocalitiesView />);

    const table = await screen.findByRole('table', { name: /locality countries\/regions/i });
    const columnValues = (colIndex: number) =>
      within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[colIndex].textContent);

    expect(columnValues(0)).toEqual(['CN', 'US']);

    await user.click(within(table).getByRole('button', { name: 'Code ↑' }));
    expect(columnValues(0)).toEqual(['US', 'CN']);
    expect(within(table).getByRole('columnheader', { name: /code/i })).toHaveAttribute('aria-sort', 'descending');

    await user.click(within(table).getByRole('button', { name: 'Name' }));
    expect(columnValues(1)).toEqual(['CHINA', 'UNITED STATES']);
    await user.click(within(table).getByRole('button', { name: 'Name ↑' }));
    expect(columnValues(1)).toEqual(['UNITED STATES', 'CHINA']);
  });

  it('searches one country/region by country code and filters the result list', async () => {
    const user = userEvent.setup();
    getLocalityCountry.mockResolvedValue(CN);
    render(<LocalitiesView />);

    await user.clear(screen.getByLabelText('Country code'));
    await user.type(screen.getByLabelText('Country code'), 'cn');
    await user.click(screen.getByRole('button', { name: /lookup country/i }));

    await waitFor(() => expect(getLocalityCountry).toHaveBeenCalledWith('CN'));
    expect(screen.getByText(/1 country\/region/)).toBeInTheDocument();
    expect(screen.getAllByText('CHINA').length).toBeGreaterThan(0);
    expect(screen.queryByText('UNITED STATES')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /view country\/region CN by name/i }));
    const dialog = screen.getByRole('dialog', { name: /country\/region CN/i });
    expect(within(dialog).getByText('CN')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /view subdivisions for CN/i }));
    expect(screen.getByRole('tab', { name: 'Subdivisions' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(getLocalitySubdivisions).toHaveBeenCalledWith('CN'));
  });

  it('searches subdivisions by country and links back to the country tab', async () => {
    const user = userEvent.setup();
    getLocalitySubdivisions.mockResolvedValue([SH]);
    getLocalityCountry.mockResolvedValue(CN);
    render(<LocalitiesView />);

    await user.click(screen.getByRole('tab', { name: 'Subdivisions' }));
    await user.click(screen.getByRole('button', { name: 'Browse countries' }));
    await user.type(screen.getByLabelText('Search countries'), 'China');
    await user.click(screen.getByRole('option', { name: /CN.*China/i }));
    expect(screen.getByLabelText('Subdivision country code')).toHaveValue('CN');
    await user.click(screen.getByRole('button', { name: /list subdivisions/i }));

    await waitFor(() => expect(getLocalitySubdivisions).toHaveBeenCalledWith('CN'));
    await user.click(screen.getByRole('button', { name: /country CN/i }));

    expect(screen.getByRole('tab', { name: 'Countries/Regions' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(getLocalityCountry).toHaveBeenCalledWith('CN'));
  });

  it('sorts subdivisions by code and name in both directions', async () => {
    const user = userEvent.setup();
    getLocalitySubdivisions.mockResolvedValue([SH, BJ]);
    render(<LocalitiesView />);

    await user.click(screen.getByRole('tab', { name: 'Subdivisions' }));
    await user.type(screen.getByLabelText('Subdivision country code'), 'CN');
    await user.click(screen.getByRole('button', { name: /list subdivisions/i }));

    const table = await screen.findByRole('table', { name: /locality subdivisions/i });
    expect(screen.getByTestId('locality-subdivisions-results-scroll-region')).toHaveClass('min-h-0', 'flex-1', 'overflow-auto');
    expect(table.querySelector('thead')).toHaveClass('sticky', 'top-0');
    const columnValues = (colIndex: number) =>
      within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[colIndex].textContent);

    expect(columnValues(0)).toEqual(['CN-SH', 'CN-11']);
    await user.click(within(table).getByRole('button', { name: 'Code' }));
    expect(columnValues(0)).toEqual(['CN-11', 'CN-SH']);
    await user.click(within(table).getByRole('button', { name: 'Name' }));
    expect(columnValues(1)).toEqual(['Beijing', 'Shanghai']);
    await user.click(within(table).getByRole('button', { name: 'Name ↑' }));
    expect(columnValues(1)).toEqual(['Shanghai', 'Beijing']);
  });

  it('searches a subdivision by code and opens subdivision details in a dialog from the list', async () => {
    const user = userEvent.setup();
    getLocalitySubdivision.mockResolvedValue(SH);
    render(<LocalitiesView />);

    await user.click(screen.getByRole('tab', { name: 'Subdivisions' }));
    await user.type(screen.getByLabelText('Subdivision code'), 'cn-sh');
    await user.click(screen.getByRole('button', { name: /lookup subdivision/i }));

    await waitFor(() => expect(getLocalitySubdivision).toHaveBeenCalledWith('cn-sh'));
    expect((await screen.findAllByText('Shanghai')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /view subdivision CN-SH by code/i }));
    const dialog = screen.getByRole('dialog', { name: /subdivision CN-SH/i });
    expect(within(dialog).getByText('Shanghai')).toBeInTheDocument();
    expect(within(dialog).queryByText('Links')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /locality subdivision details/i })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: /view subdivision CN-SH by name/i }));
    const reopenedDialog = screen.getByRole('dialog', { name: /subdivision CN-SH/i });
    expect(reopenedDialog).toBeInTheDocument();

    await user.click(within(reopenedDialog).getByRole('button', { name: /view locations for CN-SH/i }));
    expect(screen.getByRole('tab', { name: 'Locations' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Location country/region')).toHaveValue('CN');
    expect(screen.getByLabelText('Location subdivision')).toHaveValue('CN-SH');
  });

  it('searches localities by filters and follows country/subdivision links from the result', async () => {
    const user = userEvent.setup();
    searchLocalityLocations.mockResolvedValue([SHANGHAI]);
    getLocalityCountry.mockResolvedValue(CN);
    getLocalitySubdivision.mockResolvedValue(SH);
    render(<LocalitiesView />);

    await user.click(screen.getByRole('tab', { name: 'Locations' }));
    await user.type(screen.getByLabelText('Location country/region'), 'CN');
    await user.type(screen.getByLabelText('Search text'), 'Shanghai');
    await user.click(screen.getByRole('button', { name: /search localities/i }));

    await waitFor(() => expect(searchLocalityLocations).toHaveBeenCalledWith({
      countryCode: 'CN',
      subdivisionCode: undefined,
      searchText: 'Shanghai',
      locCode: undefined,
    }));
    expect(await screen.findByText('CNSHA')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /subdivision CN-SH/i }));
    expect(screen.getByRole('tab', { name: 'Subdivisions' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(getLocalitySubdivision).toHaveBeenCalledWith('CN-SH'));

    await user.click(screen.getByRole('tab', { name: 'Locations' }));
    await user.click(screen.getByRole('button', { name: /country CN/i }));
    expect(screen.getByRole('tab', { name: 'Countries/Regions' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(getLocalityCountry).toHaveBeenCalledWith('CN'));
  });

  it('sorts locations by name, locCode, country, and subdivision', async () => {
    const user = userEvent.setup();
    searchLocalityLocations.mockResolvedValue([SHANGHAI, MUNICH]);
    render(<LocalitiesView />);

    await user.click(screen.getByRole('tab', { name: 'Locations' }));
    await user.type(screen.getByLabelText('Search text'), 'city');
    await user.click(screen.getByRole('button', { name: /search localities/i }));

    const table = await screen.findByRole('table', { name: /locality locations/i });
    expect(screen.getByTestId('locality-locations-results-scroll-region')).toHaveClass('min-h-0', 'flex-1', 'overflow-auto');
    expect(table.querySelector('thead')).toHaveClass('sticky', 'top-0');
    expect(screen.getByRole('complementary', { name: /locality location details/i })).toHaveClass('overflow-hidden');
    const paneResizeHandle = screen.getByRole('separator', { name: /resize locality results and details/i });
    paneResizeHandle.focus();
    await user.keyboard('{Home}');
    expect(paneResizeHandle).toHaveAttribute('aria-valuenow', '38');
    const columnValues = (colIndex: number) =>
      within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[colIndex].textContent);

    expect(columnValues(0)).toEqual(['Shanghai', 'Munich']);
    await user.click(within(table).getByRole('button', { name: 'Name' }));
    expect(columnValues(0)).toEqual(['Munich', 'Shanghai']);
    await user.click(within(table).getByRole('button', { name: 'Name ↑' }));
    expect(columnValues(0)).toEqual(['Shanghai', 'Munich']);

    await user.click(within(table).getByRole('button', { name: /loccode/i }));
    expect(columnValues(1)).toEqual(['CNSHA', 'DEMUC']);

    await user.click(within(table).getByRole('button', { name: 'Country' }));
    expect(columnValues(2)).toEqual(['CN', 'DE']);

    await user.click(within(table).getByRole('button', { name: 'Subdivision' }));
    expect(columnValues(3)).toEqual(['CN-SH', 'DE-BY']);
  });

  it('makes locCode lookup mutually exclusive with other location filters', async () => {
    const user = userEvent.setup();
    searchLocalityLocations.mockResolvedValue([SHANGHAI]);
    render(<LocalitiesView />);

    await user.click(screen.getByRole('tab', { name: 'Locations' }));
    await user.type(screen.getByLabelText('Location country/region'), 'CN');
    await user.type(screen.getByLabelText('Search text'), 'Shanghai');
    await user.type(screen.getByLabelText('LocCode'), 'cnsha');

    expect(screen.getByLabelText('Location country/region')).toBeDisabled();
    expect(screen.getByLabelText('Location subdivision')).toBeDisabled();
    expect(screen.getByLabelText('Search text')).toBeDisabled();
    expect(screen.getByLabelText('Location country/region')).toHaveValue('');
    expect(screen.getByLabelText('Search text')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: /search localities/i }));

    await waitFor(() => expect(searchLocalityLocations).toHaveBeenCalledWith({
      countryCode: undefined,
      subdivisionCode: undefined,
      searchText: undefined,
      locCode: 'cnsha',
    }));
  });

  it('browses and filters location countries by country name before applying a code', async () => {
    const user = userEvent.setup();
    render(<LocalitiesView />);

    await user.click(screen.getByRole('tab', { name: 'Locations' }));
    await user.click(screen.getByRole('button', { name: /browse location countries/i }));
    expect(screen.getByRole('dialog', { name: /browse location countries/i })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /search location countries/i }), 'china');
    const china = screen.getByRole('option', { name: /^cn.*china/i });
    expect(china).toBeInTheDocument();
    await user.click(china);

    expect(screen.getByLabelText('Location country/region')).toHaveValue('CN');
    expect(screen.getByLabelText('Location subdivision')).toBeEnabled();
    expect(screen.queryByRole('dialog', { name: /browse location countries/i })).not.toBeInTheDocument();
  });

  it('shows validation errors for invalid searchText and locCode', async () => {
    const user = userEvent.setup();
    render(<LocalitiesView />);

    await user.click(screen.getByRole('tab', { name: 'Locations' }));
    await user.type(screen.getByLabelText('Search text'), 'Shanghai~');
    await user.click(screen.getByRole('button', { name: /search localities/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/special characters/i);
    expect(searchLocalityLocations).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Search text'));
    await user.type(screen.getByLabelText('LocCode'), 'CN SHA');
    await user.click(screen.getByRole('button', { name: /search localities/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/letters, numbers, hyphen, or underscore/i);
    expect(searchLocalityLocations).not.toHaveBeenCalled();
  });
});
