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
});
