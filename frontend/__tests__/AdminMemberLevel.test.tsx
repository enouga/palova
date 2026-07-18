import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminMemberLevelPage from '../app/admin/members/[userId]/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { AdminRoleContext } from '../lib/adminRole';
import type { MemberHistory } from '../lib/api';

// Fiche membre fusionnée (lots C+D) : la partie « niveau » (override admin) vit dans
// l'onglet « Niveau ». Le squelette (WIP) charge l'historique + les notes en parallèle,
// d'où les mocks adminGetMemberHistory/adminGetMemberNotes ci-dessous.
const adminGetMemberHistory = jest.fn();
const adminGetMemberNotes = jest.fn();
const adminSetMemberWatch = jest.fn();
const adminGetMemberLevel = jest.fn();
const adminSetMemberLevel = jest.fn();
jest.mock('../lib/api', () => ({
  __esModule: true,
  assetUrl: (u: string | null) => u,
  api: {
    adminGetMemberHistory: (...a: unknown[]) => adminGetMemberHistory(...a),
    adminGetMemberNotes: (...a: unknown[]) => adminGetMemberNotes(...a),
    adminSetMemberWatch: (...a: unknown[]) => adminSetMemberWatch(...a),
    adminGetMemberLevel: (...a: unknown[]) => adminGetMemberLevel(...a),
    adminSetMemberLevel: (...a: unknown[]) => adminSetMemberLevel(...a),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));

let mockClub: Record<string, unknown> | null = {
  id: 'c1', name: 'Demo', slug: 'demo', levelSystemEnabled: true,
  clubSports: [{ sport: { key: 'padel', name: 'Padel' } }],
};
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: mockClub }) }));
jest.mock('../lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => mockClub?.levelSystemEnabled !== false }));

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ userId: 'u1' }),
  useRouter: () => ({ push, replace: push }),
}));

// Historique minimal pour passer l'écran de chargement de la fiche fusionnée.
const HISTORY: MemberHistory = {
  member: { userId: 'u1', firstName: 'Alice', lastName: 'Martin', email: 'alice@ex.fr', phone: null, avatarUrl: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', watch: false, hasActivePackage: false, since: '2026-01-01T00:00:00.000Z' },
  reservations: [],
  counts: { total: 0, confirmed: 0, cancelled: 0, lateCancelled: 0, noShow: 0, upcoming: 0, noShowCharged: 0 },
  noShowChargedLastAt: null,
  heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
  favorites: { resource: null, sportKey: null, weekday: null },
  finance: {
    totalSpent: '0.00', averageBasket: '0.00', outstanding: '0.00',
    paymentsByMethod: {}, revenueByMonth: [], prepaid: { balances: [], consumption: [] },
  },
  game: {
    sportKey: 'padel', level: null, tier: null, isProvisional: true, matchesPlayed: 0,
    levelPoints: [], wins: 0, losses: 0, frequentPartners: [],
  },
  loyalty: { firstVisitAt: null, lastVisitAt: null, daysSinceLastVisit: null, tenureDays: 0, playsPerMonth: 0, cancellationRate: 0, atRisk: false },
};

// Les blocs override de niveau sont réservés ADMIN (isClubAdmin(useAdminRole())) — sans
// provider, le contexte par défaut est null (non-admin) et les masquerait tous.
function renderPage() {
  return render(<AdminRoleContext.Provider value="ADMIN"><ThemeProvider><AdminMemberLevelPage /></ThemeProvider></AdminRoleContext.Provider>);
}

// Va sur l'onglet « Niveau » (où vivent niveau courant, override et corrections).
function goToNiveau() {
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClub = {
    id: 'c1', name: 'Demo', slug: 'demo', levelSystemEnabled: true,
    clubSports: [{ sport: { key: 'padel', name: 'Padel' } }],
  };
  adminGetMemberHistory.mockResolvedValue(HISTORY);
  adminGetMemberNotes.mockResolvedValue([]);
  adminSetMemberWatch.mockResolvedValue({ userId: 'u1', watch: true });
  adminGetMemberLevel.mockResolvedValue({
    levels: { padel: { level: 4.2, tier: 'Confirmé', isProvisional: false, reliability: 88 } },
    history: [
      { id: 'h1', previousLevel: 3.5, newLevel: 4.2, reason: 'Recalage manuel', createdAt: '2026-06-10T10:00:00Z', staffFirstName: 'Bob', staffLastName: 'Staff', sportKey: 'padel', sportName: 'Padel' },
    ],
  });
  adminSetMemberLevel.mockResolvedValue({ calibrated: true, level: 5, tier: 'Confirmé', isProvisional: false, reliability: 95, matchesPlayed: 0 });
});

