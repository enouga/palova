import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import AdminReservationsPage from '../app/admin/reservations/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetClub: jest.fn().mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris', offPeakHours: null, quickPaymentMethods: ['CARD', 'VOUCHER', 'CASH'] }),
    adminGetResources: jest.fn().mockResolvedValue([{ id: 'court-1', name: 'C1', attributes: {}, isActive: true, price: '52.00', offPeakPrice: null, openHour: 8, closeHour: 22, slotStepMin: null, clubSport: { id: 'cs', slotStepMin: null, durationsMin: [60], sport: { key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } } }]),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    adminGetReservations: jest.fn().mockResolvedValue({ reservations: [
      { id: 'rv-1', resourceId: 'court-1', startTime: '2026-06-22T16:00:00.000Z', endTime: '2026-06-22T17:00:00.000Z', status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00', resource: { id: 'court-1', name: 'C1' }, user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' }, payments: [], participants: [] },
    ], summary: { total: '52', paid: '0', paidTotal: '0', outstanding: '52' } }),
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'p1' }),
    adminCancelReservation: jest.fn().mockResolvedValue({ id: 'rv-1', status: 'CANCELLED' }),
    adminAssignReservationMember: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminAddReservationParticipant: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminCreateMember: jest.fn().mockResolvedValue({ tempPassword: null, existed: false }),
    adminGetMemberPackages: jest.fn().mockResolvedValue([]),
    refundPayment: jest.fn().mockResolvedValue({ id: 'rf1' }),
  },
  assetUrl: (u: string | null) => u,
}));

const renderPage = () => render(<ThemeProvider><AdminReservationsPage /></ThemeProvider>);

// jsdom n'implémente pas scrollIntoView — stub inoffensif.
Element.prototype.scrollIntoView = jest.fn();

const mkCourt = (id: string, name: string) => ({ id, name, attributes: {}, isActive: true, price: '52.00', offPeakPrice: null, openHour: 8, closeHour: 22, slotStepMin: null, clubSport: { id: 'cs', slotStepMin: null, durationsMin: [60], sport: { key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } } });
const mkResa = (id: string, resourceId: string, name: string, over: Record<string, unknown> = {}) => ({ id, resourceId, startTime: '2026-06-22T16:00:00.000Z', endTime: '2026-06-22T17:00:00.000Z', status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00', resource: { id: resourceId, name }, user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@x.fr' }, payments: [], participants: [], ...over });
const resp = (reservations: unknown[]) => ({ reservations, summary: { total: '0', paid: '0', paidTotal: '0', outstanding: '0' } });

// Réinitialise les compteurs d'appels entre les tests (les implémentations posées par
// jest.mock / mockResolvedValue sont conservées) pour des assertions de nombre fiables.
beforeEach(() => jest.clearAllMocks());

it('renomme la page en « Encaissement »', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Encaissement' })).toBeInTheDocument();
});

it('déplie une ligne par place : titulaire + 3 places « Associer un membre » (double)', async () => {
  renderPage();
  await screen.findByText('C1');
  expect(screen.getAllByRole('button', { name: /Associer un membre/ })).toHaveLength(3);
});

it('filtre « Non payé » et solde le reste en 1 clic (« Tout solder », CB)', async () => {
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getByRole('radio', { name: /Non payé/ }));
  const cb = screen.getAllByRole('button', { name: 'CB' });
  fireEvent.click(cb[cb.length - 1]);                             // dernier = « Tout solder »
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
    'club-1', 'rv-1', expect.objectContaining({ amount: 52, method: 'CARD' }), 'tok',
  ));
});

it('recherche par nom masque les non-correspondants', async () => {
  renderPage();
  await screen.findByText('C1');
  fireEvent.change(screen.getByPlaceholderText(/Rechercher un client/i), { target: { value: 'zzz' } });
  expect(screen.queryByText('C1')).not.toBeInTheDocument();
});

it('filtre « Soldé » masque les réservations encore à encaisser', async () => {
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getByRole('radio', { name: /Soldé/ }));   // rv-1 (non payée) doit disparaître
  expect(screen.queryByText('C1')).not.toBeInTheDocument();        // un seul terrain → pas de facette terrain dans le rail
});

