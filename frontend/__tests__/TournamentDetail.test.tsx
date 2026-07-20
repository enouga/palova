/**
 * Tests — TournamentDetailPage — parcours d'inscription payante (Task 17)
 * Scope : StripePaymentStep rendu après register({ payment }), mode setup, flux libre inchangé.
 */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TournamentDetailClient } from '../app/tournois/[id]/TournamentDetailClient';
import { ThemeProvider } from '../lib/ThemeProvider';

// --- Mocks composants lourds ------------------------------------------------
jest.mock('../components/tournament/TournamentHero', () => ({
  TournamentHero: () => <div data-testid="tournament-hero" />,
  MetaCards: () => null,
}));
jest.mock('../components/tournament/TeamsGrid', () => ({
  TeamsGrid: () => <div data-testid="teams-grid" />,
}));
jest.mock('../components/tournament/ShareActions', () => ({
  ShareActions: () => null,
}));
jest.mock('../components/tournament/MyRegistrationCard', () => ({
  MyRegistrationCard: () => null,
}));
jest.mock('../components/tournament/ProfileCompletion', () => ({
  ProfileCompletion: () => null,
}));
jest.mock('../components/tournament/PartnerSearch', () => ({
  PartnerSearch: ({ onSelect }: { onSelect: (p: { id: string; firstName: string; lastName: string }) => void }) => (
    <button
      data-testid="select-partner"
      onClick={() => onSelect({ id: 'u2', firstName: 'Partner', lastName: 'User' })}
    >
      Sélectionner un partenaire
    </button>
  ),
}));
jest.mock('../components/agenda/RegistrationUI', () => ({
  AboutCard: () => null,
}));
jest.mock('../components/ClubNav', () => ({
  ClubNav: () => null,
}));
jest.mock('../components/ui/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('../components/ui/Icon', () => ({
  Icon: () => null,
}));

// StripePaymentStep — stub (évite de charger les libs Stripe)
jest.mock('../components/StripePaymentStep', () => ({
  __esModule: true,
  default: ({ type, amountLabel }: { type: string; amountLabel: string }) => (
    <div data-testid="stripe-step" data-type={type} data-amount={amountLabel} />
  ),
}));

// lib helpers purs (tournoi)
jest.mock('../lib/tournament', () => ({
  waitlistPosition: () => null,
}));

// --- Mocks API ---------------------------------------------------------------
const registerTournament = jest.fn();
const getTournament = jest.fn();
const getTournamentParticipants = jest.fn();
const getMyTournaments = jest.fn();
const getMyProfile = jest.fn();
const getMyClubMembership = jest.fn();

jest.mock('../lib/api', () => ({
  api: {
    getTournament: (...a: unknown[]) => getTournament(...a),
    getTournamentParticipants: (...a: unknown[]) => getTournamentParticipants(...a),
    registerTournament: (...a: unknown[]) => registerTournament(...a),
    changeTournamentPartner: jest.fn(),
    cancelTournamentRegistration: jest.fn(),
    getMyTournaments: (...a: unknown[]) => getMyTournaments(...a),
    getMyProfile: (...a: unknown[]) => getMyProfile(...a),
    getMyClubMembership: (...a: unknown[]) => getMyClubMembership(...a),
    createRegistrationIntent: jest.fn().mockResolvedValue({
      clientSecret: 'cs_test_xxx',
      type: 'payment',
      stripeAccountId: null,
    }),
    confirmRegistrationPayment: jest.fn().mockResolvedValue({}),
  },
  assetUrl: (u: string | null) => u,
}));

jest.mock('../lib/useAuth', () => ({
  useAuth: () => ({ token: 'tok', ready: true }),
}));

jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ club: { id: 'c1', name: 'Demo', slug: 'demo' } }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// --- Fixture tournoi ---------------------------------------------------------
const baseTournament = {
  id: 't1',
  clubId: 'c1',
  clubSportId: 'cs-padel',
  name: 'Tournoi Test P100',
  category: 'P100',
  gender: 'MEN' as const,
  openToWomen: true,
  description: null,
  contactInfo: null,
  startTime: '2030-08-01T08:00:00.000Z',
  endTime: null,
  registrationDeadline: '2030-07-25T23:59:00.000Z',
  maxTeams: 16,
  entryFee: '15.00',
  requirePrepayment: true,
  status: 'PUBLISHED' as const,
  confirmedCount: 4,
  waitlistCount: 0,
  club: { slug: 'demo', name: 'Demo Club', timezone: 'Europe/Paris' },
  clubSport: { sport: { key: 'padel', name: 'Padel' } },
};

const baseReg = {
  id: 'r1',
  tournamentId: 't1',
  captainUserId: 'u1',
  partnerUserId: 'u2',
  status: 'CONFIRMED' as const,
  cancelledAt: null,
  createdAt: '',
  updatedAt: '',
};

async function renderPage(id = 't1') {
  // Render inside act(async) so React flushe les promesses de chargement chaînées
  // (getTournament/getMyProfile/…) en un seul passage act.
  await act(async () => {
    render(
      <ThemeProvider>
        <TournamentDetailClient id={id} />
      </ThemeProvider>,
    );
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  getTournament.mockResolvedValue(baseTournament);
  getTournamentParticipants.mockResolvedValue([]);
  getMyTournaments.mockResolvedValue([]);
  getMyProfile.mockResolvedValue({
    id: 'u1', firstName: 'Test', lastName: 'User', phone: '0600000000', sex: 'MALE',
    birthDate: null, avatarUrl: null, locale: null, isSuperAdmin: false,
    showInLeaderboard: false, autoMatchProposals: false, preferredSport: null,
  });
  getMyClubMembership.mockResolvedValue({ membershipNo: 'LIC123', status: 'ACTIVE', isSubscriber: false });
});

// ============================================================================
describe('TournamentDetailPage — inscription payante (requirePrepayment)', () => {
  it('affiche StripePaymentStep en mode payment quand le tournoi a une place libre', async () => {
    registerTournament.mockResolvedValue({
      registration: baseReg,
      payment: { mode: 'payment' },
    });

    await renderPage();

    // Sélectionner un partenaire (débloque le bouton S'inscrire)
    fireEvent.click(await screen.findByTestId('select-partner'));

    // Cliquer S'inscrire
    fireEvent.click(await screen.findByRole('button', { name: /inscrire/i }));

    // Case CGV obligatoire avant que le formulaire de paiement n'apparaisse
    fireEvent.click(await screen.findByRole('checkbox'));

    // StripePaymentStep doit s'afficher avec le bon type et le bon montant
    const step = await screen.findByTestId('stripe-step');
    expect(step).toBeInTheDocument();
    expect(step).toHaveAttribute('data-type', 'payment');
    expect(step.getAttribute('data-amount')).toMatch(/15/);
  });

  it('affiche StripePaymentStep en mode setup (liste d\'attente) et la mention carte', async () => {
    registerTournament.mockResolvedValue({
      registration: { ...baseReg, status: 'WAITLISTED' as const },
      payment: { mode: 'setup' },
    });

    await renderPage();

    fireEvent.click(await screen.findByTestId('select-partner'));
    fireEvent.click(await screen.findByRole('button', { name: /inscrire/i }));
    fireEvent.click(await screen.findByRole('checkbox'));

    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-type', 'setup');

    // Texte explicatif liste d'attente
    expect(screen.getByText(/débitée seulement si une place se libère/i)).toBeInTheDocument();
  });

  it('suit le flux gratuit actuel (pas de StripePaymentStep) quand payment est null', async () => {
    registerTournament.mockResolvedValue({
      registration: baseReg,
      payment: null,
    });

    await renderPage();

    fireEvent.click(await screen.findByTestId('select-partner'));
    fireEvent.click(await screen.findByRole('button', { name: /inscrire/i }));

    // Stripe ne doit pas s'afficher
    await waitFor(() => {
      expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();
    });
    // Le flux actuel recharge le tournoi (load() appelé 2× : montage + après register)
    await waitFor(() => expect(getTournament).toHaveBeenCalledTimes(2));
  });
});
