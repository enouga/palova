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
