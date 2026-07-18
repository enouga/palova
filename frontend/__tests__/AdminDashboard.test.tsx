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
    adminGetClub: jest.fn(),
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
    // LegalBanner : infos légales complètes → jamais rendue (évite la collision de rôle
    // "status" avec BillingBanner dans le test ADMIN ci-dessous, hors sujet ici).
    api.adminGetClub.mockResolvedValue({
      stripeAccountStatus: 'ACTIVE', legalEntityName: 'X', siret: '1', legalEmail: 'a@b.fr', mediatorName: 'CM2C',
    });
  });

  it('STAFF : ni guide ni bannière — aucun appel onboarding-status/billing/legal', async () => {
    await mount('STAFF');
    expect(screen.getByText('Tableau de bord')).toBeInTheDocument();
    expect(api.adminGetOnboardingStatus).not.toHaveBeenCalled();
    expect(api.adminGetBilling).not.toHaveBeenCalled();
    expect(api.adminGetClub).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); // pas de bannière
  });

  it('ADMIN : guide + bannière montés (appels effectués, bannière rendue)', async () => {
    await mount('ADMIN');
    expect(api.adminGetOnboardingStatus).toHaveBeenCalled();
    expect(api.adminGetBilling).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toBeInTheDocument(); // bannière TO_REGULARIZE
  });

  it('montants du jour au format français (virgule, pas de point anglais)', async () => {
    api.adminGetReservations.mockResolvedValue({ reservations: [], summary: { paidTotal: '32.25', total: '32.25' } });
    await mount('STAFF');
    expect(await screen.findAllByText('32,25')).not.toHaveLength(0);
    expect(screen.queryByText('32.25')).not.toBeInTheDocument();
  });
});
