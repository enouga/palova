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
    adminAutoApplySubscriptions: jest.fn().mockResolvedValue({ applied: 0 }),
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

it('desktop : rien à encaisser (tout soldé) → la première soldée est auto-sélectionnée', async () => {
  const paid = (id: string, start: string) => mkResa(id, start, {
    paidAmount: '52.00',
    payments: [{ id: `p-${id}`, amount: '52.00', method: 'CARD', participantId: null, payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2099-06-22T14:00:00.000Z', refundedAmount: '0.00', receiptNo: null }],
  });
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    paid('rv-late', '2099-06-22T16:00:00.000Z'),
    paid('rv-early', '2099-06-22T15:00:00.000Z'),
  ]));
  renderPage();
  const register = await screen.findByTestId('cx-register');
  // Pas de placeholder : la première soldée (15:00) est affichée dans la caisse.
  await waitFor(() => expect(within(register).getByText(new RegExp(hm('2099-06-22T15:00:00.000Z')))).toBeInTheDocument());
  expect(within(register).queryByText('Sélectionnez une réservation dans la file')).not.toBeInTheDocument();
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

it('file : séparateurs de DATE par groupe de jours (on sait sur quel jour on est)', async () => {
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    mkResa('rv-j2', '2099-06-23T16:00:00.000Z'),
    mkResa('rv-j1', '2099-06-22T16:00:00.000Z'),
  ]));
  renderPage();
  const queue = await screen.findByTestId('cx-queue');
  const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  await waitFor(() => expect(within(queue).getByText(day('2099-06-22T16:00:00.000Z'))).toBeInTheDocument());
  expect(within(queue).getByText(day('2099-06-23T16:00:00.000Z'))).toBeInTheDocument();
  // tri par jour : la résa du 22 passe avant celle du 23
  const rows = within(queue).getAllByRole('button', { name: /Jean Dupont/ });
  expect(rows[0]).toHaveTextContent(hm('2099-06-22T16:00:00.000Z'));
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

it('auto-sélection : jamais une résa masquée par les filtres (résa passée avec « À venir »)', async () => {
  // Une vieille résa impayée est chargée mais masquée par la période « À venir » (défaut).
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    mkResa('rv-old', '2001-06-22T16:00:00.000Z'),
  ]));
  renderPage();
  expect(await screen.findByText('Aucune réservation')).toBeInTheDocument();
  // File vide → la caisse ne doit RIEN auto-sélectionner (cohérence file/caisse).
  const register = screen.getByTestId('cx-register');
  await waitFor(() => expect(within(register).getByText('Sélectionnez une réservation dans la file')).toBeInTheDocument());
  expect(within(register).queryByText(/Padel int 1/)).not.toBeInTheDocument();
});

it('filtre qui masque la résa sélectionnée (reste dû > 0) → la caisse se désélectionne', async () => {
  renderPage();
  const register = await screen.findByTestId('cx-register');
  await waitFor(() => expect(within(register).getByText(new RegExp(hm('2099-06-22T16:00:00.000Z')))).toBeInTheDocument());
  fireEvent.change(screen.getByPlaceholderText(/Rechercher un client/i), { target: { value: 'zzz' } });
  expect(screen.getByText('Aucune réservation')).toBeInTheDocument();
  await waitFor(() => expect(within(register).getByText('Sélectionnez une réservation dans la file')).toBeInTheDocument());
});

it('annulation depuis la caisse → la caisse passe à la suivante (jamais une annulée)', async () => {
  (api.adminGetReservations as jest.Mock)
    .mockResolvedValueOnce(resp([
      mkResa('rv-b', '2099-06-22T18:00:00.000Z'),
      mkResa('rv-a', '2099-06-22T16:00:00.000Z'),
    ]))
    .mockResolvedValue(resp([
      mkResa('rv-b', '2099-06-22T18:00:00.000Z'),
      mkResa('rv-a', '2099-06-22T16:00:00.000Z', { status: 'CANCELLED' }),
    ]));
  renderPage();
  const register = await screen.findByTestId('cx-register');
  await waitFor(() => expect(within(register).getByText(new RegExp(hm('2099-06-22T16:00:00.000Z')))).toBeInTheDocument());
  fireEvent.click(within(register).getByRole('button', { name: 'Annuler la réservation' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler la réservation' }));
  await waitFor(() => expect(api.adminCancelReservation).toHaveBeenCalledWith('club-1', 'rv-a', 'tok'));
  // rv-a annulée ne doit plus être affichée ; la caisse avance sur rv-b (18:00)
  await waitFor(() => expect(within(register).getByText(new RegExp(hm('2099-06-22T18:00:00.000Z')))).toBeInTheDocument());
});

it('« À encaisser » coché : la résa que l\'on vient de solder reste dans la caisse (le temps du toast)', async () => {
  (api.adminGetReservations as jest.Mock)
    .mockResolvedValueOnce(resp([
      mkResa('rv-a', '2099-06-22T16:00:00.000Z'),
      mkResa('rv-b', '2099-06-22T18:00:00.000Z'),
    ]))
    .mockResolvedValue(resp([
      mkResa('rv-a', '2099-06-22T16:00:00.000Z', { paidAmount: '52.00', payments: [{ id: 'p-new', amount: '52.00', method: 'CARD', participantId: null, payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2099-06-22T14:00:00.000Z', refundedAmount: '0.00', receiptNo: null }] }),
      mkResa('rv-b', '2099-06-22T18:00:00.000Z'),
    ]));
  renderPage();
  const register = await screen.findByTestId('cx-register');
  await waitFor(() => expect(within(register).getByText(new RegExp(hm('2099-06-22T16:00:00.000Z')))).toBeInTheDocument());
  fireEvent.click(screen.getByRole('checkbox', { name: 'À encaisser' }));
  // solder toute la résa : « Tout le reste » puis CB
  fireEvent.click(within(register).getByRole('button', { name: /Tout le reste/ }));
  fireEvent.click(within(register).getByRole('button', { name: /CB/ }));
  // la résa quitte la file (soldée + filtre « À encaisser ») mais la caisse la garde affichée
  await waitFor(() => expect(within(register).getByText(/Soldé/)).toBeInTheDocument());
  expect(within(register).getByText(new RegExp(hm('2099-06-22T16:00:00.000Z')))).toBeInTheDocument();
});

it('couverture auto abonnement : balaie le jour affiché avant de charger les réservations', async () => {
  renderPage();
  await screen.findByTestId('cx-queue');
  const dateArg = (api.adminGetReservations as jest.Mock).mock.calls[0][1].date;
  expect(api.adminAutoApplySubscriptions).toHaveBeenCalledWith('club-1', dateArg, 'tok');
});

it('couverture auto abonnement : un échec ne bloque pas le chargement de la page', async () => {
  (api.adminAutoApplySubscriptions as jest.Mock).mockRejectedValue(new Error('boom'));
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Caisse' })).toBeInTheDocument();
  expect(await screen.findByText("À encaisser d'abord")).toBeInTheDocument();
});

