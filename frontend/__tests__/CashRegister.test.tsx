import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CashRegister } from '../components/admin/caisse/CashRegister';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, ClubReservation, PaymentMethod } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'real-1' }),
    refundPayment: jest.fn().mockResolvedValue({ id: 'rf-1' }),
    adminAssignReservationMember: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminAddReservationParticipant: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminChangeReservationParticipant: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminAssignReservationMemberNew: jest.fn().mockResolvedValue({ id: 'rv-1', createdMember: { userId: 'u-new', tempPassword: 'tmp', existed: false } }),
    adminAddReservationParticipantNew: jest.fn().mockResolvedValue({ id: 'rv-1', createdMember: { userId: 'u-new', tempPassword: 'tmp', existed: false } }),
    adminChangeReservationParticipantNew: jest.fn().mockResolvedValue({ id: 'rv-1', createdMember: { userId: 'u-new', tempPassword: 'tmp', existed: false } }),
    adminCreateMember: jest.fn().mockResolvedValue({ tempPassword: null, existed: false, userId: 'u-new' }),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    searchClubMembers: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));

const part = (id: string, userId: string, first: string, last: string, paid = '0.00') => ({
  id, userId, isOrganizer: false, firstName: first, lastName: last, paid, share: '13.00', outstanding: '13.00',
});
const rv = (over: Record<string, unknown> = {}): ClubReservation => ({
  id: 'rv-1', resourceId: 'court-1', startTime: '2099-06-22T16:00:00.000Z', endTime: '2099-06-22T17:00:00.000Z',
  status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00',
  resource: { id: 'court-1', name: 'Padel int 1' },
  user: { id: 'u0', firstName: 'Jean', lastName: 'Dupont', email: 'j@x.fr' },
  payments: [], participants: [], ...over,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

const baseProps = () => ({
  players: 4, due: 5200, members: [], quickMethods: ['CARD', 'VOUCHER', 'CASH'] as PaymentMethod[],
  packagesByUser: {}, clubId: 'club-1', slug: 'padel-arena-paris', token: 'tok', isDesktop: true, payAtClubOnly: false,
  onChanged: jest.fn(), onOptimisticPay: jest.fn().mockReturnValue('opt:1'),
  onOptimisticRefund: jest.fn(), onOpenDetails: jest.fn(), onCancel: jest.fn(),
  onError: jest.fn(), onSettled: jest.fn(),
});

const renderReg = (r: ClubReservation, props = baseProps()) =>
  render(<ThemeProvider><CashRegister reservation={r} {...props} /></ThemeProvider>);

beforeEach(() => { jest.clearAllMocks(); });

it('pré-sélectionne la première place non réglée et affiche sa part en grand', () => {
  renderReg(rv());
  const tiles = screen.getAllByRole('checkbox');
  expect(tiles[0]).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('1 joueur sélectionné')).toBeInTheDocument();
  expect(screen.getByTestId('cx-total')).toHaveTextContent('13 €');
});

it('tuile sélectionnée mais non payée : pas de pastille ✓ (seul l\'anneau signale la sélection, pour ne pas laisser croire que c\'est réglé)', () => {
  renderReg(rv());
  const tiles = screen.getAllByRole('checkbox');
  expect(tiles[0]).toHaveAttribute('aria-checked', 'true');
  expect(tiles[0].querySelector('span[aria-hidden]')).toBeNull();
});

it('tuile réglée : la pastille ✓ reste affichée', () => {
  const r = rv({
    participants: [part('pt-1', 'u1', 'Léa', 'Roy', '13.00'), part('pt-2', 'u2', 'Max', 'Bo')],
    payments: [{ id: 'p1', amount: '13.00', method: 'CASH', participantId: 'pt-1', payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2099-06-22T15:00:00.000Z', refundedAmount: '0.00', receiptNo: null }],
    paidAmount: '13.00',
  });
  renderReg(r);
  const paidTile = screen.getByRole('checkbox', { name: /Léa Roy/ });
  expect(paidTile.querySelector('span[aria-hidden]')).not.toBeNull();
});

it('multi-sélection : cocher une 2e tuile cumule le montant', () => {
  renderReg(rv());
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  expect(screen.getByText('2 joueurs sélectionnés')).toBeInTheDocument();
  expect(screen.getByTestId('cx-total')).toHaveTextContent('26 €');
});

it('CB sur une multi-sélection : un adminAddPayment PAR place, avec participantId pour les nommées', async () => {
  const r = rv({ participants: [part('pt-1', 'u1', 'Léa', 'Roy'), part('pt-2', 'u2', 'Max', 'Bo')] });
  renderReg(r);
  fireEvent.click(screen.getAllByRole('checkbox')[1]);              // pt-2 s'ajoute à pt-1
  fireEvent.click(screen.getByRole('button', { name: /CB/ }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledTimes(2));
  expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1',
    expect.objectContaining({ amount: 13, method: 'CARD', participantId: 'pt-1' }), 'tok');
  expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1',
    expect.objectContaining({ amount: 13, method: 'CARD', participantId: 'pt-2' }), 'tok');
});

it('« Tout le reste » sélectionne toutes les places non réglées', () => {
  renderReg(rv());
  fireEvent.click(screen.getByRole('button', { name: /Tout le reste/ }));
  expect(screen.getByText('4 joueurs sélectionnés')).toBeInTheDocument();
  expect(screen.getByTestId('cx-total')).toHaveTextContent('52 €');
});

it('carnet contextuel : visible en mono-sélection quand le joueur a un solde, masqué en multi', () => {
  const r = rv({ participants: [part('pt-1', 'u1', 'Léa', 'Roy'), part('pt-2', 'u2', 'Max', 'Bo')] });
  const props = { ...baseProps(), packagesByUser: { u1: [
    { id: 'pk-1', userId: 'u1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 3, amountTotal: null, amountRemaining: null, purchasedAt: '', expiresAt: null },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] } as any };
  renderReg(r, props);
  expect(screen.getByRole('button', { name: /Carnet/ })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('checkbox')[1]);   // multi → masqué
  expect(screen.queryByRole('button', { name: /Carnet/ })).not.toBeInTheDocument();
});

it('paiement carnet : PACK_CREDIT + sourcePackageId + participantId', async () => {
  const r = rv({ participants: [part('pt-1', 'u1', 'Léa', 'Roy')] });
  const props = { ...baseProps(), packagesByUser: { u1: [
    { id: 'pk-1', userId: 'u1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 3, amountTotal: null, amountRemaining: null, purchasedAt: '', expiresAt: null },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] } as any };
  renderReg(r, props);
  fireEvent.click(screen.getByRole('button', { name: /Carnet/ }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1',
    expect.objectContaining({ method: 'PACK_CREDIT', sourcePackageId: 'pk-1', participantId: 'pt-1', amount: 13 }), 'tok'));
});

it('toast après encaissement : « Annuler » rembourse (optimiste + réseau) et bloque onSettled', async () => {
  jest.useFakeTimers();
  const props = baseProps();
  renderReg(rv(), props);
  fireEvent.click(screen.getByRole('button', { name: /CB/ }));
  // le toast apparaît avec le lien Annuler
  const undo = await screen.findByRole('button', { name: 'Annuler' });
  // attendre que la file ait persisté le paiement (id réel collecté)
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(undo);
  expect(props.onOptimisticRefund).toHaveBeenCalled();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.refundPayment).toHaveBeenCalledWith('club-1', 'real-1',
    expect.objectContaining({ amount: 13 }), 'tok');
  act(() => { jest.advanceTimersByTime(7000); });
  expect(props.onSettled).not.toHaveBeenCalled();
  jest.useRealTimers();
});

it('lot qui solde la résa : onSettled appelé à l\'expiration du toast (desktop)', async () => {
  jest.useFakeTimers();
  const props = baseProps();
  renderReg(rv(), props);
  fireEvent.click(screen.getByRole('button', { name: /Tout le reste/ }));
  fireEvent.click(screen.getByRole('button', { name: /CB/ }));
  await screen.findByRole('button', { name: 'Annuler' });
  act(() => { jest.advanceTimersByTime(7000); });
  expect(props.onSettled).toHaveBeenCalled();
  jest.useRealTimers();
});

it('place réglée : ✓ + moyen + « annuler » qui rembourse le paiement de la place', async () => {
  const r = rv({
    participants: [part('pt-1', 'u1', 'Léa', 'Roy', '13.00'), part('pt-2', 'u2', 'Max', 'Bo')],
    payments: [{ id: 'p1', amount: '13.00', method: 'CASH', participantId: 'pt-1', payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2099-06-22T15:00:00.000Z', refundedAmount: '0.00', receiptNo: null }],
    paidAmount: '13.00',
  });
  const props = baseProps();
  renderReg(r, props);
  expect(screen.getByText(/réglé/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'annuler' }));
  expect(props.onOptimisticRefund).toHaveBeenCalledWith(['p1']);
  await waitFor(() => expect(api.refundPayment).toHaveBeenCalledWith('club-1', 'p1',
    expect.objectContaining({ amount: 13 }), 'tok'));
});

it('événement (type EVENT) : pas de tuiles, « Encaisser » règle le reste en anonyme', async () => {
  const r = rv({ type: 'EVENT', totalPrice: '40.00', dueAmount: '40.00' });
  renderReg(r, { ...baseProps(), due: 4000, players: 0 });
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: /CB/ }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1',
    expect.objectContaining({ amount: 40, method: 'CARD' }), 'tok'));
  expect((api.adminAddPayment as jest.Mock).mock.calls[0][2].participantId).toBeUndefined();
});

it('résa sans prix (due 0) : bouton « Encaisser un montant… » → onOpenDetails', () => {
  const r = rv({ totalPrice: '0.00', dueAmount: '0.00' });
  const props = baseProps();
  renderReg(r, { ...props, due: 0 });
  fireEvent.click(screen.getByRole('button', { name: /Encaisser un montant/ }));
  expect(props.onOpenDetails).toHaveBeenCalled();
});

it('résa soldée : bandeau ✓ Soldé, pas de boutons de paiement', () => {
  const r = rv({ payments: [{ id: 'p1', amount: '52.00', method: 'CARD', participantId: null, payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2099-06-22T15:00:00.000Z', refundedAmount: '0.00', receiptNo: null }], paidAmount: '52.00' });
  renderReg(r);
  expect(screen.getByText(/Soldé/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /CB/ })).not.toBeInTheDocument();
});

it('« associer un membre » sur une place générique ouvre le sélecteur de membre', () => {
  renderReg(rv());
  fireEvent.click(screen.getAllByRole('button', { name: /associer/i })[0]);
  expect(screen.getByPlaceholderText(/Rechercher un membre/)).toBeInTheDocument();
});

it('choisir un membre de l\'annuaire associe un participant (résa avec titulaire)', async () => {
  (api.searchClubMembers as jest.Mock).mockResolvedValueOnce([
    { id: 'u9', firstName: 'Nora', lastName: 'Kaci', level: null },
  ]);
  const props = baseProps();
  renderReg(rv(), props);
  fireEvent.click(screen.getAllByRole('button', { name: /associer/i })[0]);
  const pick = await screen.findByRole('button', { name: /Nora Kaci/ });
  fireEvent.click(pick);
  await waitFor(() => expect(api.adminAddReservationParticipant).toHaveBeenCalledWith('club-1', 'rv-1', 'u9', 'tok'));
});

it('associer un membre sélectionne (focus) la place tout juste associée', async () => {
  (api.searchClubMembers as jest.Mock).mockResolvedValueOnce([
    { id: 'u9', firstName: 'Nora', lastName: 'Kaci', level: null },
  ]);
  renderReg(rv());
  expect(screen.getAllByRole('checkbox')[0]).toHaveAttribute('aria-checked', 'true');   // place 0 (titulaire) par défaut
  fireEvent.click(screen.getAllByRole('button', { name: /associer/i })[0]);             // place 1 (1re générique)
  fireEvent.click(await screen.findByRole('button', { name: /Nora Kaci/ }));
  await waitFor(() => expect(api.adminAddReservationParticipant).toHaveBeenCalled());
  const tiles = screen.getAllByRole('checkbox');
  expect(tiles[1]).toHaveAttribute('aria-checked', 'true');
  expect(tiles[0]).toHaveAttribute('aria-checked', 'false');
});

it('cliquer un membre affiche un retour immédiat pendant l\'appel réseau (pas figé)', async () => {
  (api.searchClubMembers as jest.Mock).mockResolvedValueOnce([
    { id: 'u9', firstName: 'Nora', lastName: 'Kaci', level: null },
  ]);
  let resolve!: (v: unknown) => void;
  (api.adminAddReservationParticipant as jest.Mock).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  renderReg(rv());
  fireEvent.click(screen.getAllByRole('button', { name: /associer/i })[0]);
  fireEvent.click(await screen.findByRole('button', { name: /Nora Kaci/ }));
  expect(await screen.findByText('Association…')).toBeInTheDocument();
  await act(async () => { resolve({ id: 'rv-1' }); });
});

it('créer un nouveau joueur l\'associe en UN SEUL appel réseau (endpoint fusionné, pas de refetch annuaire)', async () => {
  renderReg(rv());
  fireEvent.click(screen.getAllByRole('button', { name: /associer/i })[0]);
  fireEvent.click(screen.getByRole('button', { name: /Créer un joueur/ }));
  fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Jo' } });
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Doe' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jo@x.fr' } });
  fireEvent.click(screen.getByRole('button', { name: /Créer le joueur/ }));
  await waitFor(() => expect(api.adminAddReservationParticipantNew).toHaveBeenCalledWith(
    'club-1', 'rv-1', expect.objectContaining({ firstName: 'Jo', lastName: 'Doe', email: 'jo@x.fr' }), 'tok',
  ));
  expect(api.adminCreateMember).not.toHaveBeenCalled();
  expect(api.adminGetMembers).not.toHaveBeenCalled();
});

it('payAtClubOnly : un seul bouton « Encaissé » (moyen CLUB), pas de choix de moyen', async () => {
  const r = rv({ participants: [part('pt-1', 'u1', 'Léa', 'Roy')] });   // pt-1 présélectionné (part 13 €)
  renderReg(r, { ...baseProps(), payAtClubOnly: true });
  expect(screen.queryByRole('button', { name: 'CB' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Espèces' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Encaissé/ }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1',
    expect.objectContaining({ method: 'CLUB', amount: 13, participantId: 'pt-1' }), 'tok'));
});
