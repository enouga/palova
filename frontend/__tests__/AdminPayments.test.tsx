import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import AdminPaymentsPage from '../app/admin/payments/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/admin/payments',
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'abc', ready: true }) }));

const mockClubCtx = { slug: 'demo', club: { id: 'c1' } as Record<string, unknown>, loading: false };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => mockClubCtx }));

jest.mock('../lib/api', () => ({
  api: {
    adminGetClub: jest.fn(),
    getStripeStatus: jest.fn().mockResolvedValue({ stripeAccountStatus: 'NONE' }),
    initiateStripeConnect: jest.fn(),
    getStripeLoginLink: jest.fn(),
    adminUpdateClub: jest.fn().mockResolvedValue({}),
    disconnectStripe: jest.fn(),
  },
  assetUrl: (p: string | null) => p,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const clubWith = (over: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'Club Démo',
  stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
  requireOnlinePayment: false, requireCardFingerprint: false,
  ...over,
});

const wrap = async () => {
  render(<ThemeProvider><AdminPaymentsPage /></ThemeProvider>);
  await act(async () => {});
};

beforeEach(() => jest.clearAllMocks());

describe('AdminPaymentsPage', () => {
  it('état ACTIVE : affiche les réglages et le bouton de changement de compte', async () => {
    api.adminGetClub.mockResolvedValue(clubWith());
    await wrap();
    expect(await screen.findByText('Compte actif')).toBeInTheDocument();
    expect(screen.getByText('Exiger le paiement CB à la réservation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Changer de compte Stripe' })).toBeInTheDocument();
  });

  it('état NONE : affiche le bouton de connexion, pas de changement de compte', async () => {
    api.adminGetClub.mockResolvedValue(clubWith({ stripeAccountId: null, stripeAccountStatus: 'NONE' }));
    await wrap();
    expect(await screen.findByRole('button', { name: 'Connecter mon compte Stripe' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Changer de compte Stripe' })).not.toBeInTheDocument();
  });

  it('changement de compte : confirme, appelle disconnectStripe puis repasse en NONE', async () => {
    api.adminGetClub
      .mockResolvedValueOnce(clubWith())
      .mockResolvedValueOnce(clubWith({ stripeAccountId: null, stripeAccountStatus: 'NONE' }));
    api.disconnectStripe.mockResolvedValue({ ok: true });
    await wrap();

    fireEvent.click(await screen.findByRole('button', { name: 'Changer de compte Stripe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Changer de compte' }));

    await waitFor(() => expect(api.disconnectStripe).toHaveBeenCalledWith('c1', 'abc'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connecter mon compte Stripe' })).toBeInTheDocument());
  });

  it('changement de compte : 409 affiche le nombre de paiements en attente et ne bascule pas', async () => {
    api.adminGetClub.mockResolvedValue(clubWith());
    api.disconnectStripe.mockRejectedValue(
      Object.assign(new Error('STRIPE_HAS_PENDING_ONLINE_PAYMENTS'), { count: 2 }),
    );
    await wrap();

    fireEvent.click(await screen.findByRole('button', { name: 'Changer de compte Stripe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Changer de compte' }));

    await waitFor(() => expect(screen.getByText(/2 paiement\(s\) CB sur des réservations à venir/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Connecter mon compte Stripe' })).not.toBeInTheDocument();
  });
});
