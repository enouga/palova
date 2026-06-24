import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ReservationCollect } from '../components/admin/ReservationCollect';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'p1' }),
    adminAssignReservationMember: jest.fn().mockResolvedValue({ id: 'r1' }),
    adminAddReservationParticipant: jest.fn().mockResolvedValue({ id: 'r1' }),
    adminCreateMember: jest.fn().mockResolvedValue({ tempPassword: null, existed: false }),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    refundPayment: jest.fn().mockResolvedValue({ id: 'rf1' }),
  },
  assetUrl: (u: string | null) => u,
}));

const part = (id: string, first: string, last: string, over: Partial<{ isOrganizer: boolean; paid: string; share: string; outstanding: string }> = {}) => ({
  id, userId: 'u-' + id, isOrganizer: over.isOrganizer ?? false, firstName: first, lastName: last,
  paid: over.paid ?? '0.00', share: over.share ?? '13.00', outstanding: over.outstanding ?? '13.00',
});

const baseResa = (over: any = {}) => ({
  id: 'r1', resourceId: 'court-1', startTime: '2026-06-22T16:00:00.000Z', endTime: '2026-06-22T17:00:00.000Z',
  status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00',
  resource: { id: 'court-1', name: 'C1' }, user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' },
  payments: [], participants: [], ...over,
});

const renderCollect = (props: any = {}) => render(
  <ThemeProvider>
    <ReservationCollect
      reservation={props.reservation ?? baseResa()} players={props.players ?? 4} due={props.due ?? 5200}
      members={props.members ?? []} quickMethods={props.quickMethods ?? ['CARD', 'VOUCHER', 'CASH']}
      clubId="club-1" token="tok"
      onChanged={props.onChanged ?? jest.fn()} onOpenDetails={props.onOpenDetails ?? jest.fn()} onCancel={props.onCancel} onError={props.onError ?? jest.fn()} />
  </ThemeProvider>
);

beforeEach(() => jest.clearAllMocks());

it('double : titulaire seul → 3 places vides « Associer un membre »', () => {
  renderCollect();
  expect(screen.getAllByRole('button', { name: /Associer un membre/ })).toHaveLength(3);
});

it('single (players=2) avec 1 participant → 1 place vide', () => {
  const reservation = baseResa({ participants: [part('pt-1', 'Jean', 'Test', { share: '52.00', outstanding: '52.00' })] });
  renderCollect({ reservation, players: 2 });
  expect(screen.getAllByRole('button', { name: /Associer un membre/ })).toHaveLength(1);
});

it('clic sur un moyen d\'une ligne joueur encaisse SA part (participantId)', async () => {
  const reservation = baseResa({ totalPrice: '26.00', dueAmount: '26.00', participants: [
    part('pt-1', 'Jean', 'Test', { isOrganizer: true }), part('pt-2', 'Léa', 'Roy'),
  ] });
  renderCollect({ reservation, due: 2600, players: 2 }); // 2 places → part = 26/2 = 13
  fireEvent.click(screen.getAllByRole('button', { name: 'CB' })[0]); // 1re ligne joueur = pt-1
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
    'club-1', 'r1', expect.objectContaining({ participantId: 'pt-1', amount: 13, method: 'CARD' }), 'tok',
  ));
});

