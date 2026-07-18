import { render, screen, waitFor } from '@testing-library/react';
import AdminPagesPage from '../app/admin/pages/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { AdminRoleContext } from '../lib/adminRole';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1' } }) }));
jest.mock('../lib/api', () => ({
  api: { adminGetClub: jest.fn(), adminGetPages: jest.fn(), adminGetFaq: jest.fn() },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const mount = (role: 'ADMIN' | 'STAFF' = 'ADMIN') =>
  render(<AdminRoleContext.Provider value={role}><ThemeProvider><AdminPagesPage /></ThemeProvider></AdminRoleContext.Provider>);

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetClub as jest.Mock).mockResolvedValue({ id: 'c1', name: 'Club' });
  (api.adminGetPages as jest.Mock).mockResolvedValue([]);
  (api.adminGetFaq as jest.Mock).mockResolvedValue([]);
});

it('viewer STAFF : page réservée aux administrateurs, aucun fetch', async () => {
  mount('STAFF');
  expect(screen.getByText(/réservée aux administrateurs/i)).toBeInTheDocument();
  expect(api.adminGetClub).not.toHaveBeenCalled();
});

it('viewer ADMIN : charge le contenu', async () => {
  mount('ADMIN');
  await waitFor(() => expect(api.adminGetPages).toHaveBeenCalled());
});

it('affiche le champ médiateur de la consommation (onglet Coordonnées légales, par défaut)', async () => {
  (api.adminGetClub as jest.Mock).mockResolvedValue({ id: 'c1', name: 'Club', mediatorName: 'CM2C', mediatorUrl: 'https://cm2c.net' });
  mount('ADMIN');
  await waitFor(() => expect(api.adminGetClub).toHaveBeenCalled());
  expect(await screen.findByText('Médiateur de la consommation')).toBeInTheDocument();
  expect(screen.getByDisplayValue('CM2C')).toBeInTheDocument();
  expect(screen.getByDisplayValue('https://cm2c.net')).toBeInTheDocument();
});
