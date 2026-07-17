import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminResourcesPage from '@/app/admin/courts/page';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { AdminRoleContext } from '@/lib/adminRole';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-demo', accentColor: '#d6ff3f' } }) }));

const RES = {
  id: 'r1', name: 'Terrain 1',
  attributes: { coverage: 'indoor', format: 'double' },
  isActive: true, price: '25', offPeakPrice: null, openHour: 8, closeHour: 22, slotStepMin: null,
  clubSport: { id: 'cs1', slotStepMin: null, durationsMin: [60], sport: { key: 'padel', name: 'Padel', resourceNoun: 'terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } },
};
const SPORTS = [{ id: 'cs1', slotStepMin: null, durationsMin: [60], sport: { id: 'sp1', key: 'padel', name: 'Padel', resourceNoun: 'terrain', defaultDurationsMin: [60], surfaces: [], hasLighting: false } }];

jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    adminGetResources: jest.fn(),
    adminGetSports: jest.fn(),
    adminDeleteResource: jest.fn(),
    adminUpdateResource: jest.fn(),
    adminSetResourceActive: jest.fn(),
    adminReorderResources: jest.fn(),
    adminCreateResource: jest.fn(),
  },
}));

function renderPage(role: 'OWNER' | 'ADMIN' | 'STAFF' | null = 'ADMIN') {
  return render(
    <AdminRoleContext.Provider value={role}>
      <ThemeProvider>
        <AdminResourcesPage />
      </ThemeProvider>
    </AdminRoleContext.Provider>,
  );
}

describe('AdminResourcesPage — suppression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { api } = require('@/lib/api');
    api.adminGetResources.mockResolvedValue([{ ...RES, attributes: { ...RES.attributes } }]);
    api.adminGetSports.mockResolvedValue(SPORTS);
    api.adminDeleteResource.mockResolvedValue({ ok: true });
  });

  it('viewer STAFF : page réservée aux administrateurs, aucun fetch ressources', async () => {
    const { api } = require('@/lib/api');
    renderPage('STAFF');
    expect(screen.getByText(/réservée aux administrateurs/i)).toBeInTheDocument();
    expect(api.adminGetResources).not.toHaveBeenCalled();
  });

  it('supprime une ressource après confirmation', async () => {
    const { api } = require('@/lib/api');
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Terrain 1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Terrain 1' }));
    // La boîte de confirmation s'ouvre.
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));

    await waitFor(() => expect(api.adminDeleteResource).toHaveBeenCalledWith('club-demo', 'r1', 't'));
  });

  it('affiche un message dédié si la ressource a des réservations', async () => {
    const { api } = require('@/lib/api');
    api.adminDeleteResource.mockRejectedValue(new Error('RESOURCE_HAS_RESERVATIONS'));
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Terrain 1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Terrain 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));

    await waitFor(() => expect(screen.getByText(/désactivez-la/i)).toBeInTheDocument());
    // La ressource reste affichée (suppression refusée).
    expect(screen.getByDisplayValue('Terrain 1')).toBeInTheDocument();
  });
});
