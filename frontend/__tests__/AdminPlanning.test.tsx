import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AdminPlanningPage from '../app/admin/planning/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', slug: 'c' } }) }));
// Le planning lit useAdminChrome depuis le layout admin — mocké pour ne pas charger
// tout le chrome (sidebar, gardes de droits) dans un test de page isolé.
jest.mock('../app/admin/layout', () => ({ useAdminChrome: () => ({ collapsed: false, setCollapsed: jest.fn() }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetClub: jest.fn().mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris', offPeakHours: null, quickPaymentMethods: ['CARD', 'VOUCHER', 'CASH'], payAtClubOnly: false }),
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
    adminCreateReservation: jest.fn().mockResolvedValue({ id: 'new-1' }),
    adminRescheduleReservation: jest.fn().mockResolvedValue({ id: 'rv-1' }),
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
// Abonnement ACTIF (non expiré) — pour afficher les règlements sans encaissement (dans « Détails »).
const activeSub = () => [{ id: 's1', status: 'ACTIVE', expiresAt: '2099-01-01T00:00:00.000Z' }];

// Ouvre la modale de détail en cliquant le pavé de la réservation dans la grille.
const openModal = async () => {
  fireEvent.click((await screen.findByText('Jean Test')).closest('button') as HTMLElement);
};

beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });

it("encaisse la part du joueur présélectionné (tuile) avec un moyen, sans fermer la modale", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
  renderPage();
  await openModal();
  // Caisse : Jean (pt-1) est la 1re tuile, présélectionnée ; on encaisse en CB.
  fireEvent.click(await screen.findByRole('button', { name: 'CB' }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
    'club-1', 'rv-1', expect.objectContaining({ participantId: 'pt-1', method: 'CARD', amount: 13 }), 'tok',
  ));
  expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();   // modale toujours ouverte
});

it('les joueurs sont des tuiles cliquables (pas un bouton « Régler ») et les moyens un seul jeu', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
  renderPage();
  await openModal();
  await screen.findByRole('button', { name: 'CB' });
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);                 // une tuile sélectionnable par joueur
  expect(screen.queryByRole('button', { name: 'Régler' })).toBeNull();     // plus de bouton « Régler »
  expect(screen.getAllByRole('button', { name: 'CB' })).toHaveLength(1);   // un seul jeu de moyens
});

it('propose les mêmes moyens que la page Caisse (CB, Espèces, Ticket CE, Virement, Chèque)', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
  renderPage();
  await openModal();
  await screen.findByRole('button', { name: 'CB' });
  ['Espèces', 'Ticket CE', 'Virement', 'Chèque'].forEach((l) =>
    expect(screen.getByRole('button', { name: l })).toBeInTheDocument());
});

it('encaisse toutes les parts (« Tout le reste ») → la caisse passe à « Soldé »', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  let n = 0;
  (api.adminGetReservations as jest.Mock).mockImplementation(() => {
    n += 1;
    return Promise.resolve(resp([n === 1 ? twoPlayerResa() : twoPlayerResa({ paidAmount: '26.00', participants: paidParticipants() })]));
  });
  renderPage();
  await openModal();
  fireEvent.click(await screen.findByRole('button', { name: /Tout le reste/ }));   // sélectionne les 2 parts
  fireEvent.click(screen.getByRole('button', { name: 'CB' }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalled());
  expect(await screen.findByText(/Soldé/)).toBeInTheDocument();
});

