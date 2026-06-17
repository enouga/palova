import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminMatchesPage from '../app/admin/matches/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const getClubMatches = jest.fn();
const resolveClubMatch = jest.fn();
const voidClubMatch = jest.fn();
jest.mock('../lib/api', () => ({
  api: {
    getClubMatches: (...a: unknown[]) => getClubMatches(...a),
    resolveClubMatch: (...a: unknown[]) => resolveClubMatch(...a),
    voidClubMatch: (...a: unknown[]) => voidClubMatch(...a),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Demo', slug: 'demo' } }) }));

function renderPage() {
  return render(<ThemeProvider><AdminMatchesPage /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  getClubMatches.mockResolvedValue([{
    id: 'm1', status: 'DISPUTED', sets: [[6, 4]], playedAt: '2026-06-10T10:00:00Z', winningTeam: 1, confirmDeadline: '',
    players: [
      { userId: 'u1', team: 1, confirmation: 'CONFIRMED', user: { firstName: 'Alice', lastName: 'A' } },
      { userId: 'u2', team: 2, confirmation: 'DISPUTED', user: { firstName: 'Bob', lastName: 'B' } },
    ],
  }]);
  resolveClubMatch.mockResolvedValue({ ok: true });
  voidClubMatch.mockResolvedValue({ ok: true });
});

it('liste les litiges et permet d annuler', async () => {
  renderPage();
  expect(await screen.findByText('6-4')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Annuler'));
  await waitFor(() => expect(resolveClubMatch).toHaveBeenCalledWith('c1', 'm1', { action: 'CANCEL' }, 'tok'));
});

it('valider appelle resolveClubMatch', async () => {
  renderPage();
  await screen.findByText('6-4');
  fireEvent.click(screen.getByText('Valider'));
  await waitFor(() => expect(resolveClubMatch).toHaveBeenCalledWith('c1', 'm1', { action: 'VALIDATE' }, 'tok'));
});

it('affiche un état vide sans litige', async () => {
  getClubMatches.mockResolvedValue([]);
  renderPage();
  expect(await screen.findByText('Aucun litige.')).toBeInTheDocument();
});

it('le segment « Matchs confirmés » charge les confirmés et permet d annuler avec motif', async () => {
  voidClubMatch.mockResolvedValue({ ok: true });
  getClubMatches.mockImplementation((_c: string, status: string) =>
    Promise.resolve(status === 'CONFIRMED'
      ? [{ id: 'm9', status: 'CONFIRMED', sets: [[6, 1]], playedAt: '2026-06-09T10:00:00Z', winningTeam: 1, confirmDeadline: '',
          players: [
            { userId: 'u1', team: 1, confirmation: 'CONFIRMED', user: { firstName: 'Alice', lastName: 'A' } },
            { userId: 'u3', team: 2, confirmation: 'CONFIRMED', user: { firstName: 'Carl', lastName: 'C' } },
          ] }]
      : []));
  renderPage();
  fireEvent.click(screen.getByText('Matchs confirmés'));
  expect(await screen.findByText('6-1')).toBeInTheDocument();
  // ouvrir le dialogue (bouton de la carte)
  fireEvent.click(screen.getByRole('button', { name: 'Annuler le match' }));
  // saisir un motif
  fireEvent.change(screen.getByPlaceholderText(/motif/i), { target: { value: 'score truqué' } });
  // confirmer : il y a maintenant 2 boutons « Annuler le match » (carte + dialogue) → prendre le dernier (dialogue)
  const confirmButtons = screen.getAllByRole('button', { name: 'Annuler le match' });
  fireEvent.click(confirmButtons[confirmButtons.length - 1]);
  await waitFor(() => expect(voidClubMatch).toHaveBeenCalledWith('c1', 'm9', { reason: 'score truqué' }, 'tok'));
});
