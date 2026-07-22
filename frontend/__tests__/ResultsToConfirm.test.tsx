import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ResultsToConfirm } from '@/components/match/ResultsToConfirm';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: { getMatchesToConfirm: jest.fn(), confirmMatch: jest.fn(), disputeMatch: jest.fn() },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const row = {
  matchId: 'm1', playedAt: '2026-07-20T18:00:00Z', sets: [[6, 4], [6, 2]],
  competitive: true, confirmDeadline: '2026-07-23T18:00:00Z',
  club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
  resourceName: 'Court 1',
  players: [
    { userId: 'u1', firstName: 'Lucas', lastName: 'Moreau', avatarUrl: null, team: 1 },
    { userId: 'u2', firstName: 'Jean', lastName: 'Dupont', avatarUrl: null, team: 1 },
    { userId: 'u3', firstName: 'Celine', lastName: 'Barbier', avatarUrl: null, team: 2 },
    { userId: 'u4', firstName: 'Melanie', lastName: 'Bernard', avatarUrl: null, team: 2 },
  ],
};

const wrap = (props = {}) => render(<ThemeProvider><ResultsToConfirm token="t" {...props} /></ThemeProvider>);

beforeEach(() => {
  (api.getMatchesToConfirm as jest.Mock).mockReset();
  (api.confirmMatch as jest.Mock).mockReset().mockResolvedValue({ ok: true });
  (api.disputeMatch as jest.Mock).mockReset().mockResolvedValue({ ok: true });
});

it('n\'affiche rien quand la liste est vide', async () => {
  (api.getMatchesToConfirm as jest.Mock).mockResolvedValue([]);
  const { container } = wrap();
  await waitFor(() => expect(api.getMatchesToConfirm).toHaveBeenCalled());
  expect(container.textContent).not.toContain('confirmer');
});

it('regroupe les matchs dans une seule carte (en-tête compté) et filtre par club', async () => {
  (api.getMatchesToConfirm as jest.Mock).mockResolvedValue([
    row,
    { ...row, matchId: 'm2' },
    { ...row, matchId: 'm3', club: { ...row.club, slug: 'autre' } },
  ]);
  wrap({ clubSlug: 'arena' });
  await waitFor(() => expect(screen.getByText('Résultats à confirmer · 2')).toBeInTheDocument());
});

it('titre singulier quand un seul match', async () => {
  (api.getMatchesToConfirm as jest.Mock).mockResolvedValue([row]);
  wrap();
  await waitFor(() => expect(screen.getByText('Résultat à confirmer')).toBeInTheDocument());
});

it('affiche les deux équipes, le score et la chip Pour le fun si amicale', async () => {
  (api.getMatchesToConfirm as jest.Mock).mockResolvedValue([{ ...row, competitive: false }]);
  wrap();
  await waitFor(() => expect(screen.getByText('Lucas & Jean')).toBeInTheDocument());
  expect(screen.getByText('Celine & Melanie')).toBeInTheDocument();
  expect(screen.getByText(/6-4, 6-2/)).toBeInTheDocument();
  expect(screen.getByText('Pour le fun')).toBeInTheDocument();
});

it('confirmer appelle l\'API et rafraîchit', async () => {
  (api.getMatchesToConfirm as jest.Mock)
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([]);
  const onChanged = jest.fn();
  wrap({ onChanged });
  await waitFor(() => expect(screen.getByText('Confirmer')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Confirmer'));
  await waitFor(() => expect(api.confirmMatch).toHaveBeenCalledWith('m1', 't'));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(api.getMatchesToConfirm).toHaveBeenCalledTimes(2);
});

it('contester déplie le motif, bloque l\'envoi vide, envoie et referme', async () => {
  (api.getMatchesToConfirm as jest.Mock)
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([]);
  wrap();
  await waitFor(() => expect(screen.getByText('Contester')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Contester'));
  const send = screen.getByLabelText('Envoyer la contestation');
  expect(send).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText(/Expliquez le litige/), { target: { value: 'Le score est faux' } });
  expect(send).not.toBeDisabled();
  fireEvent.click(send);
  await waitFor(() => expect(api.disputeMatch).toHaveBeenCalledWith('m1', 'Le score est faux', 't'));
  await waitFor(() => expect(screen.queryByLabelText('Envoyer la contestation')).not.toBeInTheDocument());
});
