import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminEncaissementPage from '../app/admin/encaissement/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' }, slug: 'padel-arena-paris' }) }));
jest.mock('../lib/useIsDesktop', () => ({ useIsDesktop: () => true }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetClub: jest.fn().mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris', offPeakHours: null, quickPaymentMethods: ['CARD', 'VOUCHER', 'CASH'] }),
    adminGetResources: jest.fn().mockResolvedValue([{ id: 'court-1', name: 'Padel int 1', attributes: {}, isActive: true, price: '52.00', offPeakPrice: null, openHour: 8, closeHour: 22, slotStepMin: null, clubSport: { id: 'cs', slotStepMin: null, durationsMin: [60], sport: { key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } } }]),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    adminGetReservations: jest.fn(),
    adminGetActivePackages: jest.fn().mockResolvedValue([]),
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'p-new' }),
    adminCancelReservation: jest.fn().mockResolvedValue({}),
    adminAssignReservationMember: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminAddReservationParticipant: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminCreateMember: jest.fn().mockResolvedValue({ tempPassword: null, existed: false }),
    adminGetMemberPackages: jest.fn().mockResolvedValue([]),
    refundPayment: jest.fn().mockResolvedValue({}),
    searchClubMembers: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));

Element.prototype.scrollIntoView = jest.fn();

// Heure telle que le composant la rend (fuseau local de la machine) — assertions
// indépendantes du fuseau : on compare au format effectivement affiché, pas à l'heure UTC.
const hm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const mkResa = (id: string, start: string, over: Record<string, unknown> = {}) => ({
  id, resourceId: 'court-1', startTime: start, endTime: start.replace('T16', 'T17'),
  status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00',
  resource: { id: 'court-1', name: 'Padel int 1' },
  user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@x.fr' }, payments: [], participants: [], ...over,
});
const resp = (reservations: unknown[]) => ({ reservations, summary: { total: '0', paid: '0', paidTotal: '0', outstanding: '0' } });

const renderPage = () => render(<ThemeProvider><AdminEncaissementPage /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    mkResa('rv-b', '2099-06-22T18:00:00.000Z'),
    mkResa('rv-a', '2099-06-22T16:00:00.000Z'),
    mkResa('rv-s', '2099-06-22T15:00:00.000Z', { paidAmount: '52.00', payments: [{ id: 'p1', amount: '52.00', method: 'CARD', participantId: null, payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2099-06-22T14:00:00.000Z', refundedAmount: '0.00', receiptNo: null }] }),
  ]));
});

it('titre « Caisse » + file en deux groupes triés (à encaisser par heure, soldées)', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Caisse' })).toBeInTheDocument();
  expect(await screen.findByText("À encaisser d'abord")).toBeInTheDocument();
  expect(screen.getByText('Soldées')).toBeInTheDocument();
  const queue = screen.getByTestId('cx-queue');
  const rows = within(queue).getAllByRole('button', { name: /Jean Dupont/ });
  expect(rows).toHaveLength(3);
  expect(rows[2]).toHaveTextContent('Soldé');   // la soldée en dernier
});

it('desktop : la première résa à encaisser est auto-sélectionnée dans la caisse', async () => {
  renderPage();
  const register = await screen.findByTestId('cx-register');
  // rv-a (16:00 UTC) est la première à encaisser → affichée dans la caisse (heure locale)
  await waitFor(() => expect(within(register).getByText(new RegExp(hm('2099-06-22T16:00:00.000Z')))).toBeInTheDocument());
  expect(within(register).getByText(/Padel int 1/)).toBeInTheDocument();
});

it('clic sur une ligne de la file → la caisse affiche cette réservation', async () => {
  renderPage();
  const queue = await screen.findByTestId('cx-queue');
  const rows = within(queue).getAllByRole('button', { name: /Jean Dupont/ });
  fireEvent.click(rows[1]);   // rv-b (18:00 UTC)
  const register = screen.getByTestId('cx-register');
  await waitFor(() => expect(within(register).getByText(new RegExp(hm('2099-06-22T18:00:00.000Z')))).toBeInTheDocument());
});

it('wiring encaissement : CB dans la caisse → adminAddPayment', async () => {
  renderPage();
  const register = await screen.findByTestId('cx-register');
  const cb = await waitFor(() => within(register).getByRole('button', { name: /CB/ }));
  fireEvent.click(cb);
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-a',
    expect.objectContaining({ method: 'CARD', amount: 13 }), 'tok'));
});

it('caisse express : tous les moyens de paiement proposés (au-delà des rapides du club)', async () => {
  renderPage();
  const register = await screen.findByTestId('cx-register');
  await waitFor(() => within(register).getByRole('button', { name: /CB/ }));
  // club configuré ['CARD','VOUCHER','CASH'] → mais l'express affiche AUSSI Virement + Abo/Membre
  expect(within(register).getByRole('button', { name: /Espèces/ })).toBeInTheDocument();
  expect(within(register).getByRole('button', { name: /Ticket CE/ })).toBeInTheDocument();
  expect(within(register).getByRole('button', { name: /Virement/ })).toBeInTheDocument();
  expect(within(register).getByRole('button', { name: /Abo/ })).toBeInTheDocument();
});

it('recherche : masque les non-correspondants de la file', async () => {
  renderPage();
  await screen.findByTestId('cx-queue');
  fireEvent.change(screen.getByPlaceholderText(/Rechercher un client/i), { target: { value: 'zzz' } });
  expect(screen.getByText('Aucune réservation')).toBeInTheDocument();
});

it('annulées masquées de la file', async () => {
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    mkResa('rv-x', '2099-06-22T16:00:00.000Z', { status: 'CANCELLED' }),
  ]));
  renderPage();
  expect(await screen.findByText('Aucune réservation')).toBeInTheDocument();
});

it('bandeau KPI présent (Encaissé / Reste / Total)', async () => {
  renderPage();
  await screen.findByTestId('cx-queue');
  expect(screen.getByText('Encaissé')).toBeInTheDocument();
  expect(screen.getByText('Reste')).toBeInTheDocument();
  expect(screen.getByText('Total')).toBeInTheDocument();
});

it('« Montant libre, reçu, historique » ouvre la modale Détails (CollectPanel)', async () => {
  renderPage();
  const register = await screen.findByTestId('cx-register');
  const btn = await waitFor(() => within(register).getByRole('button', { name: /Montant libre/ }));
  fireEvent.click(btn);
  // la modale affiche le nom du terrain en titre display + le bandeau d'état
  expect(await screen.findByText('Reste à encaisser')).toBeInTheDocument();
});
