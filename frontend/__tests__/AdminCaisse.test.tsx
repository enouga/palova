import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminCaissePage from '../app/admin/caisse/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';
import { addDaysKey } from '../lib/calendar';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', timezone: 'Europe/Paris' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetCaisse: jest.fn().mockResolvedValue({
      date: '2026-07-10', collected: '115.00',
      totalsByMethod: { CASH: '25.00', CARD: '90.00' },
      payments: [
        { id: 'p1', amount: '25.00', method: 'CASH', participantId: null, payerName: 'Karim', note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-07-10T15:30:00.000Z', status: 'CAPTURED', refundedAmount: '0.00', receiptNo: null, reservation: { id: 'rv-1', startTime: '2026-07-10T15:00:00.000Z', resource: { name: 'Padel 1' }, user: { firstName: 'Karim', lastName: 'B.' } }, memberPackage: null },
        { id: 'p2', amount: '90.00', method: 'CARD', participantId: null, payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-07-10T16:04:00.000Z', status: 'CAPTURED', refundedAmount: '0.00', receiptNo: null, reservation: null, memberPackage: { id: 'mp', kind: 'ENTRIES', user: { firstName: 'Marie', lastName: 'Dupont' }, template: { name: 'Carnet 10' } } },
      ],
    }),
    adminGetReservations: jest.fn().mockResolvedValue({ reservations: [], summary: { total: '0', paid: '0', paidTotal: '0', outstanding: '297.00' } }),
    adminGetVouchers: jest.fn().mockResolvedValue([]),
    adminGetMembers: jest.fn().mockResolvedValue([{ id: 'm1', userId: 'u1', firstName: 'Marie', lastName: 'Dupont', email: 'marie@x.fr' }]),
    adminGetPackageTemplates: jest.fn().mockResolvedValue([{ id: 't1', kind: 'ENTRIES', name: 'Carnet 10', price: '90.00', entriesCount: 10, isActive: true }]),
    adminGetSubscriptionPlans: jest.fn().mockResolvedValue([{ id: 'pl1', name: 'Abo Or', monthlyPrice: '39.00', isActive: true }]),
    adminGetClub: jest.fn().mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris' }),
    adminAccountingSummary: jest.fn().mockResolvedValue({ year: 2026, month: 7, totalsByMethod: {}, collected: '0', refunded: '0', byDay: [{ date: '2026-07-03', net: '80.00' }, { date: '2026-07-10', net: '115.00' }] }),
    adminGetMemberPackages: jest.fn().mockResolvedValue([]),
    adminSellPackage: jest.fn().mockResolvedValue({ id: 'sale' }),
    adminSellSubscription: jest.fn().mockResolvedValue({ id: 'sale' }),
    adminSetVoucherStatus: jest.fn().mockResolvedValue({ id: 'v' }),
    refundPayment: jest.fn().mockResolvedValue({ id: 'r' }),
  },
  assetUrl: (u: string | null) => u,
}));

const renderPage = () => render(<ThemeProvider><AdminCaissePage /></ThemeProvider>);
beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });

it('affiche le bandeau KPI (encaissé + reste dû)', async () => {
  renderPage();
  expect(await screen.findByText('115,00 €')).toBeInTheDocument();
  expect(screen.getByText('297,00 €')).toBeInTheDocument();
});

it('le journal liste les encaissements avec heure locale', async () => {
  renderPage();
  expect(await screen.findByText('17:30')).toBeInTheDocument();
});

it('filtre « Ventes » masque les paiements liés à une résa', async () => {
  renderPage();
  await screen.findByText('17:30');
  fireEvent.click(screen.getByRole('button', { name: 'Ventes' }));
  expect(screen.queryByText(/Padel 1/)).not.toBeInTheDocument();
  expect(screen.getByText(/Marie Dupont/)).toBeInTheDocument();
});

it('vend un abonnement depuis le panneau unifié', async () => {
  renderPage();
  await screen.findByText('115,00 €');
  fireEvent.focus(screen.getByPlaceholderText(/Cliquez pour voir les membres/));
  fireEvent.click(await screen.findByText('Marie Dupont'));   // ligne membre (PlayerPicker n'affiche pas l'email)
  fireEvent.click(await screen.findByText(/Abo Or/));
  fireEvent.click(screen.getByRole('button', { name: /Encaisser/ }));
  await waitFor(() => expect(api.adminSellSubscription).toHaveBeenCalledWith('club-1', 'u1', expect.objectContaining({ planId: 'pl1' }), 'tok'));
});

it('navigation de date : « jour suivant » recharge au lendemain', async () => {
  renderPage();
  await screen.findByText('115,00 €');
  const firstDate = (api.adminGetCaisse as jest.Mock).mock.calls[0][1] as string;
  fireEvent.click(screen.getByRole('button', { name: /jour suivant/i }));
  const expected = addDaysKey(firstDate, 1);
  await waitFor(() => expect(api.adminGetCaisse).toHaveBeenCalledWith('club-1', expected, 'tok'));
});
