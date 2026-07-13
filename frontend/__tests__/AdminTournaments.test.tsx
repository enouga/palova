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

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const tournament = (over: Record<string, unknown>) => ({
  id: 'x', clubId: 'c1', clubSportId: 'cs', category: 'P100', name: 'X', gender: 'MIXED',
  openToWomen: true, description: null, contactInfo: null, endTime: null,
  registrationDeadline: iso(1), maxTeams: 10, entryFee: null, requirePrepayment: false,
  confirmedCount: 0, waitlistCount: 0, ...over,
});

it('groupe les tournois par statut et montre les actions contextuelles', async () => {
  adminGetTournaments.mockResolvedValue([
    tournament({ id: 'd1', name: 'Brouillon Test', status: 'DRAFT', startTime: iso(10) }),
    tournament({ id: 'u1', name: 'A venir Test', status: 'PUBLISHED', startTime: iso(5) }),
    tournament({ id: 'p1', name: 'Passe Test', status: 'PUBLISHED', startTime: iso(-5) }),
  ]);
  renderPage();

  expect(await screen.findByText('Brouillon Test')).toBeInTheDocument();
  expect(screen.getByText('Brouillons')).toBeInTheDocument();
  expect(screen.getByText('Publiés · à venir')).toBeInTheDocument();
  expect(screen.getByText('Passés')).toBeInTheDocument();

  // Un seul « Publier » (le brouillon) et un seul « Annuler » (le publié à venir) ;
  // le passé n'a ni l'un ni l'autre → getByRole ne trouve qu'une occurrence de chaque.
  expect(screen.getByRole('button', { name: 'Publier' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
});
