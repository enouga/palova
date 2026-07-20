/**
 * Tests — EventDetailPage — parcours d'inscription payante (Task 17)
 * Scope : StripePaymentStep rendu après register({ payment }), mode setup, flux libre inchangé.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EventDetailClient } from '../app/events/[id]/EventDetailClient';
import { ThemeProvider } from '../lib/ThemeProvider';

// --- Navigation mock --------------------------------------------------------
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// --- Composants lourds -------------------------------------------------------
jest.mock('../components/ClubNav', () => ({ ClubNav: () => null }));
jest.mock('../components/ui/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('../components/ui/atoms', () => ({
  Btn: ({ onClick, children, disabled }: { onClick?: () => void; children: React.ReactNode; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));
jest.mock('../components/ui/Icon', () => ({ Icon: () => null }));
jest.mock('../components/agenda/AgendaHero', () => ({
  AgendaHero: () => <div data-testid="agenda-hero" />,
  MetaCardsRow: () => null,
  MetaCard: () => null,
}));
jest.mock('../components/agenda/RegistrationUI', () => ({
  AboutCard: () => null,
  RegistrationStatus: ({ confirmed }: { confirmed: boolean }) => (
    <div data-testid="reg-status">{confirmed ? 'Confirmé' : 'En attente'}</div>
  ),
  LeaveButton: ({ onClick, label }: { onClick: () => void; label: string }) => (
    <button onClick={onClick}>{label}</button>
  ),
}));
jest.mock('../components/tournament/ShareActions', () => ({ ShareActions: () => null }));
jest.mock('../components/event/ParticipantsGrid', () => ({ ParticipantsGrid: () => null }));

// StripePaymentStep — stub
jest.mock('../components/StripePaymentStep', () => ({
  __esModule: true,
  default: ({ type, amountLabel }: { type: string; amountLabel: string }) => (
    <div data-testid="stripe-step" data-type={type} data-amount={amountLabel} />
  ),
}));

// Lib helpers purs
jest.mock('../lib/events', () => ({
  KIND_LABEL: { MELEE: 'Mêlée', STAGE: 'Stage', SOIREE: 'Soirée', INITIATION: 'Initiation', AUTRE: 'Autre' },
}));
jest.mock('../lib/tournament', () => ({
  fillRatio: () => 0.25,
  formatDateShortTimeRange: () => '01/08/2030',
  formatDateTimeShort: () => '25/07/2030 23:59',
  heroPlacesLabel: () => ({ text: 'places libres', urgent: false }),
  waitlistPosition: () => null,
}));

// --- Mocks API ---------------------------------------------------------------
const registerEvent = jest.fn();
const getEvent = jest.fn();
const getEventParticipants = jest.fn();
const getMyEvents = jest.fn();

jest.mock('../lib/api', () => ({
  api: {
    getEvent: (...a: unknown[]) => getEvent(...a),
    getEventParticipants: (...a: unknown[]) => getEventParticipants(...a),
    registerEvent: (...a: unknown[]) => registerEvent(...a),
    cancelEventRegistration: jest.fn(),
    getMyEvents: (...a: unknown[]) => getMyEvents(...a),
    getMyProfile: jest.fn().mockResolvedValue({ id: 'me' }),
    createRegistrationIntent: jest.fn().mockResolvedValue({
      clientSecret: 'cs_test_ev',
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
  useClub: () => ({ club: { id: 'c1', name: 'Demo', slug: 'demo' }, loading: false }),
}));

// --- Fixture event -----------------------------------------------------------
const baseEvent = {
  id: 'ev1',
  clubId: 'c1',
  name: 'Mêlée Test',
  kind: 'MELEE' as const,
  description: null,
  startTime: '2030-08-01T08:00:00.000Z',
  endTime: null,
  registrationDeadline: '2030-07-25T23:59:00.000Z',
  capacity: 16,
  price: '10.00',
  requirePrepayment: true,
  memberOnly: false,
  status: 'PUBLISHED' as const,
  confirmedCount: 4,
  waitlistCount: 0,
  clubSportId: null,
  club: { slug: 'demo', name: 'Demo Club', timezone: 'Europe/Paris' },
};

const baseReg = { id: 'r1', eventId: 'ev1', userId: 'u1', status: 'CONFIRMED' as const };

function renderPage() {
  return render(
    <ThemeProvider>
      <EventDetailClient id="ev1" />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  getEvent.mockResolvedValue(baseEvent);
  getEventParticipants.mockResolvedValue([]);
  getMyEvents.mockResolvedValue([]);
});

// ============================================================================
describe('EventDetailPage — inscription payante (requirePrepayment)', () => {
  it('affiche StripePaymentStep en mode payment quand l\'event a une place libre', async () => {
    registerEvent.mockResolvedValue({
      registration: baseReg,
      payment: { mode: 'payment' },
    });

    renderPage();

    // Le bouton S'inscrire apparaît une fois l'event chargé
    fireEvent.click(await screen.findByRole('button', { name: /inscrire/i }));

    // Case CGV obligatoire avant que le formulaire de paiement n'apparaisse
    fireEvent.click(await screen.findByRole('checkbox'));

    const step = await screen.findByTestId('stripe-step');
    expect(step).toBeInTheDocument();
    expect(step).toHaveAttribute('data-type', 'payment');
    expect(step.getAttribute('data-amount')).toMatch(/10/);
  });

  it('affiche StripePaymentStep en mode setup (liste d\'attente) avec la mention carte', async () => {
    // Event complet → liste d'attente
    getEvent.mockResolvedValue({ ...baseEvent, confirmedCount: 16 });
    registerEvent.mockResolvedValue({
      registration: { ...baseReg, status: 'WAITLISTED' as const },
      payment: { mode: 'setup' },
    });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Rejoindre/i }));
    fireEvent.click(await screen.findByRole('checkbox'));

    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-type', 'setup');
    expect(screen.getByText(/débitée seulement si une place se libère/i)).toBeInTheDocument();
  });

  it('suit le flux gratuit actuel (pas de StripePaymentStep) quand payment est null', async () => {
    registerEvent.mockResolvedValue({
      registration: baseReg,
      payment: null,
    });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /inscrire/i }));

    // Pas de Stripe
    await waitFor(() => {
      expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();
    });
    // L'event est rechargé (load() : montage + après register)
    await waitFor(() => expect(getEvent).toHaveBeenCalledTimes(2));
  });
});