it('« réglé » suit le joueur qui a payé, pas la position (attribution correcte)', () => {
  // 4 joueurs nommés, dû 50 → part 12,50 ; seul Karim (4e ligne) a payé sa part.
  const reservation = baseResa({ totalPrice: '50.00', dueAmount: '50.00', paidAmount: '12.50', participants: [
    part('p1', 'Jean', 'Dupont', { isOrganizer: true, share: '12.50', paid: '0.00', outstanding: '12.50' }),
    part('p2', 'Ines', 'Andre', { share: '12.50', paid: '0.00', outstanding: '12.50' }),
    part('p3', 'Celine', 'Barbier', { share: '12.50', paid: '0.00', outstanding: '12.50' }),
    part('p4', 'Karim', 'Benali', { share: '12.50', paid: '12.50', outstanding: '0.00' }),
  ] });
  renderCollect({ reservation, due: 5000, players: 4 });
  // Karim est « réglé » sur SA ligne ; Ines (qui n'a pas payé) ne l'est pas.
  const karimRow = screen.getByText('Karim Benali').closest('div') as HTMLElement;
  expect(within(karimRow).getByText('réglé')).toBeInTheDocument();
  const inesRow = screen.getByText('Ines Andre').closest('div') as HTMLElement;
  expect(within(inesRow).queryByText('réglé')).toBeNull();
  expect(screen.getAllByText('réglé')).toHaveLength(1); // un seul joueur réglé
});