it('charge la fiche et affiche le nom, le niveau courant et l historique (onglet Niveau)', async () => {
  renderPage();
  expect(await screen.findByText('Alice Martin')).toBeInTheDocument();
  goToNiveau();
  // niveau courant 4.2 (span dédié de la section Niveau) + son palier
  expect(await screen.findByText('4.2')).toBeInTheDocument();
  expect(screen.getByText('Confirmé')).toBeInTheDocument();
  // historique : ancien → nouveau + motif + staff
  expect(screen.getByText('3.5 → 4.2')).toBeInTheDocument();
  expect(screen.getByText(/Recalage manuel/)).toBeInTheDocument();
  expect(screen.getByText(/Bob Staff/)).toBeInTheDocument();
  expect(adminGetMemberLevel).toHaveBeenCalledWith('c1', 'u1', 'tok');
});

it('soumettre le formulaire appelle adminSetMemberLevel et recharge la fiche', async () => {
  renderPage();
  await screen.findByText('Alice Martin');
  goToNiveau();
  await screen.findByText('4.2');
  // adminGetMemberLevel appelé une fois au chargement
  expect(adminGetMemberLevel).toHaveBeenCalledTimes(1);

  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText(/Motif/i), { target: { value: 'décision comité' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));

  await waitFor(() => expect(adminSetMemberLevel).toHaveBeenCalledWith(
    'c1', 'u1', { sportKey: 'padel', level: 5, reason: 'décision comité' }, 'tok',
  ));
  // rechargement de la fiche après succès
  await waitFor(() => expect(adminGetMemberLevel).toHaveBeenCalledTimes(2));
});

it('système de niveau désactivé : l onglet Niveau masque la correction et ne charge pas le niveau', async () => {
  mockClub = { id: 'c1', name: 'Demo', slug: 'demo', levelSystemEnabled: false, clubSports: [] };
  renderPage();
  expect(await screen.findByText('Alice Martin')).toBeInTheDocument();
  goToNiveau();
  // la partie correction (override) est masquée
  expect(screen.queryByText('Corriger le niveau')).not.toBeInTheDocument();
  // et le niveau n'est jamais chargé
  expect(adminGetMemberLevel).not.toHaveBeenCalled();
});

it('mappe une erreur 403 (FORBIDDEN) en message français', async () => {
  adminSetMemberLevel.mockRejectedValue(new Error('FORBIDDEN'));
  renderPage();
  await screen.findByText('Alice Martin');
  goToNiveau();
  await screen.findByText('4.2');
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Réservé aux administrateurs du club.')).toBeInTheDocument();
});

it('affiche une confirmation de succès après une correction réussie', async () => {
  renderPage();
  await screen.findByText('Alice Martin');
  goToNiveau();
  await screen.findByText('4.2');
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Niveau corrigé.')).toBeInTheDocument();
  // la confirmation disparaît dès la prochaine édition
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '6' } });
  expect(screen.queryByText('Niveau corrigé.')).not.toBeInTheDocument();
});

it('arrondit le niveau au dixième avant l envoi', async () => {
  renderPage();
  await screen.findByText('Alice Martin');
  goToNiveau();
  await screen.findByText('4.2');
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '4.25' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  await waitFor(() => expect(adminSetMemberLevel).toHaveBeenCalledWith(
    'c1', 'u1', { sportKey: 'padel', level: 4.3, reason: undefined }, 'tok',
  ));
});

it('niveaux vides : affiche le message « aucun niveau » mais rend quand même le formulaire', async () => {
  adminGetMemberLevel.mockResolvedValue({
    levels: {},
    history: [
      { id: 'h1', previousLevel: null, newLevel: 4, reason: null, createdAt: '2026-06-10T10:00:00Z', staffFirstName: 'Bob', staffLastName: 'Staff', sportKey: 'padel', sportName: 'Padel' },
    ],
  });
  renderPage();
  await screen.findByText('Alice Martin');
  goToNiveau();
  expect(await screen.findByText(/Aucun niveau enregistré/i)).toBeInTheDocument();
  // le formulaire rend quand même (via le fallback clubSports/formSports)
  expect(screen.getByLabelText(/Niveau \(0–8\)/i)).toBeInTheDocument();
  // l'historique reste affiché
  expect(screen.getByText('— → 4.0')).toBeInTheDocument();
});

it('membre introuvable côté niveau : l en-tête reste le nom du membre sans planter', async () => {
  // Le niveau échoue mais l'historique (squelette) fournit l'identité → la fiche reste lisible.
  adminGetMemberLevel.mockRejectedValue(new Error('BOOM'));
  renderPage();
  expect(await screen.findByText('Alice Martin')).toBeInTheDocument();
  goToNiveau();
  expect(await screen.findByText(/Aucun niveau enregistré/i)).toBeInTheDocument();
});

it('rejette côté client un niveau invalide (9) sans appeler l API', async () => {
  renderPage();
  await screen.findByText('Alice Martin');
  goToNiveau();
  await screen.findByText('4.2');
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Niveau invalide (doit être entre 0 et 8).')).toBeInTheDocument();
  expect(adminSetMemberLevel).not.toHaveBeenCalled();
});
