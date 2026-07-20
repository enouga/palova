import { render, screen, waitFor } from '@testing-library/react';
import AdminPromotionsPage from '../app/admin/promotions/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetPromotions: jest.fn(),
    adminGetResources: jest.fn(),
    adminCreatePromotion: jest.fn(),
    adminUpdatePromotion: jest.fn(),
    adminDeletePromotion: jest.fn(),
  },
}));
import { api } from '../lib/api';

const promo = {
  id: 'promo-1', name: 'Promo été', startDate: '2026-08-01', endDate: '2026-08-31',
  windowStart: null, windowEnd: null, kind: 'PERCENT', percentOff: 20, fixedPrice: null,
  enabled: true, resourceIds: [], createdAt: '2026-07-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetPromotions as jest.Mock).mockResolvedValue([promo]);
  (api.adminGetResources as jest.Mock).mockResolvedValue([{ id: 'court-1', name: 'Court 1' }]);
});

const mount = () => render(<ThemeProvider><AdminPromotionsPage /></ThemeProvider>);

it('affiche le titre et la promo', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Promotions' })).toBeInTheDocument();
  expect(await screen.findByText('Promo été')).toBeInTheDocument();
});

it('charge les promotions et les terrains au montage', async () => {
  mount();
  await waitFor(() => expect(api.adminGetPromotions).toHaveBeenCalledWith('club-1', 'tok'));
  expect(api.adminGetResources).toHaveBeenCalledWith('club-1', 'tok');
});
