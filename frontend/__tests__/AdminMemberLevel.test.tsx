import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminMemberLevelPage from '../app/admin/members/[userId]/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const adminGetMembers = jest.fn();
const adminGetMemberLevel = jest.fn();
const adminSetMemberLevel = jest.fn();
jest.mock('../lib/api', () => ({
  __esModule: true,
  assetUrl: (u: string | null) => u,
  api: {
    adminGetMembers: (...a: unknown[]) => adminGetMembers(...a),
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

function renderPage() {
  return render(<ThemeProvider><AdminMemberLevelPage /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClub = {
    id: 'c1', name: 'Demo', slug: 'demo', levelSystemEnabled: true,
    clubSports: [{ sport: { key: 'padel', name: 'Padel' } }],
  };
  adminGetMembers.mockResolvedValue([
    { id: 'mem1', userId: 'u1', firstName: 'Alice', lastName: 'Martin', email: 'alice@ex.fr', phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null },
  ]);
  adminGetMemberLevel.mockResolvedValue({
    levels: { padel: { level: 4.2, tier: 'Confirmé', isProvisional: false, reliability: 88 } },
    history: [
      { id: 'h1', previousLevel: 3.5, newLevel: 4.2, reason: 'Recalage manuel', createdAt: '2026-06-10T10:00:00Z', staffFirstName: 'Bob', staffLastName: 'Staff', sportKey: 'padel', sportName: 'Padel' },
    ],
  });
  adminSetMemberLevel.mockResolvedValue({ calibrated: true, level: 5, tier: 'Confirmé', isProvisional: false, reliability: 95, matchesPlayed: 0 });
});

it('charge la fiche et affiche le nom, le niveau courant et l historique', async () => {
  renderPage();
  expect(await screen.findByText('Alice Martin')).toBeInTheDocument();
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

it('affiche un état indisponible quand le système de niveau est désactivé', async () => {
  mockClub = { id: 'c1', name: 'Demo', slug: 'demo', levelSystemEnabled: false, clubSports: [] };
  renderPage();
  expect(await screen.findByText(/indisponible/i)).toBeInTheDocument();
  expect(adminGetMemberLevel).not.toHaveBeenCalled();
});

it('mappe une erreur 403 (FORBIDDEN) en message français', async () => {
  adminSetMemberLevel.mockRejectedValue(new Error('FORBIDDEN'));
  renderPage();
  await screen.findByText('Alice Martin');
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Réservé aux administrateurs du club.')).toBeInTheDocument();
});

it('affiche une confirmation de succès après une correction réussie', async () => {
  renderPage();
  await screen.findByText('Alice Martin');
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
  expect(await screen.findByText(/Aucun niveau enregistré/i)).toBeInTheDocument();
  // le formulaire rend quand même (via le fallback clubSports/formSports)
  expect(screen.getByLabelText(/Niveau \(0–8\)/i)).toBeInTheDocument();
  // l'historique reste affiché
  expect(screen.getByText('— → 4')).toBeInTheDocument();
});

it('membre introuvable : l en-tête retombe sur « Membre » sans planter', async () => {
  adminGetMembers.mockResolvedValue([
    { id: 'mem2', userId: 'u999', firstName: 'Other', lastName: 'Person', email: 'o@ex.fr', phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null },
  ]);
  renderPage();
  // le niveau se charge quand même (par userId), et l'en-tête retombe sur « Membre »
  expect(await screen.findByText('4.2')).toBeInTheDocument();
  expect(screen.getByText('Membre')).toBeInTheDocument();
});

it('rejette côté client un niveau invalide (9) sans appeler l API', async () => {
  renderPage();
  await screen.findByText('Alice Martin');
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Niveau invalide (doit être entre 0 et 8).')).toBeInTheDocument();
  expect(adminSetMemberLevel).not.toHaveBeenCalled();
});
