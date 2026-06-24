import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CollectPanel } from '../components/admin/CollectPanel';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, ClubReservation } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'p1' }),
    adminGetMemberPackages: jest.fn().mockResolvedValue([]),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    adminAssignReservationMember: jest.fn(),
    adminAddReservationParticipant: jest.fn(),
    adminRemoveReservationParticipant: jest.fn(),
    adminChangeReservationParticipant: jest.fn(),
    refundPayment: jest.fn(),
    adminCreateMember: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

const RV = (over: Partial<ClubReservation> = {}): ClubReservation => ({
  id: 'rv-1', resourceId: 'court-1',
  startTime: '2026-06-22T14:00:00.000Z', endTime: '2026-06-22T15:00:00.000Z',
  status: 'CONFIRMED', type: 'COURT', title: null,
  totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00',
  resource: { id: 'court-1', name: 'Court 1' },
  user: null, payments: [], participants: [], ...over,
});

function renderPanel(over: Partial<ClubReservation> = {}, props: Record<string, unknown> = {}) {
  const onChanged = jest.fn(); const onPaid = jest.fn(); const onError = jest.fn();
  render(
    <ThemeProvider>
      <CollectPanel reservation={RV(over)} due={5200} players={4} members={[]}
        clubId="club-1" token="tok" onChanged={onChanged} onPaid={onPaid} onError={onError} {...props} />
    </ThemeProvider>,
  );
  return { onChanged, onPaid, onError };
}

describe('CollectPanel', () => {
  it('préremplit le montant avec le reste dû et encaisse en 1 clic (Carte)', async () => {
    const { onChanged, onPaid } = renderPanel();
    expect((screen.getByLabelText(/Encaisser/i) as HTMLInputElement).value).toBe('52');
    fireEvent.click(screen.getByRole('button', { name: 'Carte' }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ amount: 52, method: 'CARD' }), 'tok',
    ));
    expect(onChanged).toHaveBeenCalled();
    expect(onPaid).toHaveBeenCalled();
  });

  it('met en avant les moyens rapides du club (comme la page) tout en gardant tous les moyens', () => {
    renderPanel({}, { quickMethods: ['TRANSFER', 'MEMBER'] });
    const labels = ['Carte', 'Espèces', 'Virement', 'Ticket CE', 'Abo / Membre', 'Autre'];
    // tous les moyens manuels restent disponibles
    labels.forEach((l) => expect(screen.getByRole('button', { name: l })).toBeInTheDocument());
    // les moyens rapides configurés par le club passent en tête (Virement avant Carte)
    const order = screen.getAllByRole('button').map((b) => b.textContent?.trim()).filter((t): t is string => !!t && labels.includes(t));
    expect(order[0]).toBe('Virement');
    expect(order.indexOf('Virement')).toBeLessThan(order.indexOf('Carte'));
  });

  it('désactive les moyens au-delà du plafond', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/Encaisser/i), { target: { value: '80' } });
    expect(screen.getByRole('button', { name: 'Espèces' })).toBeDisabled();
  });

  it('« Régler » un joueur cible son participantId dans l\'encaissement', async () => {
    const part = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '0.00', outstanding: '13.00' };
    renderPanel({ participants: [part] });
    fireEvent.click(screen.getByRole('button', { name: 'Régler' }));
    expect((screen.getByLabelText(/Encaisser/i) as HTMLInputElement).value).toBe('13');
    fireEvent.click(screen.getByRole('button', { name: 'Espèces' }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ amount: 13, method: 'CASH', participantId: 'pt-1' }), 'tok',
    ));
  });

  it('paiement par carnet → adminAddPayment en PACK_CREDIT avec sourcePackageId', async () => {
    (api.adminGetMemberPackages as jest.Mock).mockResolvedValueOnce([
      { id: 'pk-1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 5, amountTotal: null, amountRemaining: null, purchasedAt: '', expiresAt: null, template: { name: 'Carnet 10' } },
    ]);
    renderPanel({ user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' } });
    const btn = await screen.findByRole('button', { name: /Carnet/ });
    fireEvent.click(btn);
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ method: 'PACK_CREDIT', sourcePackageId: 'pk-1', amount: 52 }), 'tok',
    ));
  });

  it('« Changer » remplace un joueur via le sélecteur (adminChangeReservationParticipant)', async () => {
    (api.adminChangeReservationParticipant as jest.Mock).mockResolvedValue({ id: 'rv-1' });
    const orga = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Adam', lastName: 'Bernard', share: '13.00', paid: '0.00', outstanding: '13.00' };
    const ines = { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Ines', lastName: 'Andre', share: '13.00', paid: '0.00', outstanding: '13.00' };
    const members = [{ userId: 'u9', firstName: 'Marie', lastName: 'Curie', email: 'marie@x.fr' }];
    renderPanel({ participants: [orga, ines] }, { members });
    // seule la ligne non-organisateur (Ines) propose « Changer »
    fireEvent.click(screen.getByRole('button', { name: 'Changer' }));
    const input = screen.getByPlaceholderText('Rechercher un membre…');
    fireEvent.focus(input);
    fireEvent.click(screen.getByText(/Marie Curie/));
    await waitFor(() => expect(api.adminChangeReservationParticipant).toHaveBeenCalledWith('club-1', 'rv-1', 'pt-2', 'u9', 'tok'));
  });

  it('affiche le moyen de règlement à côté de « réglé »', () => {
    const part = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '13.00', outstanding: '0.00' };
    const payment = { id: 'pay-1', amount: '13.00', method: 'CARD' as const, participantId: 'pt-1', payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-06-22T13:46:00.000Z', refundedAmount: '0.00', receiptNo: null };
    // due = paid → réservation soldée : le bloc d'encaissement est masqué, « Carte » ne vient donc QUE du badge.
    renderPanel({ participants: [part], payments: [payment], paidAmount: '13.00' }, { due: 1300 });
    expect(screen.getByText(/réglé/)).toBeInTheDocument();
    expect(screen.getByText(/Carte/)).toBeInTheDocument();
  });

  it('le montant se recalcule quand le payé change (panneau resté ouvert)', () => {
    const onChanged = jest.fn();
    const { rerender } = render(
      <ThemeProvider><CollectPanel reservation={RV()} due={5200} players={4} members={[]} clubId="club-1" token="tok" onChanged={onChanged} /></ThemeProvider>,
    );
    expect((screen.getByLabelText(/Encaisser/i) as HTMLInputElement).value).toBe('52');
    rerender(
      <ThemeProvider><CollectPanel reservation={RV({ paidAmount: '20.00' })} due={5200} players={4} members={[]} clubId="club-1" token="tok" onChanged={onChanged} /></ThemeProvider>,
    );
    expect((screen.getByLabelText(/Encaisser/i) as HTMLInputElement).value).toBe('32');
  });
});
