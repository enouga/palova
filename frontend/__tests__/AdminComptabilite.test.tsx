import { render, screen, waitFor } from '@testing-library/react';
import AdminComptabilitePage from '../app/admin/comptabilite/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { AdminRoleContext } from '../lib/adminRole';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1' } }) }));
jest.mock('../lib/api', () => ({
  api: { adminAccountingSummary: jest.fn(), adminAccountingExport: jest.fn() },
}));
import { api } from '../lib/api';

const mount = (role: 'ADMIN' | 'STAFF' = 'ADMIN') =>
  render(<AdminRoleContext.Provider value={role}><ThemeProvider><AdminComptabilitePage /></ThemeProvider></AdminRoleContext.Provider>);

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminAccountingSummary as jest.Mock).mockResolvedValue({
    year: 2026, month: 7, totalsByMethod: {}, collected: '0.00', refunded: '0.00', byDay: [],
  });
});

it('viewer STAFF : page réservée aux administrateurs, aucun fetch', async () => {
  mount('STAFF');
  expect(screen.getByText(/réservée aux administrateurs/i)).toBeInTheDocument();
  expect(api.adminAccountingSummary).not.toHaveBeenCalled();
});

it('viewer ADMIN : charge le récap mensuel', async () => {
  mount('ADMIN');
  await waitFor(() => expect(api.adminAccountingSummary).toHaveBeenCalled());
});