it('affiche le moyen de règlement sur une ligne réglée (✓ réglé + CB)', () => {
  const reservation = baseResa({ totalPrice: '26.00', dueAmount: '26.00', paidAmount: '13.00',
    participants: [part('p1', 'Karim', 'Benali', { isOrganizer: true, share: '13.00', paid: '13.00', outstanding: '0.00' })],
    payments: [{ id: 'pay-1', amount: '13.00', method: 'CARD', participantId: 'p1', refundedAmount: '0.00', payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-06-22T16:05:00.000Z' }] });
  renderCollect({ reservation, due: 2600, players: 2 });
  const karimRow = screen.getByText('Karim Benali').closest('div') as HTMLElement;
  expect(within(karimRow).getByText('réglé')).toBeInTheDocument();
  expect(within(karimRow).getByText('CB')).toBeInTheDocument();   // réglé par CB
});

it('« annuler » sur une ligne réglée rembourse le paiement de cette ligne', async () => {
  const reservation = baseResa({ totalPrice: '50.00', dueAmount: '50.00', paidAmount: '12.50',
    participants: [part('p4', 'Karim', 'Benali', { share: '12.50', paid: '12.50', outstanding: '0.00' })],
    payments: [{ id: 'pay-1', amount: '12.50', method: 'CARD', participantId: 'p4', refundedAmount: '0.00', payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-06-22T16:05:00.000Z' }] });
  renderCollect({ reservation, due: 5000, players: 4 });
  fireEvent.click(screen.getByRole('button', { name: 'annuler' })); // ligne de Karim (réglé)
  await waitFor(() => expect(api.refundPayment).toHaveBeenCalledWith(
    'club-1', 'pay-1', expect.objectContaining({ amount: 12.5 }), 'tok',
  ));
});

it('« Tout solder » encaisse le reste total sans participantId', async () => {
  const reservation = baseResa({ totalPrice: '26.00', dueAmount: '26.00', participants: [
    part('pt-1', 'Jean', 'Test', { isOrganizer: true }), part('pt-2', 'Léa', 'Roy'),
  ] });
  renderCollect({ reservation, due: 2600 });
  const cbButtons = screen.getAllByRole('button', { name: 'CB' });
  fireEvent.click(cbButtons[cbButtons.length - 1]); // dernier = « Tout solder »
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalled());
  const lastCall = (api.adminAddPayment as jest.Mock).mock.calls.at(-1);
  expect(lastCall[2]).toMatchObject({ amount: 26, method: 'CARD' });
  expect(lastCall[2].participantId).toBeUndefined();
});

it('affiche un joueur générique par défaut sur les places non renseignées', () => {
  renderCollect(); // titulaire seul (double) → places 2, 3, 4 génériques
  expect(screen.getByText('Joueur 2')).toBeInTheDocument();
  expect(screen.getByText('Joueur 3')).toBeInTheDocument();
  expect(screen.getByText('Joueur 4')).toBeInTheDocument();
  // chaque place générique reste associable à un vrai membre
  expect(screen.getAllByRole('button', { name: /Associer un membre/ })).toHaveLength(3);
});

it('encaisse une place non renseignée (part, sans participantId)', async () => {
  const reservation = baseResa({ user: null, participants: [] }); // 4 places vides, due 52 / 4 = 13
  renderCollect({ reservation, due: 5200, players: 4 });
  fireEvent.click(screen.getAllByRole('button', { name: 'CB' })[0]); // 1re place vide
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalled());
  const call = (api.adminAddPayment as jest.Mock).mock.calls[0];
  expect(call[2]).toMatchObject({ amount: 13, method: 'CARD' });
  expect(call[2].participantId).toBeUndefined();
});

it('marque UNE place générique « réglé » par part anonyme encaissée (pas besoin de tout payer)', () => {
  // due 52, players 4 → part = 13 ; 13 déjà encaissés (anonyme) → 1 place réglée, 3 encore payables.
  const reservation = baseResa({ user: null, participants: [], paidAmount: '13.00' });
  renderCollect({ reservation, due: 5200, players: 4 });
  expect(screen.getAllByText('réglé')).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'CB' }).length).toBeGreaterThanOrEqual(3); // places restantes
});

it('place vide → associe un participant (membres/holder présents)', async () => {
  const reservation = baseResa({ participants: [part('pt-1', 'Jean', 'Test', { isOrganizer: true, share: '52.00', outstanding: '52.00' })] });
  const members = [{ userId: 'u9', firstName: 'New', lastName: 'Player', email: 'n@x.fr' }] as any;
  renderCollect({ reservation, members });
  fireEvent.click(screen.getAllByRole('button', { name: /Associer un membre/ })[0]);
  fireEvent.focus(screen.getByPlaceholderText(/Rechercher un membre/));
  fireEvent.click(screen.getByText(/New Player/));
  await waitFor(() => expect(api.adminAddReservationParticipant).toHaveBeenCalledWith('club-1', 'r1', 'u9', 'tok'));
});

it('place vide → définit le titulaire si aucun joueur (assign)', async () => {
  const reservation = baseResa({ user: null, participants: [] });
  const members = [{ userId: 'u9', firstName: 'New', lastName: 'Player', email: 'n@x.fr' }] as any;
  renderCollect({ reservation, members });
  fireEvent.click(screen.getAllByRole('button', { name: /Associer un membre/ })[0]);
  fireEvent.focus(screen.getByPlaceholderText(/Rechercher un membre/));
  fireEvent.click(screen.getByText(/New Player/));
  await waitFor(() => expect(api.adminAssignReservationMember).toHaveBeenCalledWith('club-1', 'r1', 'u9', 'tok'));
  expect(api.adminAddReservationParticipant).not.toHaveBeenCalled();
});

it('réservation non-COURT → pas de places, mais encaissement disponible', () => {
  const reservation = baseResa({ type: 'COACHING' });
  renderCollect({ reservation, due: 5200 });
  expect(screen.queryByRole('button', { name: /Associer un membre/ })).toBeNull();
  expect(screen.getByText(/Détails/)).toBeInTheDocument();
});

it('n\'affiche que les moyens configurés (quickMethods)', () => {
  renderCollect({ quickMethods: ['CASH'] });
  expect(screen.getAllByRole('button', { name: 'Espèces' }).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'CB' })).toBeNull();
});

it('« Annuler » déclenche onCancel quand fourni', () => {
  const onCancel = jest.fn();
  renderCollect({ onCancel });
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(onCancel).toHaveBeenCalled();
});

it('soldé → ligne « réglé », pas de boutons de moyen', () => {
  const reservation = baseResa({ paidAmount: '52.00', participants: [part('pt-1', 'Jean', 'Test', { paid: '52.00', share: '52.00', outstanding: '0.00' })] });
  renderCollect({ reservation, due: 5200 });
  expect(screen.queryByRole('button', { name: 'CB' })).toBeNull();
  expect(screen.getAllByText('réglé').length).toBeGreaterThan(0);
});
