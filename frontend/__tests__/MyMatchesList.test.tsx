import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MyMatchesList } from '@/components/match/MyMatchesList';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  assetUrl: () => null,
  api: {
    confirmMatch: jest.fn().mockResolvedValue({ ok: true }),
    disputeMatch: jest.fn().mockResolvedValue({ ok: true }),
    getMatchComments: jest.fn().mockResolvedValue({ status: 'DISPUTED', comments: [] }),
  },
}));
import { api } from '@/lib/api';

const renderWithTheme = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

const base = {
  matchId: 'm1', reservationId: 'r1', status: 'PENDING',
  sets: [[6, 4], [6, 3]] as [number, number][],
  playedAt: '2026-06-20T16:30:00Z', winningTeam: 1, myTeam: 2,
  myConfirmation: 'PENDING', ratingAfter: null, needsMyConfirmation: true,
  club: { name: 'Padel Arena Paris' }, sport: { name: 'Padel' },
  resource: { name: 'Court 2' },
  players: [
    { userId: 'u1', team: 2, firstName: 'Eric', lastName: 'Nougayrede', isMe: true },
    { userId: 'u2', team: 2, firstName: 'Marie', lastName: 'Durand', isMe: false },
    { userId: 'u3', team: 1, firstName: 'Paul', lastName: 'Roy', isMe: false },
    { userId: 'u4', team: 1, firstName: 'Lea', lastName: 'Martin', isMe: false },
  ],
};
const matches = [base];

it('affiche score, partenaire, adversaires, club et terrain', async () => {
  const onChanged = jest.fn();
  renderWithTheme(<MyMatchesList matches={matches as any} token="t" onChanged={onChanged} />);
  expect(screen.getByText('6-4 / 6-3')).toBeInTheDocument();
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
