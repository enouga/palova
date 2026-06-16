import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminTournamentsPage from '../app/admin/tournaments/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const adminGetTournaments = jest.fn();
const adminGetSports = jest.fn();
jest.mock('../lib/api', () => ({
  api: {
    adminGetTournaments: (...a: unknown[]) => adminGetTournaments(...a),
    adminGetSports: (...a: unknown[]) => adminGetSports(...a),
    adminCreateTournament: jest.fn(),
    adminUpdateTournament: jest.fn(),
    adminGetTournament: jest.fn(),
    adminPromoteRegistration: jest.fn(),
    adminRemoveRegistration: jest.fn(),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Demo', slug: 'demo' } }) }));

function renderPage() {
  return render(<ThemeProvider><AdminTournamentsPage /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  adminGetTournaments.mockResolvedValue([]);
  adminGetSports.mockResolvedValue([{ id: 'cs-padel', sport: { key: 'padel', name: 'Padel' } }]);
});

it('le formulaire Messieurs montre la case « Ouvert aux femmes » cochée par défaut', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const cb = await screen.findByRole('checkbox', { name: /Ouvert aux femmes/ });
  expect(cb).toBeChecked();
});

it('la case « Ouvert aux femmes » disparaît pour un tournoi Dames', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  await screen.findByRole('checkbox', { name: /Ouvert aux femmes/ }); // présente en Messieurs
  fireEvent.change(screen.getByDisplayValue('Messieurs'), { target: { value: 'WOMEN' } });
  await waitFor(() =>
    expect(screen.queryByRole('checkbox', { name: /Ouvert aux femmes/ })).not.toBeInTheDocument(),
  );
});
