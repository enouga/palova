import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';

const row = {
  reservationId: 'r1', startTime: '2026-06-10T18:00:00Z', endTime: '2026-06-10T19:30:00Z',
  club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
  resourceName: 'Court 1', sport: { key: 'padel', name: 'Padel' },
  players: [
    { userId: 'u1', isOrganizer: true, firstName: 'A', lastName: 'A', avatarUrl: null, team: 1, slot: 0 },
    { userId: 'u2', isOrganizer: false, firstName: 'B', lastName: 'B', avatarUrl: null, team: 1, slot: 1 },
    { userId: 'u3', isOrganizer: false, firstName: 'C', lastName: 'C', avatarUrl: null, team: 2, slot: 0 },
    { userId: 'u4', isOrganizer: false, firstName: 'D', lastName: 'D', avatarUrl: null, team: 2, slot: 1 },
  ],
};

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: {
    getMatchesToRecord: jest.fn(),
    recordMatchResult: jest.fn().mockResolvedValue({ id: 'm1', status: 'PENDING' }),
  },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const wrap = (props = {}) => render(<ThemeProvider><ResultsToRecord token="t" {...props} /></ThemeProvider>);

beforeEach(() => (api.getMatchesToRecord as jest.Mock).mockReset());

it('n\'affiche rien quand la liste est vide', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([]);
  const { container } = wrap();
  await waitFor(() => expect(api.getMatchesToRecord).toHaveBeenCalled());
  expect(container.textContent).not.toContain('Résultat à saisir');
});

it('affiche une carte par match et filtre par club', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row, { ...row, reservationId: 'r2', club: { ...row.club, slug: 'autre' } }]);
  wrap({ clubSlug: 'arena' });
  await waitFor(() => expect(screen.getByText(/Court 1/)).toBeInTheDocument());
  expect(screen.getAllByText(/Résultat à saisir/)).toHaveLength(1);
});

it('ouvre la modale pré-remplie et masque la carte après enregistrement', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  const onRecorded = jest.fn();
  wrap({ onRecorded });
  await waitFor(() => expect(screen.getByText('Saisir')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Saisir'));
  expect(screen.getByText('Modifier les équipes')).toBeInTheDocument();
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  fireEvent.click(screen.getByText('Enregistrer'));
  await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
  expect(onRecorded).toHaveBeenCalled();
});
