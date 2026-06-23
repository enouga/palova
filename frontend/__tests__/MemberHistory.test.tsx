import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MemberHistoryPage from '../app/admin/members/[userId]/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';
import type { MemberHistory } from '../lib/api';

jest.mock('next/navigation', () => ({
  useParams: () => ({ userId: 'u1' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetMemberHistory: jest.fn(),
    adminGetMemberNotes: jest.fn(),
    adminAddMemberNote: jest.fn(),
    adminDeleteMemberNote: jest.fn(),
    adminSetMemberWatch: jest.fn(),
    // Onglet Niveau fusionné (lots C+D) : la fiche charge aussi le niveau (override admin).
    adminGetMemberLevel: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

const HISTORY: MemberHistory = {
  member: { userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr', phone: null, avatarUrl: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', watch: false, hasActivePackage: true, since: '2026-01-01T00:00:00.000Z' },
  reservations: [
    { id: 'r1', status: 'CONFIRMED', type: 'COURT', startTime: '2026-06-15T18:00:00.000Z', endTime: '2026-06-15T19:00:00.000Z', cancelledAt: null, lateCancel: false, resourceName: 'Court 1', sportKey: 'padel', isOrganizer: true, attributedAmount: '36.00' },
    { id: 'r2', status: 'CANCELLED', type: 'COURT', startTime: '2026-06-10T18:00:00.000Z', endTime: '2026-06-10T19:00:00.000Z', cancelledAt: '2026-06-10T12:00:00.000Z', lateCancel: true, resourceName: 'Court 1', sportKey: 'padel', isOrganizer: true, attributedAmount: '0.00' },
  ],
  counts: { total: 2, confirmed: 1, cancelled: 1, lateCancelled: 1, noShow: 0, upcoming: 0 },
  heatmap: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 0 && h === 20 ? 1 : 0))),
  favorites: { resource: { name: 'Court 1', count: 1 }, sportKey: 'padel', weekday: 1 },
  finance: {
    totalSpent: '36.00', averageBasket: '36.00', outstanding: '0.00',
    paymentsByMethod: { CASH: '30.00', CARD: '6.00' },
    revenueByMonth: [{ month: '2026-06', net: '36.00' }],
    prepaid: { balances: [], consumption: [] },
  },
  game: {
    sportKey: 'padel', level: 5.2, tier: 'Intermédiaire', isProvisional: false, matchesPlayed: 4,
    levelPoints: [{ playedAt: '2026-05-01T10:00:00.000Z', level: 1500 }, { playedAt: '2026-06-01T10:00:00.000Z', level: 1540 }],
    wins: 3, losses: 1, frequentPartners: [{ userId: 'bob', firstName: 'Bob', lastName: 'B', count: 3 }],
  },
  loyalty: { firstVisitAt: '2026-05-01T10:00:00.000Z', lastVisitAt: '2026-06-15T18:00:00.000Z', daysSinceLastVisit: 60, tenureDays: 170, playsPerMonth: 2, cancellationRate: 0.5, atRisk: true },
};

const renderPage = () => render(<ThemeProvider><MemberHistoryPage /></ThemeProvider>);

beforeEach(() => {
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue(HISTORY);
  (api.adminGetMemberNotes as jest.Mock).mockResolvedValue([]);
  (api.adminAddMemberNote as jest.Mock).mockResolvedValue({ id: 'n1', body: 'Joueur sympa', createdAt: '2026-06-23T14:00:00.000Z', author: { firstName: 'Sarah', lastName: 'P' } });
  (api.adminSetMemberWatch as jest.Mock).mockResolvedValue({ userId: 'u1', watch: true });
  (api.adminGetMemberLevel as jest.Mock).mockResolvedValue({ levels: {}, history: [] });
});

it('affiche identité, badge « à risque » et chip « Carnet actif »', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  expect(screen.getByText('⚠ À risque')).toBeInTheDocument();
  expect(screen.getByText('Carnet actif')).toBeInTheDocument();
  expect(screen.getByText('Habitudes de jeu')).toBeInTheDocument();
});

it('onglet Activité : compteur d\'annulations tardives', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  expect(screen.getByText('Annulations tardives')).toBeInTheDocument();
});

it('bascule sur Finances et formate les montants', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Finances' }));
  await screen.findByText('Total dépensé');
  expect(screen.getByText('Espèces')).toBeInTheDocument();
  expect(screen.getByText('30 €')).toBeInTheDocument();
  expect(screen.getByText("Chiffre d'affaires par mois")).toBeInTheDocument();
});

it('onglet Niveau : partenaires fréquents + courbe de progression', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  await screen.findByText('Partenaires fréquents');
  expect(screen.getByText('Bob B')).toBeInTheDocument();
  expect(screen.getByLabelText('Courbe de progression du niveau')).toBeInTheDocument();
});

it('onglet Notes : ajouter un commentaire appelle l\'API et l\'affiche', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: /Notes/ }));
  const ta = await screen.findByPlaceholderText(/Ajouter un commentaire/);
  fireEvent.change(ta, { target: { value: 'Joueur sympa' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  await waitFor(() => expect(api.adminAddMemberNote).toHaveBeenCalledWith('club-1', 'u1', 'Joueur sympa', 'tok'));
  expect(await screen.findByText('Joueur sympa')).toBeInTheDocument();
});

it('toggle « à surveiller » appelle l\'API', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: /Marquer à surveiller/ }));
  await waitFor(() => expect(api.adminSetMemberWatch).toHaveBeenCalledWith('club-1', 'u1', true, 'tok'));
});

it('membre introuvable → message d\'erreur', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockRejectedValueOnce(new Error('MEMBER_NOT_FOUND'));
  renderPage();
  await waitFor(() => expect(screen.getByText('Membre introuvable dans ce club.')).toBeInTheDocument());
});
