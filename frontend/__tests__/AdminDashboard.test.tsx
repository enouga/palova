import { render, screen, act } from '@testing-library/react';
import AdminDashboard from '../app/admin/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { AdminRoleContext, type ClubStaffRole } from '../lib/adminRole';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo' }, loading: false }),
}));
jest.mock('../lib/api', () => ({
  api: {
    adminGetReservations: jest.fn(),
    adminGetOnboardingStatus: jest.fn(),
    adminGetBilling: jest.fn(),
  },
  assetUrl: (p: string | null) => p,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const mount = async (role: ClubStaffRole) => {
  render(
    <ThemeProvider>
      <AdminRoleContext.Provider value={role}>
        <AdminDashboard />
      </AdminRoleContext.Provider>
    </ThemeProvider>,
  );
  await act(async () => {});
};

describe('AdminDashboard — gating par rôle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    api.adminGetReservations.mockResolvedValue({ reservations: [], summary: { paidTotal: 0, total: 0 } });
    // Jamais résolu : on teste le MONTAGE (l'appel part ou pas), pas le rendu interne
    // (couvert par StartChecklist.test) — et la forme d'OnboardingStatus n'importe pas ici.
    api.adminGetOnboardingStatus.mockReturnValue(new Promise(() => {}));
    api.adminGetBilling.mockResolvedValue({ state: 'TO_REGULARIZE', activeMembers: 60, monthlyPriceCents: 2900 });
  });

  it('STAFF : ni guide ni bannière — aucun appel onboarding-status/billing', async () => {
    await mount('STAFF');
    expect(screen.getByText('Tableau de bord')).toBeInTheDocument();
    expect(api.adminGetOnboardingStatus).not.toHaveBeenCalled();
    expect(api.adminGetBilling).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); // pas de bannière
  });

  it('ADMIN : guide + bannière montés (appels effectués, bannière rendue)', async () => {
    await mount('ADMIN');
    expect(api.adminGetOnboardingStatus).toHaveBeenCalled();
    expect(api.adminGetBilling).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toBeInTheDocument(); // bannière TO_REGULARIZE
  });
});