it("encaisse la part d'un seul joueur (CB → participantId)", async () => {
  // Terrain single (capacité 2) → part = 26 / 2 = 13 par joueur.
  (api.adminGetResources as jest.Mock).mockResolvedValue([{ id: 'court-1', name: 'C1', attributes: { format: 'single' }, isActive: true, price: '26.00', offPeakPrice: null, openHour: 8, closeHour: 22, slotStepMin: null, clubSport: { id: 'cs', slotStepMin: null, durationsMin: [60], sport: { key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } } }]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue({ reservations: [
    { id: 'rv-2', resourceId: 'court-1', startTime: '2026-06-22T16:00:00.000Z', endTime: '2026-06-22T17:00:00.000Z', status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '26.00', paidAmount: '0.00', dueAmount: '26.00', resource: { id: 'court-1', name: 'C1' }, user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' }, payments: [], participants: [
      { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '0.00', outstanding: '13.00' },
      { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', share: '13.00', paid: '0.00', outstanding: '13.00' },
    ] },
  ], summary: { total: '26', paid: '0', paidTotal: '0', outstanding: '26' } });
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getAllByRole('button', { name: 'CB' })[0]);    // 1re ligne joueur = pt-1
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
    'club-1', 'rv-2', expect.objectContaining({ participantId: 'pt-1', method: 'CARD', amount: 13 }), 'tok',
  ));
});

it('affiche le bandeau KPI compact (Encaissé / Reste / Total)', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue({ reservations: [mkResa('rv-k', 'court-1', 'C1', { paidAmount: '12.00' })], summary: { total: '52', paid: '12', paidTotal: '12', outstanding: '40' } });
  renderPage();
  await screen.findByText('C1');
  expect(screen.getByText('Encaissé')).toBeInTheDocument();
  expect(screen.getByText('Reste')).toBeInTheDocument();
  expect(screen.getByText('Total')).toBeInTheDocument();
});

it('club sans moyen rapide configuré → repli sur le défaut (boutons 1 clic présents)', async () => {
  // Le club a tout décoché dans les réglages : la page doit rester encaissable en 1 clic.
  (api.adminGetClub as jest.Mock).mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris', offPeakHours: null, quickPaymentMethods: [] });
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([mkResa('rv-1', 'court-1', 'C1')]));
  renderPage();
  await screen.findByText('C1');
  expect(screen.getAllByRole('button', { name: 'CB' }).length).toBeGreaterThan(0);   // défaut CB/Ticket CE/Espèces
});

it('filtre par terrain : cocher un terrain masque les réservations des autres', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1'), mkCourt('court-2', 'C2')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    mkResa('rv-a', 'court-1', 'C1', { title: 'Match AAA' }),
    mkResa('rv-b', 'court-2', 'C2', { title: 'Match BBB' }),
  ]));
  renderPage();
  await screen.findByText('Match AAA');
  expect(screen.getByText('Match BBB')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /C2/ }));   // ne garder que le Terrain C2
  await waitFor(() => expect(screen.queryByText('Match AAA')).not.toBeInTheDocument());
  expect(screen.getByText('Match BBB')).toBeInTheDocument();
});

