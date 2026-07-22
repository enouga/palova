import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MyMatchesList } from '@/components/match/MyMatchesList';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  assetUrl: () => null,
  api: {
    confirmMatch: jest.fn().mockResolvedValue({ ok: true }),
    disputeMatch: jest.fn().mockResolvedValue({ ok: true }),
    remindMatch: jest.fn().mockResolvedValue({ reminded: 1 }),
    getMatchComments: jest.fn().mockResolvedValue({ status: 'DISPUTED', comments: [] }),
  },
}));
import { api } from '@/lib/api';

const renderWithTheme = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

const base = {
  matchId: 'm1', reservationId: 'r1', status: 'PENDING',
  sets: [[6, 4], [6, 3]] as [number, number][],
  playedAt: '2026-06-20T16:30:00Z', confirmDeadline: new Date(Date.now() + 3 * 86400000).toISOString(), winningTeam: 1, myTeam: 2,
  myConfirmation: 'PENDING', ratingAfter: null, needsMyConfirmation: true,
  club: { name: 'Padel Arena Paris' }, sport: { name: 'Padel' },
  resource: { name: 'Court 2' },
  players: [
    { userId: 'u1', team: 2, firstName: 'Eric', lastName: 'Nougayrede', isMe: true, confirmation: 'CONFIRMED' },
    { userId: 'u2', team: 2, firstName: 'Marie', lastName: 'Durand', isMe: false, confirmation: 'CONFIRMED' },
    { userId: 'u3', team: 1, firstName: 'Paul', lastName: 'Roy', isMe: false, confirmation: 'PENDING' },
    { userId: 'u4', team: 1, firstName: 'Lea', lastName: 'Martin', isMe: false, confirmation: 'PENDING' },
  ],
};
const matches = [base];

it('affiche le tableau de score, partenaire, adversaires, club et terrain', async () => {
  const onChanged = jest.fn();
  renderWithTheme(<MyMatchesList matches={matches as any} token="t" onChanged={onChanged} />);
  // Tableau de score : ma ligne (équipe 2) → 4 et 3 ; adversaires (équipe 1) → 6 et 6.
  expect(screen.getByText('Vous')).toBeInTheDocument();
  expect(screen.getAllByText('6')).toHaveLength(2);
  expect(screen.getByText('4')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText(/Marie Durand/)).toBeInTheDocument();
  expect(screen.getByText(/Paul Roy/)).toBeInTheDocument();
  expect(screen.getByText(/Lea Martin/)).toBeInTheDocument();
  expect(screen.getByText(/Padel Arena Paris/)).toBeInTheDocument();
  expect(screen.getByText(/Court 2/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Confirmer'));
  await waitFor(() => expect(api.confirmMatch).toHaveBeenCalledWith('m1', 't'));
  expect(onChanged).toHaveBeenCalled();
});

it('un match sans confirmation requise ne montre pas les boutons', () => {
  renderWithTheme(<MyMatchesList matches={[{ ...base, needsMyConfirmation: false }] as any} token="t" onChanged={() => {}} />);
  expect(screen.queryByText('Confirmer')).toBeNull();
});

it('marque un résultat pour le fun (competitive=false)', () => {
  renderWithTheme(<MyMatchesList matches={[{ ...base, competitive: false }] as any} token="t" onChanged={() => {}} />);
  expect(screen.getByText('Pour le fun')).toBeInTheDocument();
});

it('un match pour de vrai ne montre pas « Pour le fun »', () => {
  renderWithTheme(<MyMatchesList matches={[{ ...base, competitive: true }] as any} token="t" onChanged={() => {}} />);
  expect(screen.queryByText('Pour le fun')).toBeNull();
});

it('affiche Victoire quand mon équipe gagne', () => {
  renderWithTheme(<MyMatchesList matches={[{ ...base, status: 'CONFIRMED', winningTeam: 2, needsMyConfirmation: false }] as any} token="t" onChanged={() => {}} />);
  expect(screen.getByText('Victoire')).toBeInTheDocument();
});

it('le « Contester » exige un motif avant envoi', async () => {
  renderWithTheme(<MyMatchesList matches={[{ ...base }] as any} token="t" onChanged={() => {}} />);
  fireEvent.click(screen.getByText('Contester'));
  const send = screen.getByRole('button', { name: 'Envoyer la contestation' });
  expect(send).toBeDisabled(); // désactivé tant que le motif est vide
  fireEvent.change(screen.getByPlaceholderText(/Expliquez le litige/i), { target: { value: 'Score faux' } });
  expect(send).not.toBeDisabled();
  fireEvent.click(send);
  await waitFor(() => expect(api.disputeMatch).toHaveBeenCalledWith('m1', 'Score faux', 't'));
});

it('un match en litige propose la discussion', () => {
  const disputed = { ...base, status: 'DISPUTED', needsMyConfirmation: false, commentCount: 2 };
  renderWithTheme(<MyMatchesList matches={[disputed] as any} token="t" onChanged={() => {}} />);
  expect(screen.getByText(/Discussion/)).toBeInTheDocument();
});

it('affiche le compteur de validations et le compte à rebours d auto-validation', () => {
  renderWithTheme(<MyMatchesList matches={matches as any} token="t" onChanged={jest.fn()} />);
  expect(screen.getByText('2/4 validé')).toBeInTheDocument();
  expect(screen.getByText(/Se valide automatiquement/i)).toBeInTheDocument();
});

it('affiche « Validation en cours » quand le délai est déjà passé', () => {
  const late = [{ ...base, confirmDeadline: '2020-01-01T00:00:00Z' }];
  renderWithTheme(<MyMatchesList matches={late as any} token="t" onChanged={jest.fn()} />);
  expect(screen.getByText(/Validation en cours/i)).toBeInTheDocument();
});

it('relance les joueurs en attente au clic', async () => {
  renderWithTheme(<MyMatchesList matches={matches as any} token="t" onChanged={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Relancer/i }));
  await waitFor(() => expect(api.remindMatch).toHaveBeenCalledWith('m1', 't'));
  expect(await screen.findByText(/Relance envoyée/i)).toBeInTheDocument();
});

it('affiche « déjà relancé » sur 429', async () => {
  (api.remindMatch as jest.Mock).mockRejectedValueOnce(new Error('RATE_LIMITED'));
  renderWithTheme(<MyMatchesList matches={matches as any} token="t" onChanged={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Relancer/i }));
  expect(await screen.findByText(/Déjà relancé/i)).toBeInTheDocument();
});

it('pas de bouton Relancer si tous les autres ont validé', () => {
  const done = [{ ...base, players: base.players.map((p) => ({ ...p, confirmation: 'CONFIRMED' })) }];
  renderWithTheme(<MyMatchesList matches={done as any} token="t" onChanged={jest.fn()} />);
  expect(screen.queryByRole('button', { name: /Relancer/i })).toBeNull();
});
