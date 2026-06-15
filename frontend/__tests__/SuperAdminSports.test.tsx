import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuperAdminSportsPage from '../app/superadmin/sports/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const platformListSports = jest.fn();
const platformSetSportPublished = jest.fn();
jest.mock('../lib/api', () => ({
  api: {
    platformListSports: (...a: unknown[]) => platformListSports(...a),
    platformSetSportPublished: (...a: unknown[]) => platformSetSportPublished(...a),
    platformCreateSport: jest.fn(),
    platformUpdateSport: jest.fn(),
    platformDeleteSport: jest.fn(),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));

const sport = (over: Record<string, unknown>) => ({
  id: 's1', key: 'padel', name: 'Padel', resourceNoun: 'terrain',
  defaultSlotStepMin: 30, defaultDurationsMin: [90], icon: '🎾', surfaces: [], published: true, ...over,
});

function renderPage() {
  return render(<ThemeProvider><SuperAdminSportsPage /></ThemeProvider>);
}

beforeEach(() => { jest.clearAllMocks(); });

it('affiche le badge Brouillon + bouton Publier pour un sport non publié, et publie au clic', async () => {
  platformListSports.mockResolvedValue([sport({ id: 's2', name: 'Beach', published: false })]);
  platformSetSportPublished.mockResolvedValue(sport({ id: 's2', name: 'Beach', published: true }));
  renderPage();
  expect(await screen.findByText('Brouillon')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Publier' }));
  await waitFor(() => expect(platformSetSportPublished).toHaveBeenCalledWith('s2', true, 'tok'));
});

it('affiche « Dépublier » pour un sport publié', async () => {
  platformListSports.mockResolvedValue([sport({ name: 'Padel', published: true })]);
  renderPage();
  expect(await screen.findByRole('button', { name: 'Dépublier' })).toBeInTheDocument();
  expect(screen.queryByText('Brouillon')).not.toBeInTheDocument();
});
