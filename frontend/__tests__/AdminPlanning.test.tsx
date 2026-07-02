import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminPlanningPage from '../app/admin/planning/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
// Le planning lit useAdminChrome depuis le layout admin — mocké pour ne pas charger
// tout le chrome (sidebar, gardes de droits) dans un test de page isolé.
jest.mock('../app/admin/layout', () => ({ useAdminChrome: () => ({ collapsed: false, setCollapsed: jest.fn() }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetClub: jest.fn().mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris', offPeakHours: null, quickPaymentMethods: ['CARD', 'VOUCHER', 'CASH'] }),
    adminGetResources: jest.fn(),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    adminGetReservations: jest.fn(),
    adminGetActivePackages: jest.fn().mockResolvedValue([]),
    adminGetMemberSubscriptions: jest.fn().mockResolvedValue([]),
    adminListCoaches: jest.fn().mockResolvedValue([]),
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'p1' }),
    refundPayment: jest.fn().mockResolvedValue({ id: 'rf1' }),
    adminAssignReservationMember: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminAddReservationParticipant: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminRemoveReservationParticipant: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminChangeReservationParticipant: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminCreateMember: jest.fn().mockResolvedValue({ tempPassword: null, existed: false }),
  },
  assetUrl: (u: string | null) => u,
}));

const renderPage = () => render(<ThemeProvider><AdminPlanningPage /></ThemeProvider>);
Element.prototype.scrollIntoView = jest.fn();

// Terrain single (capacité 2, 26 € → part 13 €) avec 2 joueurs nommés.
const singleCourt = () => ({ id: 'court-1', name: 'C1', attributes: { format: 'single' }, isActive: true, price: '26.00', offPeakPrice: null, openHour: 8, closeHour: 22, slotStepMin: null, clubSport: { id: 'cs', slotStepMin: null, durationsMin: [60], sport: { key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } } });
const twoPlayerResa = (over: Record<string, unknown> = {}) => ({
  id: 'rv-1', resourceId: 'court-1', startTime: '2099-06-22T16:00:00.000Z', endTime: '2099-06-22T17:00:00.000Z',
  status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '26.00', paidAmount: '0.00', dueAmount: '26.00',
  resource: { id: 'court-1', name: 'C1' }, user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' },
  payments: [], participants: [
    { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '0.00', outstanding: '13.00' },
    { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', share: '13.00', paid: '0.00', outstanding: '13.00' },
  ], ...over,
});
const paidParticipants = () => [
  { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '13.00', outstanding: '0.00' },
  { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', share: '13.00', paid: '13.00', outstanding: '0.00' },
];
// Terrain double (capacité 4, 52 € → part 13 €) avec le seul organisateur nommé → 3 places vides.
const doubleCourt = () => ({ ...singleCourt(), attributes: {}, price: '52.00' });
const oneNamedResa = () => twoPlayerResa({
  totalPrice: '52.00', dueAmount: '52.00',
  participants: [{ id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '0.00', outstanding: '13.00' }],
});
const resp = (reservations: unknown[]) => ({ reservations, summary: { total: '0', paid: '0', paidTotal: '0', outstanding: '0' } });
// Abonnement ACTIF (non expiré) — pour afficher les règlements sans encaissement.
const activeSub = () => [{ id: 's1', status: 'ACTIVE', expiresAt: '2099-01-01T00:00:00.000Z' }];

// Ouvre la modale de détail en cliquant le pavé de la réservation dans la grille.
const openModal = async () => {
  fireEvent.click((await screen.findByText('Jean Test')).closest('button') as HTMLElement);
};

beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });

it("sélectionne une ligne joueur puis encaisse SA part avec un moyen (en bas), sans fermer la modale", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
  renderPage();
  await openModal();
  // On SÉLECTIONNE la 1re ligne joueur (Jean = pt-1) → cible son participantId.
  fireEvent.click((await screen.findAllByRole('button', { name: 'Régler' }))[0]);
  // Les moyens sont un seul jeu, EN BAS ; on encaisse en Carte.
  fireEvent.click(screen.getByRole('button', { name: 'Carte' }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
    'club-1', 'rv-1', expect.objectContaining({ participantId: 'pt-1', method: 'CARD', amount: 13 }), 'tok',
  ));
  expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();   // modale toujours ouverte
});

it('les moyens sont un seul jeu EN BAS (pas un par ligne) ; chaque ligne se sélectionne', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
  renderPage();
  await openModal();
  await screen.findByRole('button', { name: 'Carte' });
  expect(screen.getAllByRole('button', { name: 'Régler' })).toHaveLength(2);   // une sélection par joueur
  expect(screen.getAllByRole('button', { name: 'Carte' })).toHaveLength(1);    // un seul jeu de moyens, en bas
});

