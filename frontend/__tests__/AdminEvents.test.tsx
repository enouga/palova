import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminEventsPage from '../app/admin/events/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const adminGetEvents = jest.fn();
const adminGetClub = jest.fn();
const adminCreateEvent = jest.fn();
const adminUpdateEvent = jest.fn();

jest.mock('../lib/api', () => ({
  api: {
    adminGetEvents: (...a: unknown[]) => adminGetEvents(...a),
    adminGetClub: (...a: unknown[]) => adminGetClub(...a),
    adminCreateEvent: (...a: unknown[]) => adminCreateEvent(...a),
    adminUpdateEvent: (...a: unknown[]) => adminUpdateEvent(...a),
    adminDeleteEvent: jest.fn(),
    adminGetEvent: jest.fn(),
    adminPromoteEventRegistration: jest.fn(),
    adminRemoveEventRegistration: jest.fn(),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({
    club: { id: 'c1', name: 'Demo', slug: 'demo', timezone: 'Europe/Paris', clubSports: [] },
  }),
}));

function renderPage() {
  return render(<ThemeProvider><AdminEventsPage /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  adminGetEvents.mockResolvedValue([]);
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
  adminCreateEvent.mockResolvedValue({});
  adminUpdateEvent.mockResolvedValue({});
});

it('affiche le formulaire au clic sur « Nouvel event »', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
  expect(await screen.findByPlaceholderText(/Mêlée du vendredi/)).toBeInTheDocument();
});

it('case « Inscription à régler en ligne » désactivée quand Stripe est NONE', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  expect(cb).toBeDisabled();
  expect(await screen.findByText(/Paiement en ligne →/)).toBeInTheDocument();
});

it('case « Inscription à régler en ligne » activée quand Stripe est ACTIVE', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  await waitFor(() => expect(cb).not.toBeDisabled());
  expect(screen.queryByText(/Paiement en ligne →/)).not.toBeInTheDocument();
});

it('cocher la case et créer envoie requirePrepayment: true', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  await waitFor(() => expect(cb).not.toBeDisabled());
  fireEvent.click(cb);
  fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
  await waitFor(() => expect(adminCreateEvent).toHaveBeenCalled());
  const [, body] = adminCreateEvent.mock.calls[0];
  expect(body.requirePrepayment).toBe(true);
});

it('éditer un event charge requirePrepayment depuis l\'event existant', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
  const existingEvent = {
    id: 'ev1', name: 'Mêlée test', kind: 'MELEE', description: '', status: 'DRAFT',
    startTime: '2026-07-01T10:00:00Z', endTime: null, registrationDeadline: '2026-06-30T10:00:00Z',
    capacity: null, price: null, memberOnly: false, clubSportId: null,
    requirePrepayment: true, confirmedCount: 0, waitlistCount: 0,
  };
  adminGetEvents.mockResolvedValue([existingEvent]);
  renderPage();
  const modifierBtn = await screen.findByRole('button', { name: /Modifier/ });
  fireEvent.click(modifierBtn);
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  await waitFor(() => expect(cb).toBeChecked());
});