it("permet de sélectionner une place SANS joueur et d'encaisser sa part (anonyme)", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([doubleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([oneNamedResa()]));
  renderPage();
  await openModal();
  await screen.findByRole('button', { name: 'CB' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Joueur 2' }));   // ajoute la 1re place vide à la sélection
  fireEvent.click(screen.getByRole('button', { name: 'CB' }));
  await waitFor(() => {
    const call = (api.adminAddPayment as jest.Mock).mock.calls.at(-1)!;
    expect(call[2]).toMatchObject({ amount: 13, method: 'CARD' });   // une part (52/4), anonyme
    expect(call[2].participantId).toBeUndefined();
  });
});

describe('pastilles-initiales de paiement + panneau au survol', () => {
  it('les vignettes affichent des pastilles-initiales (qui a payé) au lieu de points anonymes', async () => {
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
    renderPage();
    await screen.findByText('Jean Test');
    expect(screen.getByText('JT')).toBeInTheDocument();
    expect(screen.getByText('LR')).toBeInTheDocument();
  });

  it('le title du bloc ne détaille plus payé/dû (remplacé par le survol)', async () => {
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
    renderPage();
    const block = (await screen.findByText('Jean Test')).closest('button') as HTMLElement;
    expect(block.title).not.toMatch(/payé/);
    expect(block.title).toMatch(/Jean Test · Terrain/);
  });

  it('un survol prolongé (~400ms) ouvre un panneau détaillant qui a payé et le reste dû', async () => {
    jest.useFakeTimers();
    // Double (52 €, 4 places) : pt-1 (Jean Test) réglé, pt-2 (Léa Roy) doit encore, 2 places
    // vides — le "reste" du total (39 €) diffère de celui de Léa Roy (13 €) : pas d'ambiguïté
    // de texte entre la ligne joueur et la ligne de total.
    (api.adminGetResources as jest.Mock).mockResolvedValue([doubleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa({
      totalPrice: '52.00', dueAmount: '52.00', paidAmount: '13.00',
      participants: [
        { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '13.00', outstanding: '0.00' },
        { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', share: '13.00', paid: '0.00', outstanding: '13.00' },
      ],
    })]));
    renderPage();
    const block = (await screen.findByText('Jean Test')).closest('button') as HTMLElement;
    fireEvent.mouseEnter(block);
    expect(screen.queryByText(/Léa Roy/)).toBeNull();          // pas immédiat
    act(() => { jest.advanceTimersByTime(400); });
    expect(screen.getByText(/Léa Roy/)).toBeInTheDocument();
    expect(screen.getByText(/reste 13/)).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('le panneau ne s’ouvre pas si la souris quitte le bloc avant le délai', async () => {
    jest.useFakeTimers();
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
    renderPage();
    const block = (await screen.findByText('Jean Test')).closest('button') as HTMLElement;
    fireEvent.mouseEnter(block);
    fireEvent.mouseLeave(block);
    act(() => { jest.advanceTimersByTime(400); });
    expect(screen.queryByText(/Léa Roy/)).toBeNull();
    jest.useRealTimers();
  });

  it('un mousedown (début de drag) annule un survol en cours', async () => {
    jest.useFakeTimers();
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
    renderPage();
    const block = (await screen.findByText('Jean Test')).closest('button') as HTMLElement;
    fireEvent.mouseEnter(block);
    fireEvent.mouseDown(block, { clientY: 300 });
    act(() => { jest.advanceTimersByTime(400); });
    expect(screen.queryByText(/Léa Roy/)).toBeNull();
    fireEvent.mouseUp(window);
    jest.useRealTimers();
  });
});

it('le lien « Montant libre… » ouvre les options avancées (Coffre / Offres / Abonnement)', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
  (api.adminGetMemberSubscriptions as jest.Mock).mockResolvedValue(activeSub());   // titulaire abonné actif
  renderPage();
  await openModal();
  fireEvent.click(await screen.findByRole('button', { name: /Montant libre/ }));   // ouvre « Détails · options »
  await screen.findByRole('button', { name: 'Coffre' });
  ['Offres', 'Abonnement'].forEach((l) => expect(screen.getByRole('button', { name: l })).toBeInTheDocument());
});

it('option club « paiement au club » : un seul bouton « Encaissé » (moyen CLUB), pas de choix de moyen', async () => {
  (api.adminGetClub as jest.Mock).mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris', offPeakHours: null, quickPaymentMethods: ['CARD', 'VOUCHER', 'CASH'], payAtClubOnly: true });
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
  renderPage();
  await openModal();
  const encaisse = await screen.findByRole('button', { name: /Encaissé/ });
  expect(screen.queryByRole('button', { name: 'CB' })).toBeNull();       // pas de choix de moyen
  fireEvent.click(encaisse);
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
    'club-1', 'rv-1', expect.objectContaining({ method: 'CLUB', amount: 13 }), 'tok',
  ));
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

it('bouton « Ajouter » → modale Studio préremplie → adminCreateReservation avec le bon body', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([]));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Ajouter' }));
  fireEvent.click(await screen.findByRole('button', { name: /Créer l'événement/ }));
  await waitFor(() => expect(api.adminCreateReservation).toHaveBeenCalledWith(
    'club-1', expect.objectContaining({ resourceId: 'court-1', type: 'COURT' }), 'tok',
  ));
});

// HOUR_H = 68px : 17px = 15 min pile, 68px = 60 min pile. jsdom renvoie des rects à zéro par
// défaut (top:0), donc clientY se lit directement comme un décalage en px depuis le haut de
// la grille — pas besoin de mocker getBoundingClientRect.
describe('drag & drop de la grille', () => {
  const today = new Date().toISOString().slice(0, 10);

  beforeEach(() => {
    // jsdom n'implémente pas elementFromPoint par défaut ; repli neutre, écrasé par test si besoin.
    (document as any).elementFromPoint = jest.fn(() => null);
  });

  it('créer en glissant sur une case vide ouvre la modale préremplie (début + durée dessinés)', async () => {
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([]));
    const { container } = render(<ThemeProvider><AdminPlanningPage /></ThemeProvider>);
    const col = await waitFor(() => {
      const el = container.querySelector('[data-resource-id="court-1"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // Ancre 17:00 (openHour=8 → 480min ; clientY=612 → +540min → 1020min = 17:00 pile).
    fireEvent.mouseDown(col, { clientY: 612 });
    fireEvent.mouseMove(window, { clientY: 612 + 68 }); // +60 min → fin 18:00
    fireEvent.mouseUp(window);

    expect(await screen.findByText("Nouvel événement")).toBeInTheDocument();
    expect(screen.getByDisplayValue('17:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1h' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('déplacer un bloc (même terrain) optimiste + adminRescheduleReservation + toast Annuler qui revert', async () => {
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa({
      startTime: '2099-06-22T16:00:00.000Z', endTime: '2099-06-22T17:00:00.000Z', // 18:00–19:00 Paris (été)
    })]));
    const { container } = render(<ThemeProvider><AdminPlanningPage /></ThemeProvider>);
    const block = (await screen.findByText('Jean Test')).closest('button') as HTMLElement;
    const col = container.querySelector('[data-resource-id="court-1"]') as HTMLElement;
    (document as any).elementFromPoint = jest.fn(() => col);

    fireEvent.mouseDown(block, { clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 0, clientY: 300 + 68 }); // +60 min
    fireEvent.mouseUp(window);

    await waitFor(() => expect(api.adminRescheduleReservation).toHaveBeenCalledWith(
      'club-1', 'rv-1', { resourceId: 'court-1', date: today, startTime: '19:00', endTime: '20:00' }, 'tok',
    ));
    expect(await screen.findByRole('button', { name: 'Annuler' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(api.adminRescheduleReservation).toHaveBeenLastCalledWith(
      'club-1', 'rv-1', { resourceId: 'court-1', date: today, startTime: '18:00', endTime: '19:00' }, 'tok',
    ));
  });

  it("étirer la poignée basse d'un bloc change la fin sans toucher au début", async () => {
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa({
      startTime: '2099-06-22T16:00:00.000Z', endTime: '2099-06-22T17:00:00.000Z', // 18:00–19:00 Paris
    })]));
    const { container } = render(<ThemeProvider><AdminPlanningPage /></ThemeProvider>);
    await screen.findByText('Jean Test');
    const handle = container.querySelector('[aria-label="Étirer la durée"]') as HTMLElement;
    expect(handle).not.toBeNull();

    fireEvent.mouseDown(handle, { clientY: 300 });
    fireEvent.mouseMove(window, { clientY: 300 + 34 }); // +30 min → fin 19:30
    fireEvent.mouseUp(window);

    await waitFor(() => expect(api.adminRescheduleReservation).toHaveBeenCalledWith(
      'club-1', 'rv-1', { resourceId: 'court-1', date: today, startTime: '18:00', endTime: '19:30' }, 'tok',
    ));
  });

  it('un déplacement sur un créneau déjà occupé (conflit) est ignoré (pas d\'appel API)', async () => {
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
      twoPlayerResa({ id: 'rv-1', startTime: '2099-06-22T16:00:00.000Z', endTime: '2099-06-22T17:00:00.000Z' }), // 18:00–19:00
      twoPlayerResa({ id: 'rv-2', startTime: '2099-06-22T17:00:00.000Z', endTime: '2099-06-22T18:00:00.000Z', user: { id: 'u9', firstName: 'Marie', lastName: 'Roy', email: 'm@x.fr' } }), // 19:00–20:00
    ]));
    const { container } = render(<ThemeProvider><AdminPlanningPage /></ThemeProvider>);
    const block = (await screen.findByText('Jean Test')).closest('button') as HTMLElement;
    const col = container.querySelector('[data-resource-id="court-1"]') as HTMLElement;
    (document as any).elementFromPoint = jest.fn(() => col);

    fireEvent.mouseDown(block, { clientY: 300 });
    fireEvent.mouseMove(window, { clientY: 300 + 68 }); // viserait 19:00–20:00 → chevauche rv-2
    fireEvent.mouseUp(window);

    expect(api.adminRescheduleReservation).not.toHaveBeenCalled();
  });
});