// ── Robustesse : « la dernière réponse gagne » (corrige le bug aléatoire) ─────
// Deux encaissements concurrents déclenchent deux rechargements ; si celui parti
// EN PREMIER revient EN DERNIER, il ne doit pas réécraser les données fraîches.
it('encaissements concurrents : une réponse périmée ne réécrase pas l’état (latest-wins)', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1'), mkCourt('court-2', 'C2')]);
  const unpaid = () => resp([
    mkResa('rv-1', 'court-1', 'C1', { type: 'COACHING' }),
    mkResa('rv-2', 'court-2', 'C2', { type: 'COACHING' }),
  ]);
  const paid = () => resp([
    mkResa('rv-1', 'court-1', 'C1', { type: 'COACHING', paidAmount: '52.00' }),
    mkResa('rv-2', 'court-2', 'C2', { type: 'COACHING', paidAmount: '52.00' }),
  ]);
  let n = 0;
  const deferred: Record<number, (v: unknown) => void> = {};
  (api.adminGetReservations as jest.Mock).mockImplementation(() => {
    n += 1;
    if (n === 1) return Promise.resolve(unpaid());                                  // chargement initial
    return new Promise((resolve) => { deferred[n] = resolve as (v: unknown) => void; }); // rechargements après encaissement
  });

  renderPage();
  await screen.findAllByText('Jean Dupont');                  // les 2 résas (événements libres) sont affichées
  expect(screen.getAllByRole('button', { name: 'CB' })).toHaveLength(2);

  fireEvent.click(screen.getAllByRole('button', { name: 'CB' })[0]);                // rv-1 → rechargement #2 (en attente)
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'CB' })).toHaveLength(1)); // rv-1 occupé (« … »)
  fireEvent.click(screen.getByRole('button', { name: 'CB' }));                      // rv-2 → rechargement #3 (en attente)
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledTimes(2));

  // On résout le PLUS RÉCENT (#3, à jour) PUIS le périmé (#2, anciennes données).
  await act(async () => { deferred[3](paid()); });
  await act(async () => { deferred[2](unpaid()); });

  // La réponse périmée ne doit pas refaire « réapparaître » le reste à encaisser.
  // (on scope à la liste : « Soldé » est aussi un libellé du filtre Statut dans le rail)
  const list = screen.getByTestId('resa-list');
  await waitFor(() => expect(within(list).getAllByText('Soldé')).toHaveLength(2));
  expect(screen.queryByRole('button', { name: 'CB' })).toBeNull();
});

// ── Rapidité : un encaissement ne recharge QUE les réservations (1 requête / 4) ──
it('un encaissement ne refait pas tout : seules les réservations sont rechargées', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([mkResa('rv-1', 'court-1', 'C1')]));
  renderPage();
  await screen.findByText('C1');
  expect(api.adminGetReservations).toHaveBeenCalledTimes(1);

  const cbs = screen.getAllByRole('button', { name: 'CB' });
  fireEvent.click(cbs[cbs.length - 1]);                         // « Tout solder » CB
  await waitFor(() => expect(api.adminGetReservations).toHaveBeenCalledTimes(2));
  expect(api.adminGetClub).toHaveBeenCalledTimes(1);            // config club PAS rechargée
  expect(api.adminGetResources).toHaveBeenCalledTimes(1);       // terrains PAS rechargés
  expect(api.adminGetMembers).toHaveBeenCalledTimes(1);         // membres PAS rechargés
});

// ── Annulation ───────────────────────────────────────────────────────────────
it('annule une réservation (confirmation → adminCancelReservation → recharge)', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([mkResa('rv-1', 'court-1', 'C1')]));
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));                 // pied de la ligne
  fireEvent.click(screen.getByRole('button', { name: 'Annuler la réservation' }));  // ConfirmDialog
  await waitFor(() => expect(api.adminCancelReservation).toHaveBeenCalledWith('club-1', 'rv-1', 'tok'));
});

it('double-clic sur la confirmation n’annule qu’une seule fois', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([mkResa('rv-1', 'court-1', 'C1')]));
  let release: (v: unknown) => void = () => {};
  (api.adminCancelReservation as jest.Mock).mockImplementation(() => new Promise((r) => { release = r as (v: unknown) => void; }));
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  const confirm = screen.getByRole('button', { name: 'Annuler la réservation' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);   // 2e clic immédiat (requête encore en vol)
  expect(api.adminCancelReservation).toHaveBeenCalledTimes(1);
  await act(async () => { release({}); });
});

// ── Filtres ───────────────────────────────────────────────────────────────────
it('filtre par plage horaire (De/à) masque les créneaux hors plage', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([mkResa('rv-1', 'court-1', 'C1')])); // 18h (Europe/Paris)
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getByRole('button', { name: 'Tout afficher' }));   // date='' → options 8h..22h
  fireEvent.click(screen.getByRole('button', { name: 'Plage…' }));          // déplie les sélecteurs De/à
  const selects = screen.getAllByRole('combobox');                           // [De, à]
  fireEvent.change(selects[0], { target: { value: '20' } });                 // De 20h → le créneau de 18h sort
  await waitFor(() => expect(screen.queryByText('C1')).not.toBeInTheDocument());
  fireEvent.change(selects[0], { target: { value: '18' } });                 // De 18h → réapparaît
  expect(screen.getByText('C1')).toBeInTheDocument();
});

