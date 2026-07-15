import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsSports } from '@/components/admin/settings/SettingsSports';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1' } }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '' }) }) }));
jest.mock('@/lib/api', () => ({
  api: {
    adminGetSports: jest.fn(),
    getSports: jest.fn(),
    adminAddSport: jest.fn().mockResolvedValue({}),
    adminUpdateClubSport: jest.fn().mockResolvedValue({}),
  },
}));
import { api } from '@/lib/api';
const mocked = api as jest.Mocked<typeof api>;

const ENABLED = [{ id: 'cs1', sport: { id: 'padel', name: 'Padel', defaultDurationsMin: [90] }, durationsMin: [90] }];
const CATALOG = [
  { id: 'padel', name: 'Padel', defaultDurationsMin: [90] },
  { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
];

describe('SettingsSports', () => {
  beforeEach(() => {
    (mocked.adminGetSports as jest.Mock).mockResolvedValue(ENABLED);
    (mocked.getSports as jest.Mock).mockResolvedValue(CATALOG);
    (mocked.adminAddSport as jest.Mock).mockClear();
    (mocked.adminUpdateClubSport as jest.Mock).mockClear();
  });

  it('lists enabled sports with durations and catalog sports to add', async () => {
    render(<SettingsSports />);
    expect(await screen.findByText('Padel')).toBeInTheDocument();
    expect(screen.getByText('Proposés par le club')).toBeInTheDocument();
    // Durées cochables du padel : 30 min, 1 h, 1 h 30, 2 h.
    expect(screen.getByRole('button', { name: '1 h 30' })).toBeInTheDocument();
    // Tennis (non activé) est proposé à l'ajout.
    expect(screen.getByRole('button', { name: /Tennis/ })).toBeInTheDocument();
  });

  it('adds a catalog sport', async () => {
    render(<SettingsSports />);
    fireEvent.click(await screen.findByRole('button', { name: /Tennis/ }));
    await waitFor(() => expect(mocked.adminAddSport).toHaveBeenCalledWith('c1', 'tennis', 't'));
  });

  it('toggles a duration (immediate save)', async () => {
    render(<SettingsSports />);
    // « 1 h » est OFF (seul 90 est actif) → un clic l'ajoute.
    fireEvent.click(await screen.findByRole('button', { name: '1 h' }));
    await waitFor(() => expect(mocked.adminUpdateClubSport).toHaveBeenCalledWith('c1', 'cs1', [60, 90], 't'));
  });
});
