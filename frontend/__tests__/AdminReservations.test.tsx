import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminReservationsPage from '../app/admin/reservations/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetClub: jest.fn().mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris', offPeakHours: null }),
    adminGetResources: jest.fn().mockResolvedValue([{ id: 'court-1', name: 'C1', attributes: {}, isActive: true, price: '52.00', offPeakPrice: null, openHour: 8, closeHour: 22, slotStepMin: null, clubSport: { id: 'cs', slotStepMin: null, durationsMin: [60], sport: { key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } } }]),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    adminGetReservations: jest.fn().mockResolvedValue({ reservations: [
      { id: 'rv-1', resourceId: 'court-1', startTime: '2026-06-22T16:00:00.000Z', endTime: '2026-06-22T17:00:00.000Z', status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00', resource: { id: 'court-1', name: 'C1' }, user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' }, payments: [], participants: [] },
    ], summary: { total: '52', paid: '0', paidTotal: '0', outstanding: '52' } }),
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'p1' }),
    adminGetMemberPackages: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));

const renderPage = () => render(<ThemeProvider><AdminReservationsPage /></ThemeProvider>);

it('filtre « À encaisser » garde les impayés et « Solder » encaisse le reste', async () => {
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getByRole('button', { name: 'À encaisser' }));
  expect(screen.getByText('C1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Solder' }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1', expect.objectContaining({ amount: 52 }), 'tok'));
});

it('recherche par nom masque les non-correspondants', async () => {
  renderPage();
  await screen.findByText('C1');
  fireEvent.change(screen.getByPlaceholderText(/Rechercher/i), { target: { value: 'zzz' } });
  expect(screen.queryByText('C1')).not.toBeInTheDocument();
});
