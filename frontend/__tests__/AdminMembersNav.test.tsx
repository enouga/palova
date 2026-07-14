import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import AdminMembersPage from '../app/admin/members/page';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ club: { id: 'club-1', levelSystemEnabled: true, clubSports: [] } }),
}));
jest.mock('../lib/useIsDesktop', () => ({ useIsDesktop: () => true }));

const MEMBERS = [
  { id: 'm1', userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr', phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, staffRole: null, watch: false },
  { id: 'm2', userId: 'u2', firstName: 'Sarah', lastName: 'Petit', email: 's@p.fr', phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, staffRole: null, watch: false },
];

const HISTORY = {
  member: { userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr', phone: null, avatarUrl: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', watch: false, hasActivePackage: false, since: '2024-01-01T00:00:00Z' },
  reservations: [], counts: { total: 0, confirmed: 0, cancelled: 0, lateCancelled: 0, noShow: 0, upcoming: 0 },
  heatmap: Array.from({ length: 7 }, () => new Array(24).fill(0)),
  favorites: { resource: null, sportKey: null, weekday: null },
  finance: { totalSpent: '0.00', averageBasket: '0.00', outstanding: '0.00', unpaid: [], paymentsByMethod: {}, revenueByMonth: [], prepaid: { balances: [], consumption: [] } },
  game: { sportKey: 'padel', level: null, tier: null, isProvisional: false, matchesPlayed: 0, levelPoints: [], wins: 0, losses: 0, frequentPartners: [] },
  loyalty: { firstVisitAt: null, lastVisitAt: null, daysSinceLastVisit: null, tenureDays: 0, playsPerMonth: 0, cancellationRate: 0, atRisk: false },
};

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    adminGetMembers: jest.fn(),
    adminGetClub: jest.fn().mockResolvedValue({ id: 'club-1', quickPaymentMethods: [], payAtClubOnly: false }),
    getMyClubs: jest.fn().mockResolvedValue([{ clubId: 'club-1', role: 'OWNER' }]),
    getMyProfile: jest.fn().mockResolvedValue({ id: 'viewer-1' }),
    adminGetMemberHistory: jest.fn(),
    adminGetMemberNotes: jest.fn().mockResolvedValue([]),
    adminGetMemberLevel: jest.fn().mockResolvedValue(null),
    adminGetSubscriptionPlans: jest.fn().mockResolvedValue([]),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('../lib/api');

const mount = () => render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/admin/members');
  api.adminGetMembers.mockResolvedValue(JSON.parse(JSON.stringify(MEMBERS)));
  api.adminGetClub.mockResolvedValue({ id: 'club-1', quickPaymentMethods: [], payAtClubOnly: false });
  api.adminGetMemberHistory.mockResolvedValue(JSON.parse(JSON.stringify(HISTORY)));
});

describe('AdminMembers — maître-détail', () => {
  it('sans sélection : tableau de bord du fichier dans le panneau droit', async () => {
    mount();
    await screen.findByText('Jean Dupont');
    expect(screen.getByText(/Sélectionnez un membre/)).toBeInTheDocument();
  });

  it('clic sur une ligne → fiche cockpit à droite + ?m= dans l\'URL', async () => {
    mount();
    fireEvent.click(await screen.findByText('Jean Dupont'));
    await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalledWith('club-1', 'u1', 'tok'));
    expect(window.location.search).toContain('m=u1');
  });

  it('deep-link ?m=u2 au montage → fiche de Sarah ouverte', async () => {
    window.history.replaceState(null, '', '/admin/members?m=u2');
    api.adminGetMemberHistory.mockResolvedValue({ ...JSON.parse(JSON.stringify(HISTORY)), member: { ...HISTORY.member, userId: 'u2', firstName: 'Sarah', lastName: 'Petit' } });
    mount();
    await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalledWith('club-1', 'u2', 'tok'));
  });

  it('Échap désélectionne (retour au tableau de bord)', async () => {
    mount();
    fireEvent.click(await screen.findByText('Jean Dupont'));
    await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalled());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText(/Sélectionnez un membre/)).toBeInTheDocument();
    expect(window.location.search).not.toContain('m=');
  });

  it('↓ sélectionne le membre suivant de la liste visible', async () => {
    mount();
    fireEvent.click(await screen.findByText('Jean Dupont'));
    await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalledWith('club-1', 'u1', 'tok'));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalledWith('club-1', 'u2', 'tok'));
  });
});
