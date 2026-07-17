import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';

// Modale stubée : découple la carte du pavé de saisie (testé séparément).
jest.mock('@/components/match/MatchResultModal', () => ({
  __esModule: true,
  MatchResultModal: ({ onSaved }: { onSaved: () => void }) => (
    <button onClick={onSaved}>stub-save</button>
  ),
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: { getMatchesToRecord: jest.fn() },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const row = {
  reservationId: 'r1', startTime: '2026-06-10T18:00:00Z', endTime: '2026-06-10T19:30:00Z',
  club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
  resourceName: 'Court 1', sport: { key: 'padel', name: 'Padel' },
  players: [
    { userId: 'u1', isOrganizer: true, firstName: 'Lucas', lastName: 'Moreau', avatarUrl: null, team: 1, slot: 0 },
    { userId: 'u2', isOrganizer: false, firstName: 'Jean', lastName: 'Dupont', avatarUrl: null, team: 1, slot: 1 },
    { userId: 'u3', isOrganizer: false, firstName: 'Celine', lastName: 'Barbier', avatarUrl: null, team: 2, slot: 0 },
    { userId: 'u4', isOrganizer: false, firstName: 'Melanie', lastName: 'Bernard', avatarUrl: null, team: 2, slot: 1 },
  ],
};

const wrap = (props = {}) => render(<ThemeProvider><ResultsToRecord token="t" {...props} /></ThemeProvider>);

beforeEach(() => (api.getMatchesToRecord as jest.Mock).mockReset());

it('n\'affiche rien quand la liste est vide', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([]);
  const { container } = wrap();
  await waitFor(() => expect(api.getMatchesToRecord).toHaveBeenCalled());
  expect(container.textContent).not.toContain('Résultat');
});

it('regroupe les matchs dans une seule carte (en-tête compté) et filtre par club', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([
    row,
    { ...row, reservationId: 'r2', resourceName: 'Court 6' },
    { ...row, reservationId: 'r3', club: { ...row.club, slug: 'autre' } },
  ]);
  wrap({ clubSlug: 'arena' });
  await waitFor(() => expect(screen.getByText('Résultats à saisir · 2')).toBeInTheDocument());
  expect(screen.getByText(/Court 1 ·/)).toBeInTheDocument();
  expect(screen.getByText(/Court 6 ·/)).toBeInTheDocument();
  expect(screen.getAllByText('Saisir')).toHaveLength(2);
});

it('titre singulier quand un seul match', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  wrap();
  await waitFor(() => expect(screen.getByText('Résultat à saisir')).toBeInTheDocument());
});

it('affiche les deux équipes en prénoms avec le séparateur vs', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  wrap();
  await waitFor(() => expect(screen.getByText('Lucas & Jean')).toBeInTheDocument());
  expect(screen.getByText('Celine & Melanie')).toBeInTheDocument();
  expect(screen.getByText('vs')).toBeInTheDocument();
});

it('pas de chip Compétitive sur la carte (défaut), chip Amicale si competitive=false', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row, { ...row, reservationId: 'r2', competitive: false }]);
  wrap();
  await waitFor(() => expect(screen.getByText('Amicale')).toBeInTheDocument());
  expect(screen.queryByText('Compétitive')).not.toBeInTheDocument();
});

it('ouvre la modale au clic sur Saisir et se rafraîchit après enregistrement', async () => {
  (api.getMatchesToRecord as jest.Mock)
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([]);
  const onRecorded = jest.fn();
  wrap({ onRecorded });
  await waitFor(() => expect(screen.getByText('Saisir')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Saisir'));
  fireEvent.click(screen.getByText('stub-save'));
  await waitFor(() => expect(onRecorded).toHaveBeenCalled());
  expect(api.getMatchesToRecord).toHaveBeenCalledTimes(2);
});
