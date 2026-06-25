import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminTournamentsPage from '../app/admin/tournaments/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const adminGetTournaments = jest.fn();
const adminGetSports = jest.fn();
const adminGetClub = jest.fn();
const adminCreateTournament = jest.fn();
const adminUpdateTournament = jest.fn();

jest.mock('../lib/api', () => ({
  api: {
    adminGetTournaments: (...a: unknown[]) => adminGetTournaments(...a),
    adminGetSports: (...a: unknown[]) => adminGetSports(...a),
    adminGetClub: (...a: unknown[]) => adminGetClub(...a),
    adminCreateTournament: (...a: unknown[]) => adminCreateTournament(...a),
    adminUpdateTournament: (...a: unknown[]) => adminUpdateTournament(...a),
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
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
  adminCreateTournament.mockResolvedValue({});
  adminUpdateTournament.mockResolvedValue({});
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

it('case « Inscription à régler en ligne » désactivée quand Stripe est NONE', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  expect(cb).toBeDisabled();
  expect(await screen.findByText(/Paiement en ligne →/)).toBeInTheDocument();
});

it('case « Inscription à régler en ligne » activée quand Stripe est ACTIVE', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  await waitFor(() => expect(cb).not.toBeDisabled());
  expect(screen.queryByText(/Paiement en ligne →/)).not.toBeInTheDocument();
});

it('cocher la case et créer envoie requirePrepayment: true', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  await waitFor(() => expect(cb).not.toBeDisabled());
  fireEvent.click(cb);
  fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
  await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
  const [, body] = adminCreateTournament.mock.calls[0];
  expect(body.requirePrepayment).toBe(true);
});
