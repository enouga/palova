import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { MemberCockpit } from '../components/admin/members/MemberCockpit';

const renderCockpit = (props: Partial<typeof baseProps> = {}) =>
  render(<ThemeProvider><MemberCockpit {...baseProps} {...props} /></ThemeProvider>);

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const HISTORY = {
  member: {
    userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr', phone: '0601020304',
    avatarUrl: null, isSubscriber: true, membershipNo: 'PAR1001', status: 'ACTIVE',
    watch: false, hasActivePackage: true, since: '2022-07-01T00:00:00Z',
  },
  reservations: [
    { id: 'r1', status: 'CONFIRMED', type: 'COURT', startTime: '2026-07-10T18:00:00Z', endTime: '2026-07-10T19:00:00Z', cancelledAt: null, lateCancel: false, resourceName: 'Court 1', sportKey: 'padel', isOrganizer: true, attributedAmount: '12.00' },
  ],
  counts: { total: 1, confirmed: 1, cancelled: 0, lateCancelled: 0, noShow: 0, upcoming: 0 },
  heatmap: Array.from({ length: 7 }, () => new Array(24).fill(0)),
  favorites: { resource: { name: 'Court 1', count: 1 }, sportKey: 'padel', weekday: 4 },
  finance: {
    totalSpent: '120.00', averageBasket: '12.00', outstanding: '8.00',
    unpaid: [{ reservationId: 'r1', participantId: 'p-me', startTime: '2026-07-10T18:00:00Z', resourceName: 'Court 1', dueAmount: '8.00' }],
    paymentsByMethod: { CARD: '120.00' },
    revenueByMonth: [{ month: '2026-07', net: '20.00' }],
    prepaid: { balances: [], consumption: [] },
  },
  game: { sportKey: 'padel', level: 5.5, tier: 'Confirmé', isProvisional: false, matchesPlayed: 20, levelPoints: [], wins: 14, losses: 6, frequentPartners: [] },
  loyalty: { firstVisitAt: '2022-07-01T00:00:00Z', lastVisitAt: '2026-07-10T18:00:00Z', daysSinceLastVisit: 4, tenureDays: 1474, playsPerMonth: 4, cancellationRate: 0.04, atRisk: false },
};

const MEMBER = {
  id: 'mship-1', userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr',
  phone: '0601020304', isSubscriber: true, membershipNo: 'PAR1001', status: 'ACTIVE' as const,
  note: null, staffRole: null, avatarUrl: null, subscription: null, hasActiveSubscription: false,
};

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    adminGetMemberHistory: jest.fn(),
    adminGetMemberNotes: jest.fn().mockResolvedValue([]),
    adminGetMemberLevel: jest.fn().mockResolvedValue(null),
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'pay-1' }),
    adminGetSubscriptionPlans: jest.fn().mockResolvedValue([]),
    adminUpdateMember: jest.fn(),
    adminAddMemberNote: jest.fn(),
    adminDeleteMemberNote: jest.fn(),
    adminSetMemberWatch: jest.fn().mockResolvedValue({ userId: 'u1', watch: true }),
  },
}));
// Club mutable : chaque test peut ajuster levelSystemEnabled sans spy fragile.
// quickMethods/payAtClubOnly ne vivent PAS sur useClub().club (ClubDetail public) — ce sont
// des props fournies par la page (elles viennent de ClubAdminDetail via api.adminGetClub).
let CLUB: Record<string, unknown> = {};
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: CLUB }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('../lib/api');

const baseProps = {
  member: MEMBER as never,
  viewerUserId: 'viewer-1',
  canManageStaff: true,
  quickMethods: ['CARD', 'CASH'] as never,
  payAtClubOnly: false,
  onChanged: jest.fn(),
  onSetRole: jest.fn(),
  onToggleBlocked: jest.fn(),
  onDelete: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  CLUB = {
    id: 'club-1', levelSystemEnabled: true,
    clubSports: [{ sport: { key: 'padel', name: 'Padel' } }],
  };
  api.adminGetMemberHistory.mockResolvedValue(JSON.parse(JSON.stringify(HISTORY)));
  api.adminGetMemberNotes.mockResolvedValue([]);
  api.adminGetMemberLevel.mockResolvedValue(null);
});

// ⚠️ fmtEuros insère des espaces insécables (« 8,00 € ») → toujours matcher par regex
// souple /Encaisser/ + /CB/, jamais par égalité stricte de chaîne avec montant.
describe('MemberCockpit', () => {
  it('charge et affiche header + KPI + cartes', async () => {
    renderCockpit();
    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getByText(/Encaisser/)).toBeInTheDocument();              // action header (dû > 0)
    expect(screen.getByText(/💶 Argent/)).toBeInTheDocument();
    expect(screen.getByText(/Vie au club/)).toBeInTheDocument();
    expect(screen.getByText(/🎾 Jeu/)).toBeInTheDocument();
    expect(screen.getByText(/Notes & infos/)).toBeInTheDocument();
  });

  it('encaisse une ligne impayée : adminAddPayment en euros avec participantId, puis onChanged', async () => {
    renderCockpit();
    await screen.findByText('Jean Dupont');
    fireEvent.click(screen.getByRole('button', { name: /Encaisser .*CB/ }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'r1', { amount: 8, method: 'CARD', participantId: 'p-me' }, 'tok',
    ));
    await waitFor(() => expect(baseProps.onChanged).toHaveBeenCalled());
  });

  it('carte Jeu masquée si le club a désactivé le niveau', async () => {
    CLUB = { ...CLUB, levelSystemEnabled: false };
    renderCockpit();
    await screen.findByText('Jean Dupont');
    expect(screen.queryByText(/🎾 Jeu/)).not.toBeInTheDocument();
  });

  it('loyalty.atRisk : badge « à risque » sur le KPI Fiabilité', async () => {
    api.adminGetMemberHistory.mockResolvedValue({
      ...JSON.parse(JSON.stringify(HISTORY)),
      loyalty: { ...HISTORY.loyalty, atRisk: true },
    });
    renderCockpit();
    await screen.findByText('Jean Dupont');
    expect(screen.getByText(/à risque/)).toBeInTheDocument();
  });

  it('loyalty.atRisk faux : pas de badge « à risque »', async () => {
    renderCockpit();
    await screen.findByText('Jean Dupont');
    expect(screen.queryByText(/à risque/)).not.toBeInTheDocument();
  });

  it('payAtClubOnly : un seul bouton « Encaissé » par ligne, méthode CLUB', async () => {
    renderCockpit({ payAtClubOnly: true });
    await screen.findByText('Jean Dupont');
    const btns = screen.getAllByRole('button', { name: /Encaisser .*Au club/ });
    expect(btns).toHaveLength(1);
    fireEvent.click(btns[0]);
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'r1', { amount: 8, method: 'CLUB', participantId: 'p-me' }, 'tok',
    ));
  });

  it('échec du chargement → message d\'erreur, pas d\'écran blanc', async () => {
    api.adminGetMemberHistory.mockRejectedValue(new Error('MEMBER_NOT_FOUND'));
    renderCockpit();
    expect(await screen.findByText(/Membre introuvable/)).toBeInTheDocument();
  });
});