it('propose TOUS les moyens de paiement en bas (rapides + les autres)', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
  renderPage();
  await openModal();
  await screen.findByRole('button', { name: 'Carte' });
  ['Espèces', 'Virement', 'Ticket CE', 'Autre'].forEach((l) =>
    expect(screen.getByRole('button', { name: l })).toBeInTheDocument());
  // « Abo / Membre » générique retiré : doublon avec le règlement « Abonnement » sans encaissement.
  expect(screen.queryByRole('button', { name: 'Abo / Membre' })).toBeNull();
});

it("encaisse la réservation entière → le bandeau d'état passe à « Soldé »", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  let n = 0;
  (api.adminGetReservations as jest.Mock).mockImplementation(() => {
    n += 1;
    return Promise.resolve(resp([n === 1 ? twoPlayerResa() : twoPlayerResa({ paidAmount: '26.00', participants: paidParticipants() })]));
  });
  renderPage();
  await openModal();
  fireEvent.click(await screen.findByRole('button', { name: 'Carte' }));   // aucun joueur ciblé → réservation entière (26)
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
    'club-1', 'rv-1', expect.objectContaining({ method: 'CARD', amount: 26 }), 'tok',
  ));
  expect(await screen.findByText('✓ Soldé')).toBeInTheDocument();
});

it("permet de sélectionner une ligne SANS joueur et d'encaisser sa part (anonyme)", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([doubleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([oneNamedResa()]));
  renderPage();
  await openModal();
  // 1 joueur nommé (pt-1) + 3 places vides → 4 boutons « Régler ».
  const reglers = await screen.findAllByRole('button', { name: 'Régler' });
  expect(reglers).toHaveLength(4);
  fireEvent.click(reglers[1]);                                    // 1re place vide
  fireEvent.click(screen.getByRole('button', { name: 'Carte' }));
  await waitFor(() => {
    const call = (api.adminAddPayment as jest.Mock).mock.calls.at(-1)!;
    expect(call[2]).toMatchObject({ amount: 13, method: 'CARD' });   // une part (52/4), anonyme
    expect(call[2].participantId).toBeUndefined();
  });
});

it('propose les règlements sans encaissement Coffre / Offres / Abonnement (joueur avec abonnement actif)', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
  (api.adminGetMemberSubscriptions as jest.Mock).mockResolvedValue(activeSub());   // titulaire abonné actif
  renderPage();
  await openModal();
  // Les boutons apparaissent après le chargement des abonnements (asynchrone).
  await screen.findByRole('button', { name: 'Coffre' });
  ['Offres', 'Abonnement'].forEach((l) => expect(screen.getByRole('button', { name: l })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Coffre' }));           // aucun joueur ciblé → résa entière
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
    'club-1', 'rv-1', expect.objectContaining({ method: 'MEMBER', note: 'Coffre' }), 'tok',
  ));
});

it("masque les règlements sans encaissement si le joueur n'a ni abonnement ni carnet/porte-monnaie", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
  (api.adminGetMemberSubscriptions as jest.Mock).mockResolvedValue([]);   // aucun abonnement (et pas de package)
  renderPage();
  await openModal();
  await screen.findByRole('button', { name: 'Carte' });
  expect(screen.queryByRole('button', { name: 'Coffre' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Abonnement' })).toBeNull();
});

it("permet d'annuler un encaissement depuis la liste (même anonyme), comme la page Encaissement", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa({
    paidAmount: '13.00',   // un paiement anonyme (préréglé/Autre/entier) → n'apparaît sur aucune ligne joueur
    payments: [{ id: 'pay-1', amount: '13.00', method: 'OTHER', participantId: null, note: 'Coffre', refundedAmount: '0.00', payerName: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-06-22T16:05:00.000Z' }],
  })]));
  renderPage();
  await openModal();
  fireEvent.click(await screen.findByRole('button', { name: 'annuler' }));
  await waitFor(() => expect(api.refundPayment).toHaveBeenCalledWith(
    'club-1', 'pay-1', expect.objectContaining({ amount: 13 }), 'tok',
  ));
});

it("affiche la note d'un paiement « Autre » dans les encaissements (comment ça a été réglé)", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa({
    paidAmount: '13.00',
    participants: [
      { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '0.00', outstanding: '13.00' },
      { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', share: '13.00', paid: '0.00', outstanding: '13.00' },
    ],
    payments: [{ id: 'pay-1', amount: '13.00', method: 'OTHER', participantId: null, note: 'Coffre-fort', refundedAmount: '0.00', payerName: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-06-22T16:05:00.000Z' }],
  })]));
  renderPage();
  await openModal();
  expect(await screen.findByText(/Coffre-fort/)).toBeInTheDocument();
});

it('la modale liste les encaissements existants (section « Encaissements »)', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa({
    paidAmount: '13.00',
    participants: [
      { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '13.00', outstanding: '0.00' },
      { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', share: '13.00', paid: '0.00', outstanding: '13.00' },
    ],
    payments: [{ id: 'pay-1', amount: '13.00', method: 'CARD', participantId: 'pt-1', refundedAmount: '0.00', payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-06-22T16:05:00.000Z' }],
  })]));
  renderPage();
  await openModal();
  expect(await screen.findByText('Encaissements')).toBeInTheDocument();
});