it('« Réinitialiser » remet les filtres à zéro', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([mkResa('rv-1', 'court-1', 'C1')]));
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getByRole('radio', { name: /Soldé/ }));      // masque rv-1 (non payée)
  expect(screen.queryByText('C1')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Réinitialiser/ }));
  expect(screen.getByText('C1')).toBeInTheDocument();
});

it('« Maintenant » active un filtre de créneau', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([mkResa('rv-1', 'court-1', 'C1')]));
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getByRole('button', { name: 'Maintenant' }));
  expect(screen.getByRole('button', { name: /Réinitialiser/ })).toBeInTheDocument();
});

// ── Encaissement optimiste (« très rapide ») ─────────────────────────────────
// Terrain single (capacité 2, 26 € → part 13 €) avec 2 joueurs nommés.
const singleCourt = () => ({ ...mkCourt('court-1', 'C1'), attributes: { format: 'single' }, price: '26.00' });
const twoPlayerResa = (over: Record<string, unknown> = {}) => mkResa('rv-1', 'court-1', 'C1', {
  totalPrice: '26.00', dueAmount: '26.00', participants: [
    { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '0.00', outstanding: '13.00' },
    { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', share: '13.00', paid: '0.00', outstanding: '13.00' },
  ], ...over,
});

it('la part passe « réglé » AU CLIC, sans attendre le serveur (optimiste)', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  // 1er chargement immédiat ; la réconciliation est DIFFÉRÉE (jamais résolue) pour prouver l'optimisme.
  let n = 0;
  (api.adminGetReservations as jest.Mock).mockImplementation(() => {
    n += 1;
    return n === 1 ? Promise.resolve(resp([twoPlayerResa()])) : new Promise(() => {});
  });
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getAllByRole('button', { name: 'CB' })[0]);   // Jean (pt-1)
  // « réglé » apparaît sur la ligne de Jean immédiatement, alors que la réconciliation est en attente.
  const jeanRow = (await screen.findByText('Jean Test')).closest('div') as HTMLElement;
  expect(within(jeanRow).getByText('réglé')).toBeInTheDocument();
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
    'club-1', 'rv-1', expect.objectContaining({ participantId: 'pt-1', amount: 13, method: 'CARD' }), 'tok',
  ));
});

it('deux encaissements rapides : 2 parts « réglé » au clic, une seule réconciliation', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  let n = 0;
  (api.adminGetReservations as jest.Mock).mockImplementation(() => {
    n += 1;
    return n === 1 ? Promise.resolve(resp([twoPlayerResa()])) : new Promise(() => {});
  });
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getAllByRole('button', { name: 'CB' })[0]);   // Jean
  fireEvent.click(screen.getAllByRole('button', { name: 'CB' })[0]);   // Léa (1re CB restante — pas de verrou)
  await waitFor(() => expect(screen.getAllByText('réglé')).toHaveLength(2));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledTimes(2));
  // 1 chargement initial + 1 seule réconciliation en fin de file (pas une par paiement).
  await waitFor(() => expect(api.adminGetReservations).toHaveBeenCalledTimes(2));
});

it('« annuler » un règlement le remet à encaisser AU CLIC (optimiste)', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  const paidResa = twoPlayerResa({ paidAmount: '13.00',
    participants: [
      { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '13.00', outstanding: '0.00' },
      { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', share: '13.00', paid: '0.00', outstanding: '13.00' },
    ],
    payments: [{ id: 'pay-1', amount: '13.00', method: 'CARD', participantId: 'pt-1', refundedAmount: '0.00', payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-06-22T16:05:00.000Z' }],
  });
  let n = 0;
  (api.adminGetReservations as jest.Mock).mockImplementation(() => {
    n += 1;
    return n === 1 ? Promise.resolve(resp([paidResa])) : new Promise(() => {});
  });
  renderPage();
  await screen.findByText('C1');
  expect(screen.getByText('réglé')).toBeInTheDocument();          // Jean réglé au départ
  fireEvent.click(screen.getByRole('button', { name: 'annuler' }));
  await waitFor(() => expect(screen.queryByText('réglé')).toBeNull());   // remboursé instantanément
  await waitFor(() => expect(api.refundPayment).toHaveBeenCalledWith(
    'club-1', 'pay-1', expect.objectContaining({ amount: 13 }), 'tok',
  ));
});
