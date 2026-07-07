import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuperAdminClubDetail from '../app/superadmin/clubs/[id]/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'club-1' }) }));

const platformClubDetail = jest.fn();
const platformSetSubscriptionTier = jest.fn();
jest.mock('../lib/api', () => ({
  api: {
    platformClubDetail: (...a: unknown[]) => platformClubDetail(...a),
    platformSetSubscriptionTier: (...a: unknown[]) => platformSetSubscriptionTier(...a),
    platformCancelSubscription: jest.fn(),
    platformResumeSubscription: jest.fn(),
    platformSetClubStatus: jest.fn(),
    platformSetBillingExempt: jest.fn(),
    platformChangeClubSlug: jest.fn(),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok' }) }));

const months = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, count: i }));

const withSub = {
  id: 'club-1', slug: 'arena', name: 'Arena', city: 'Paris', address: '', timezone: 'Europe/Paris',
  status: 'ACTIVE', createdAt: '2026-01-01T00:00:00Z', aliases: ['vieux-arena'],
  owners: [{ id: 'u1', email: 'owner@arena.fr', firstName: 'O', lastName: 'M' }],
  counts: { adherents: 48, resources: 5, tournaments: 3, events: 2 },
  billing: {
    exempt: false, activeMembers: 200, countedAt: null, observedTier: 2, state: 'OK',
    subscription: { status: 'active', tier: 2, interval: 'month', priceCents: 5900, currentPeriodEnd: '2026-08-01T00:00:00Z', cancelAtPeriodEnd: false },
    snapshots: [{ month: '2026-06', activeMembers: 190, tier: 2 }],
    invoices: [{ id: 'inv-1', stripeInvoiceId: 'in_1', amountCents: 5900, currency: 'eur', status: 'paid', tier: 2, interval: 'month', periodStart: null, periodEnd: null, paidAt: '2026-07-01T00:00:00Z', hostedInvoiceUrl: 'https://stripe/i', createdAt: '2026-07-01T00:00:00Z' }],
  },
  activity: { reservationsByMonth: months, reservations30d: 7, lastReservationAt: '2026-07-05T00:00:00Z' },
};

const noSub = {
  ...withSub,
  billing: { ...withSub.billing, state: 'TO_REGULARIZE', subscription: null, invoices: [] },
};

function renderPage() {
  return render(<ThemeProvider><SuperAdminClubDetail /></ThemeProvider>);
}

beforeEach(() => jest.clearAllMocks());

it('affiche identité, facturation et factures', async () => {
  platformClubDetail.mockResolvedValue(withSub);
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Arena' })).toBeInTheDocument();
  expect(screen.getByText(/Voir sur Stripe/)).toBeInTheDocument();
  expect(screen.getByText(/vieux-arena/)).toBeInTheDocument();
  // La jauge de membres actifs.
  expect(screen.getByText('200')).toBeInTheDocument();
});

it('changer le palier appelle platformSetSubscriptionTier', async () => {
  platformClubDetail.mockResolvedValue(withSub);
  platformSetSubscriptionTier.mockResolvedValue({ tier: 2, interval: 'year', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Changer le palier' }));
  // Bascule sur l'annuel → le bouton Appliquer devient actif.
  fireEvent.click(screen.getByRole('button', { name: /Annuel/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer le palier' }));
  await waitFor(() => expect(platformSetSubscriptionTier).toHaveBeenCalledWith('club-1', { tier: 2, interval: 'year' }, 'tok'));
});

it('sans abonnement : « Changer le palier » désactivé + message', async () => {
  platformClubDetail.mockResolvedValue(noSub);
  renderPage();
  await screen.findByRole('heading', { name: 'Arena' });
  expect(screen.getByText(/Aucun abonnement actif/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Changer le palier' })).toBeDisabled();
});

it('club introuvable → message', async () => {
  platformClubDetail.mockRejectedValue(new Error('CLUB_NOT_FOUND'));
  renderPage();
  expect(await screen.findByText(/introuvable/)).toBeInTheDocument();
});
