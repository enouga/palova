import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MemberHistoryPage from '../app/admin/members/[userId]/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { AdminRoleContext } from '../lib/adminRole';
import { api } from '../lib/api';
import type { MemberHistory } from '../lib/api';

// `push` doit être STABLE à travers tous les rendus (le composant appelle useRouter() à
// chaque render — un `jest.fn()` frais par appel empêcherait toute assertion fiable sur
// la navigation post-suppression). Nom préfixé `mock` : seule échappatoire de
// babel-plugin-jest-hoist pour référencer une variable hors-scope dans la factory.
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ userId: 'u1' }),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));

// Club mutable : la plupart des tests utilisent le club par défaut (niveau actif, 1 sport
// « Padel ») ; le test « système désactivé » le bascule avant renderPage(). Une variable
// (plutôt qu'un objet figé dans le factory) permet cette bascule par test — la fabrique
// jest.mock() est hoisted mais lit `mockClub` à chaque appel de useClub().
let mockClub: Record<string, unknown> | null = {
  id: 'club-1', name: 'Padel Arena Paris', slug: 'padel-arena-paris', levelSystemEnabled: true,
  clubSports: [{ sport: { key: 'padel', name: 'Padel' } }],
};
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: mockClub }) }));

// Le rôle du viewer (gating de la carte « Rôle & accès » + du bloc niveau ADMIN) est posé
// par AdminRoleContext (layout /admin), pas par un appel getMyClubs — la page ne l'appelle
// plus (contrairement à des versions antérieures). `getMyProfile` reste nécessaire : il
// alimente `viewerUserId`, utilisé par la carte Accès pour interdire l'édition de son
// propre rôle.
jest.mock('../lib/api', () => ({
  api: {
    adminGetMemberHistory: jest.fn(),
    adminGetMemberNotes: jest.fn(),
    adminAddMemberNote: jest.fn(),
    adminDeleteMemberNote: jest.fn(),
    adminSetMemberWatch: jest.fn(),
    // Bloc « Niveau » du détail : niveau courant par sport + historique des corrections +
    // formulaire de correction manuelle (LevelOverrideForm, réservé ADMIN).
    adminGetMemberLevel: jest.fn(),
    adminSetMemberLevel: jest.fn(),
    // Recharge/correction d'un solde prépayé (détail Finances).
    adminRechargePackage: jest.fn(),
    adminAdjustPackage: jest.fn(),
    // Cockpit : profil éditable, rôle & accès, identité du viewer, forfaits (WalletCard).
    adminUpdateMember: jest.fn(),
    adminSetMemberStaffRole: jest.fn(),
    adminSetMemberCoach: jest.fn(),
    adminSetMemberReferee: jest.fn(),
    adminSetMemberBlocked: jest.fn(),
    adminRemoveMember: jest.fn(),
    getMyProfile: jest.fn(),
    adminGetSubscriptionPlans: jest.fn(),
    // Carte « Messages » : historique des diffusions déjà reçues par ce membre.
    adminGetMemberBroadcasts: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

const HISTORY: MemberHistory = {
  member: {
    userId: 'u1', firstName: 'Jean', lastName: 'Dupont', pseudo: null, email: 'j@d.fr', phone: null, avatarUrl: null,
    isSubscriber: false, membershipNo: null, status: 'ACTIVE', watch: false, hasActivePackage: true, since: '2026-01-01T00:00:00.000Z',
    membershipId: 'mb1', birthDate: '1992-09-04', sex: 'FEMALE',
    address: '12 rue des Sports', postalCode: '31000', city: 'Toulouse',
    staffRole: null, isCoach: false, isReferee: false, note: null,
  },
  reservations: [
    {
      id: 'r1', status: 'CONFIRMED', type: 'COURT', startTime: '2026-06-15T18:00:00.000Z', endTime: '2026-06-15T19:00:00.000Z',
      cancelledAt: null, lateCancel: false, resourceName: 'Court 1', sportKey: 'padel', isOrganizer: true,
      attributedAmount: '36.00', dueAmount: '36.00', // entièrement réglée → « Payé X € ✓ »
      participants: [
        { userId: 'u1', firstName: 'Jean', lastName: 'Dupont', isOrganizer: true },
        { userId: 'bob', firstName: 'Bob', lastName: 'Bidon', isOrganizer: false },
      ],
      match: { winningTeam: 1, myTeam: 1, sets: [[6, 3], [6, 4]], competitive: true },
    },
    {
      id: 'r2', status: 'CANCELLED', type: 'COURT', startTime: '2026-06-10T18:00:00.000Z', endTime: '2026-06-10T19:00:00.000Z',
      cancelledAt: '2026-06-10T12:00:00.000Z', lateCancel: true, resourceName: 'Court 1', sportKey: 'padel', isOrganizer: true,
      attributedAmount: '0.00', dueAmount: '25.00',
      participants: [{ userId: 'u1', firstName: 'Jean', lastName: 'Dupont', isOrganizer: true }],
      match: null,
    },
    {
      id: 'r3', status: 'CONFIRMED', type: 'COURT', startTime: '2026-06-18T18:00:00.000Z', endTime: '2026-06-18T19:00:00.000Z',
      cancelledAt: null, lateCancel: false, resourceName: 'Court 2', sportKey: 'padel', isOrganizer: true,
      attributedAmount: '10.00', dueAmount: '25.00', // réglée partiellement → doit afficher « Reste 15,00 € », jamais « Payé ✓ »
      participants: [{ userId: 'u1', firstName: 'Jean', lastName: 'Dupont', isOrganizer: true }],
      match: null,
    },
  ],
  counts: { total: 2, confirmed: 1, cancelled: 1, lateCancelled: 1, noShow: 0, upcoming: 0, noShowCharged: 0 },
  noShowChargedLastAt: null,
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
  upcoming: [{ kind: 'tournament', id: 't1', title: 'P100 Dames', startTime: '2099-07-26T08:00:00Z', status: 'CONFIRMED' }],
  subscription: { id: 's1', planId: 'pl1', planName: 'Padel illimité', expiresAt: '2099-08-10T00:00:00Z', monthlyPriceSnapshot: '39', sportKeys: ['padel'] },
};

// Rôle du viewer via le contexte posé par le layout /admin (défaut ADMIN : comportement historique).
const renderPage = (role: 'OWNER' | 'ADMIN' | 'STAFF' | null = 'ADMIN') => render(
  <ThemeProvider><AdminRoleContext.Provider value={role}><MemberHistoryPage /></AdminRoleContext.Provider></ThemeProvider>,
);

const balEntries = { id: 'pk1', kind: 'ENTRIES' as const, name: 'Carnet 10', creditsRemaining: 3, amountRemaining: null, purchasedAt: '2026-06-01T00:00:00.000Z', expiresAt: null };
const withBalance = (): MemberHistory => ({ ...HISTORY, finance: { ...HISTORY.finance, prepaid: { balances: [balEntries], consumption: [] } } });

// Le bouton « Enregistrer » de MemberProfileCard (colonne gauche, toujours monté) et celui de
// LevelOverrideForm (détail Niveau) portent EXACTEMENT le même libellé — on scope au
// conteneur du formulaire de correction pour cibler sans ambiguïté celui du niveau.
const levelForm = () => screen.getByText('Corriger le niveau').closest('div') as HTMLElement;

beforeEach(() => {
  jest.clearAllMocks();
  mockClub = {
    id: 'club-1', name: 'Padel Arena Paris', slug: 'padel-arena-paris', levelSystemEnabled: true,
    clubSports: [{ sport: { key: 'padel', name: 'Padel' } }],
  };
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue(HISTORY);
  (api.adminGetMemberNotes as jest.Mock).mockResolvedValue([]);
  (api.adminAddMemberNote as jest.Mock).mockResolvedValue({ id: 'n1', body: 'Joueur sympa', createdAt: '2026-06-23T14:00:00.000Z', author: { firstName: 'Sarah', lastName: 'P' } });
  (api.adminSetMemberWatch as jest.Mock).mockResolvedValue({ userId: 'u1', watch: true });
  (api.adminGetMemberLevel as jest.Mock).mockResolvedValue({ levels: {}, history: [] });
  (api.adminSetMemberLevel as jest.Mock).mockResolvedValue({ calibrated: true, level: 5, tier: 'Confirmé', isProvisional: false, reliability: 95, matchesPlayed: 0 });
  (api.adminRechargePackage as jest.Mock).mockResolvedValue({ package: {}, payment: {} });
  (api.adminAdjustPackage as jest.Mock).mockResolvedValue({ package: {} });
  (api.adminUpdateMember as jest.Mock).mockResolvedValue({});
  (api.adminSetMemberStaffRole as jest.Mock).mockResolvedValue({ userId: 'u1', staffRole: 'STAFF' });
  (api.adminSetMemberCoach as jest.Mock).mockResolvedValue({ userId: 'u1', isCoach: true });
  (api.adminSetMemberReferee as jest.Mock).mockResolvedValue({ userId: 'u1', isReferee: true });
  (api.adminSetMemberBlocked as jest.Mock).mockResolvedValue({});
  (api.adminRemoveMember as jest.Mock).mockResolvedValue({ ok: true });
  (api.getMyProfile as jest.Mock).mockResolvedValue({ id: 'viewer-1' });
  (api.adminGetSubscriptionPlans as jest.Mock).mockResolvedValue([]);
  (api.adminGetMemberBroadcasts as jest.Mock).mockResolvedValue([
    { id: 'b1', title: 'Promo carnets', kind: 'COMMERCIAL', createdAt: '2026-07-20T10:00:00Z' },
  ]);
});

// ───────────────────────── Identité, hero, badges ─────────────────────────

it('affiche identité, badge « à risque » et chip « Carnet actif »', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  expect(screen.getByText('⚠ À risque')).toBeInTheDocument();
  expect(screen.getByText('Carnet actif')).toBeInTheDocument();
});

it('hero : email cliquable (mailto)', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  expect(screen.getByRole('link', { name: 'j@d.fr' })).toHaveAttribute('href', 'mailto:j@d.fr');
});

// ───────────────── Détail « Activité » (porte repliée par défaut, ouverte au clic) ─────────────────

it('détails : repliés par défaut, la porte Activité ouvre puis referme', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  // Replié au montage : rien des tableaux/graphes n'est rendu (c'est ce bloc qui faisait la hauteur).
  expect(screen.queryByText('Habitudes de jeu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Activité' }));
  expect(screen.getByText('Habitudes de jeu')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Activité' }));
  expect(screen.queryByText('Habitudes de jeu')).toBeNull();
});

it('activité : compteur d\'annulations tardives', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Activité' }));
  expect(screen.getByText('Annulations tardives')).toBeInTheDocument();
});

// ── Historique des réservations : barre de filtres Type/Statut/Paiement (remplace la case tardives) ──
// Les montants du tableau (fmtEuros sans décimales : « 36 € », « 10 € », « 0 € ») n'apparaissent
// QUE dans le tableau — la carte « Dernières réservations » et « Paiements » les formatent
// autrement (« Payé 36,00 € ✓ », « Total dépensé : 36 € » composé) → matchs sans ambiguïté.

it('historique : filtrer par statut « Annulée » ne garde que les résas annulées', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Activité' }));
  // avant filtre : les 3 lignes de la fixture (r1 36 €, r3 10 €, r2 annulée 0 €)
  expect(screen.getByText('36 €')).toBeInTheDocument();
  expect(screen.getByText('10 €')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Annulée' })); // chip Statut (bouton, ≠ span du tableau)
  expect(screen.queryByText('36 €')).toBeNull();
  expect(screen.queryByText('10 €')).toBeNull();
  expect(screen.getByText('0 €')).toBeInTheDocument(); // r2 (annulée + tardive) subsiste
});

it('historique : filtrer par paiement « Reste dû » isole la résa partiellement réglée', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Activité' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reste dû' }));
  // r3 (payé 10 sur 25) reste ; r1 (réglée) et r2 (annulée → ni réglée ni due) partent.
  expect(screen.getByText('10 €')).toBeInTheDocument();
  expect(screen.queryByText('36 €')).toBeNull();
  expect(screen.queryByText('0 €')).toBeNull();
  // pied « N réservation affichée sur M » + Effacer réinitialise
  expect(screen.getByText(/1 réservation affichée sur 3/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
  expect(screen.getByText('36 €')).toBeInTheDocument();
});

it('activité : No-show facturés à 0 → hint "aucun", ton neutre', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Activité' }));
  expect(screen.getByText('No-show facturés')).toBeInTheDocument();
  expect(screen.getByText('aucun')).toBeInTheDocument();
});

it('activité : No-show facturés > 0 → récidive visible, ton coral', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue({
    ...HISTORY,
    counts: { ...HISTORY.counts, noShowCharged: 3 },
    noShowChargedLastAt: '2026-06-17T20:00:00.000Z',
  });
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Activité' }));
  // Scopé à la StatCard : depuis la refonte, un compteur de chip « Terrain » peut aussi
  // valoir « 3 » (3 résas COURT) → getByText('3') global serait ambigu.
  const card = screen.getByText('No-show facturés').closest('div') as HTMLElement;
  const value = within(card).getByText('3');
  expect(value).toHaveStyle({ color: '#b23c17' }); // th.danger (thème clair, AA sur fond blanc)
  expect(screen.getByText(/dernier le/i)).toBeInTheDocument();
});

// ───────────────────────── Détail « Finances » ─────────────────────────

it('finances : bascule sur l\'onglet et formate les montants', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Finances' }));
  await screen.findByText('Total dépensé');
  expect(screen.getByText('Espèces')).toBeInTheDocument();
  expect(screen.getByText('30 €')).toBeInTheDocument();
  expect(screen.getByText("Chiffre d'affaires par mois")).toBeInTheDocument();
});

it('finances : recharger un solde appelle adminRechargePackage', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue(withBalance());
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Finances' }));
  // « Recharger Carnet 10 » (aria-label) est distinct du bouton texte « Recharger » de
  // MemberWalletCard (colonne droite, toujours monté lui aussi) — pas de collision de nom.
  fireEvent.click(await screen.findByRole('button', { name: 'Recharger Carnet 10' }));
  fireEvent.change(await screen.findByLabelText('Entrées à ajouter'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Montant encaissé (€)'), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.adminRechargePackage).toHaveBeenCalledWith(
    'club-1', 'u1', 'pk1', expect.objectContaining({ addEntries: 5, price: 100 }), 'tok'));
});

it('finances : « Corriger » disponible pour tout staff', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue(withBalance());
  renderPage('STAFF');
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Finances' }));
  expect(await screen.findByRole('button', { name: 'Recharger Carnet 10' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Corriger Carnet 10' })).toBeInTheDocument();
});

it('finances : un ADMIN corrige un solde (adminAdjustPackage)', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue(withBalance());
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Finances' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Corriger Carnet 10' }));
  fireEvent.change(await screen.findByLabelText("Nouveau nombre d'entrées"), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Motif de la correction'), { target: { value: 'erreur' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.adminAdjustPackage).toHaveBeenCalledWith(
    'club-1', 'u1', 'pk1', { newCredits: 8, reason: 'erreur' }, 'tok'));
});

// ───────────────────────── Détail « Niveau » — jeu + gating admin ─────────────────────────

it('niveau : partenaires fréquents + courbe de progression', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  await screen.findByText('Partenaires fréquents');
  expect(screen.getByText('Bob B')).toBeInTheDocument();
  expect(screen.getByLabelText('Courbe de progression du niveau')).toBeInTheDocument();
});

it('niveau : viewer ADMIN → niveau courant, historique et formulaire de correction chargés', async () => {
  (api.adminGetMemberLevel as jest.Mock).mockResolvedValue({
    levels: { padel: { level: 4.2, tier: 'Confirmé', isProvisional: false, reliability: 88 } },
    history: [
      { id: 'h1', previousLevel: 3.5, newLevel: 4.2, reason: 'Recalage manuel', createdAt: '2026-06-10T10:00:00Z', staffFirstName: 'Bob', staffLastName: 'Staff', sportKey: 'padel', sportName: 'Padel' },
    ],
  });
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  expect(await screen.findByText('Corriger le niveau')).toBeInTheDocument();
  expect(api.adminGetMemberLevel).toHaveBeenCalledWith('club-1', 'u1', 'tok');
  // niveau courant par sport + palier
  expect(screen.getByText('4.2')).toBeInTheDocument();
  expect(screen.getByText('Confirmé')).toBeInTheDocument();
  // historique des corrections : ancien → nouveau + motif + auteur
  expect(screen.getByText('3.5 → 4.2')).toBeInTheDocument();
  expect(screen.getByText(/Recalage manuel/)).toBeInTheDocument();
  expect(screen.getByText(/Bob Staff/)).toBeInTheDocument();
});

it('niveau : viewer STAFF → blocs admin masqués et niveau admin non chargé (la route répond 403)', async () => {
  renderPage('STAFF');
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  await screen.findByText('Partenaires fréquents'); // le jeu (history, route STAFF) reste visible
  expect(screen.queryByText('Corriger le niveau')).toBeNull();
  expect(screen.queryByText('Historique des corrections')).toBeNull();
  expect(screen.queryByText('Niveau par sport')).toBeNull();
  expect(api.adminGetMemberLevel).not.toHaveBeenCalled();
});

// ───────────────────────── Détail « Niveau » — correction manuelle (LevelOverrideForm) ─────────────────────────
// Ces cas viennent de l'ex-AdminMemberLevel.test.tsx : il n'existe pas de suite dédiée à
// LevelOverrideForm.tsx, donc sa validation/arrondi/mapping d'erreurs ne sont exercés qu'ici.

it('niveau : soumettre la correction appelle adminSetMemberLevel et recharge la fiche', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  await screen.findByText('Corriger le niveau');
  expect(api.adminGetMemberLevel).toHaveBeenCalledTimes(1);

  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText(/Motif/i), { target: { value: 'décision comité' } });
  fireEvent.click(within(levelForm()).getByRole('button', { name: /Enregistrer/i }));

  await waitFor(() => expect(api.adminSetMemberLevel).toHaveBeenCalledWith(
    'club-1', 'u1', { sportKey: 'padel', level: 5, reason: 'décision comité' }, 'tok',
  ));
  // rechargement de la fiche après succès (2e appel adminGetMemberLevel)
  await waitFor(() => expect(api.adminGetMemberLevel).toHaveBeenCalledTimes(2));
});

it('niveau : système de niveau désactivé → correction masquée, niveau jamais chargé', async () => {
  mockClub = { id: 'club-1', levelSystemEnabled: false, clubSports: [] };
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  expect(screen.queryByText('Corriger le niveau')).not.toBeInTheDocument();
  expect(api.adminGetMemberLevel).not.toHaveBeenCalled();
});

it('niveau : mappe une erreur 403 (FORBIDDEN) en message français', async () => {
  (api.adminSetMemberLevel as jest.Mock).mockRejectedValue(new Error('FORBIDDEN'));
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  await screen.findByText('Corriger le niveau');
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '5' } });
  fireEvent.click(within(levelForm()).getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Réservé aux administrateurs du club.')).toBeInTheDocument();
});

it('niveau : affiche une confirmation de succès, effacée dès l\'édition suivante', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  await screen.findByText('Corriger le niveau');
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '5' } });
  fireEvent.click(within(levelForm()).getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Niveau corrigé.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '6' } });
  expect(screen.queryByText('Niveau corrigé.')).not.toBeInTheDocument();
});

it('niveau : arrondit le niveau au dixième avant l\'envoi', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  await screen.findByText('Corriger le niveau');
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '4.25' } });
  fireEvent.click(within(levelForm()).getByRole('button', { name: /Enregistrer/i }));
  await waitFor(() => expect(api.adminSetMemberLevel).toHaveBeenCalledWith(
    'club-1', 'u1', { sportKey: 'padel', level: 4.3, reason: undefined }, 'tok',
  ));
});

it('niveau : niveaux vides → message « aucun niveau » mais formulaire quand même disponible', async () => {
  (api.adminGetMemberLevel as jest.Mock).mockResolvedValue({
    levels: {},
    history: [
      { id: 'h1', previousLevel: null, newLevel: 4, reason: null, createdAt: '2026-06-10T10:00:00Z', staffFirstName: 'Bob', staffLastName: 'Staff', sportKey: 'padel', sportName: 'Padel' },
    ],
  });
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  expect(await screen.findByText(/Aucun niveau enregistré/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Niveau \(0–8\)/i)).toBeInTheDocument();
  expect(screen.getByText('— → 4.0')).toBeInTheDocument();
});

it('niveau : échec de chargement du niveau → la fiche reste lisible (nom, « aucun niveau »)', async () => {
  (api.adminGetMemberLevel as jest.Mock).mockRejectedValue(new Error('BOOM'));
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  expect(await screen.findByText(/Aucun niveau enregistré/i)).toBeInTheDocument();
});

it('niveau : rejette côté client un niveau invalide (9) sans appeler l\'API', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Niveau' }));
  await screen.findByText('Corriger le niveau');
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '9' } });
  fireEvent.click(within(levelForm()).getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Niveau invalide (doit être entre 0 et 8).')).toBeInTheDocument();
  expect(api.adminSetMemberLevel).not.toHaveBeenCalled();
});

// ───────────────────────── Carte « Notes » (colonne gauche) ─────────────────────────

it('notes : ajouter un commentaire appelle l\'API et l\'affiche', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  const ta = await screen.findByPlaceholderText(/Ajouter un commentaire/);
  fireEvent.change(ta, { target: { value: 'Joueur sympa' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  await waitFor(() => expect(api.adminAddMemberNote).toHaveBeenCalledWith('club-1', 'u1', 'Joueur sympa', 'tok'));
  expect(await screen.findByText('Joueur sympa')).toBeInTheDocument();
});

it('notes : seules les 3 dernières sont affichées, « Voir les N précédentes » déplie', async () => {
  (api.adminGetMemberNotes as jest.Mock).mockResolvedValue(
    Array.from({ length: 5 }, (_, i) => ({
      id: `n${i}`, body: `Note ${i}`, createdAt: '2026-07-01T10:00:00.000Z',
      author: { firstName: 'Sarah', lastName: 'P' },
    })),
  );
  renderPage();
  await screen.findByText('Jean Dupont');
  expect(await screen.findByText('Note 0')).toBeInTheDocument();
  expect(screen.getByText('Note 2')).toBeInTheDocument();
  expect(screen.queryByText('Note 3')).toBeNull(); // au-delà de l'aperçu : replié
  fireEvent.click(screen.getByRole('button', { name: 'Voir les 2 précédentes →' }));
  expect(screen.getByText('Note 4')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Réduire' }));
  expect(screen.queryByText('Note 4')).toBeNull();
});

// ───────────────────────── Hero : « à surveiller » ─────────────────────────

it('toggle « à surveiller » appelle l\'API', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: /Marquer à surveiller/ }));
  await waitFor(() => expect(api.adminSetMemberWatch).toHaveBeenCalledWith('club-1', 'u1', true, 'tok'));
});

// ───────────────────────── Cockpit : carte Profil ─────────────────────────

it('cockpit : profil pré-rempli et enregistrement via adminUpdateMember', async () => {
  renderPage();
  const addr = await screen.findByLabelText('Adresse');
  expect(addr).toHaveValue('12 rue des Sports');
  fireEvent.change(addr, { target: { value: '1 avenue du Club' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.adminUpdateMember).toHaveBeenCalledWith(
    'club-1', 'mb1', expect.objectContaining({ address: '1 avenue du Club', city: 'Toulouse' }), 'tok'));
});

it('cockpit : la note libre du membre (ClubMembership.note) est pré-remplie et enregistrée', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue({
    ...HISTORY, member: { ...HISTORY.member, note: 'Client fidèle, préfère le court 1.' },
  });
  renderPage();
  const noteField = await screen.findByLabelText('Note');
  expect(noteField).toHaveValue('Client fidèle, préfère le court 1.');
  fireEvent.change(noteField, { target: { value: 'Client fidèle, allergique aux tickets CE.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.adminUpdateMember).toHaveBeenCalledWith(
    'club-1', 'mb1', expect.objectContaining({ note: 'Client fidèle, allergique aux tickets CE.' }), 'tok'));
});

it('cockpit : le pseudo existant est pré-rempli et enregistré', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue({
    ...HISTORY, member: { ...HISTORY.member, pseudo: 'SmashMaster' },
  });
  renderPage();
  const pseudo = await screen.findByLabelText('Pseudo');
  expect(pseudo).toHaveValue('SmashMaster');
  fireEvent.change(pseudo, { target: { value: 'NouveauPseudo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.adminUpdateMember).toHaveBeenCalledWith(
    'club-1', 'mb1', expect.objectContaining({ pseudo: 'NouveauPseudo' }), 'tok'));
});

it('cockpit : sans pseudo, le champ est vide et l’enregistrement envoie null', async () => {
  renderPage();
  const pseudo = await screen.findByLabelText('Pseudo');
  expect(pseudo).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.adminUpdateMember).toHaveBeenCalledWith(
    'club-1', 'mb1', expect.objectContaining({ pseudo: null }), 'tok'));
});

it('cockpit : pseudo au format invalide → PSEUDO_INVALID affiché en français', async () => {
  (api.adminUpdateMember as jest.Mock).mockRejectedValue(new Error('PSEUDO_INVALID'));
  renderPage();
  fireEvent.change(await screen.findByLabelText('Pseudo'), { target: { value: 'a b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText(/3 à 20 caractères/i)).toBeInTheDocument();
});

it('cockpit : pseudo déjà pris → PSEUDO_TAKEN affiché en français', async () => {
  (api.adminUpdateMember as jest.Mock).mockRejectedValue(new Error('PSEUDO_TAKEN'));
  renderPage();
  fireEvent.change(await screen.findByLabelText('Pseudo'), { target: { value: 'SmashMaster' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Ce pseudo est déjà pris.')).toBeInTheDocument();
});

// ───────────────────────── Bandeau d'alertes ─────────────────────────

it("bandeau d'alertes : reste dû + abonnement qui expire", async () => {
  // Fenêtre calculée au runtime (5 j) : robuste indépendamment de la date système du CI.
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue({
    ...HISTORY,
    finance: { ...HISTORY.finance, outstanding: '12.00' },
    subscription: { ...HISTORY.subscription!, expiresAt: soon },
  });
  renderPage();
  // Le bandeau d'alertes utilise "12,00 € dus" (fmtCents) — distinct du "12 € dus" de la
  // carte Paiements (fmtEuros, sans décimales) : la regex évite un match ambigu.
  expect(await screen.findByText(/12,00 € dus/)).toBeInTheDocument();
  expect(screen.getByText(/expire dans/)).toBeInTheDocument();
});

// ───────────────────────── Carte « Dernières réservations » ─────────────────────────

it('dernières réservations : ligne annulée estompée avec mention tardive', async () => {
  renderPage();
  expect(await screen.findByText(/Annulée · tardive/)).toBeInTheDocument();
  // la résa confirmée avec match saisi affiche aussi le résultat (V/D + score)
  expect(screen.getByText(/V 6-3 6-4/)).toBeInTheDocument();
});

it('dernières réservations : une résa partiellement réglée affiche « Reste X € », jamais « Payé ✓ »', async () => {
  renderPage();
  // r3 : payé 10,00 € sur 25,00 € dus → doit afficher le reste, pas une fausse coche verte.
  expect(await screen.findByText(/Reste 15,00 €/)).toBeInTheDocument();
  // r1 : intégralement réglée (36,00 € payés = 36,00 € dus) → reste « Payé ... ✓ ».
  expect(screen.getByText(/Payé 36,00 € ✓/)).toBeInTheDocument();
});

// ───────────────────────── Carte « Rôle & accès » ─────────────────────────
// Ces cas viennent de l'ex-AdminMembersStaff.test.tsx (panneau MemberPanel, supprimé en
// Task 6) — c'est la promesse « déplacé dans MemberHistory.test.tsx (fiche 360) » de son
// commentaire orphelin. Coach/Juge-arbitre/Bloquer/Supprimer + leur garde MEMBER_IS_STAFF
// et le gating viewer STAFF n'avaient, avant cette passe, aucune assertion réelle malgré
// des mocks déjà présents dans le fichier.

it('rôle & accès : changer le rôle appelle adminSetMemberStaffRole', async () => {
  renderPage('ADMIN');
  await screen.findByText('Jean Dupont');
  fireEvent.click(await screen.findByRole('button', { name: 'Staff' }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u1', 'STAFF', 'tok'));
});

it('rôle & accès : re-sélectionner le rôle courant = no-op (pas de PATCH)', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue({ ...HISTORY, member: { ...HISTORY.member, staffRole: 'STAFF' } });
  renderPage('ADMIN');
  await screen.findByText('Jean Dupont');
  fireEvent.click(await screen.findByRole('button', { name: 'Staff' }));
  expect(api.adminSetMemberStaffRole).not.toHaveBeenCalled();
});

it('rôle & accès : lecture seule sur le gérant (OWNER) — le texte remplace le Segmented, Coach reste cliquable', async () => {
  // canEditRole = canManageStaff && viewer != null && staffRole !== 'OWNER' && userId !== viewer.userId
  // → cible OWNER : le Segmented Membre/Staff/Admin disparaît au profit d'un texte lecture seule,
  // mais les cases Coach/Juge-arbitre restent gérées par canManageStaff seul (pas par canEditRole).
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue({ ...HISTORY, member: { ...HISTORY.member, staffRole: 'OWNER' } });
  renderPage('ADMIN');
  await screen.findByText('Jean Dupont');
  const group = screen.getByRole('group', { name: 'Rôle de Jean Dupont' });
  expect(within(group).queryByRole('button', { name: 'Staff' })).toBeNull();
  expect(within(group).queryByRole('button', { name: 'Membre' })).toBeNull();
  expect(within(group).getByText('Gérant')).toBeInTheDocument();
  // Coach/Juge-arbitre vivent hors du `role="group"` du sélecteur de rôle (bloc sœur, même
  // garde canManageStaff) — gated indépendamment de canEditRole, donc toujours cliquables ici.
  const coach = screen.getByRole('checkbox', { name: /Coach/ });
  expect(coach).toBeInTheDocument();
  fireEvent.click(coach);
  await waitFor(() => expect(api.adminSetMemberCoach).toHaveBeenCalledWith('club-1', 'u1', true, 'tok'));
});

it('rôle & accès : lecture seule quand la cible est le viewer lui-même — Coach reste cliquable', async () => {
  // Même branche canEditRole, deuxième condition : member.userId === viewer.userId.
  (api.getMyProfile as jest.Mock).mockResolvedValue({ id: 'u1' }); // viewer = la cible ('u1')
  renderPage('ADMIN');
  await screen.findByText('Jean Dupont');
  const group = await waitFor(() => screen.getByRole('group', { name: 'Rôle de Jean Dupont' }));
  expect(within(group).queryByRole('button', { name: 'Membre' })).toBeNull();
  expect(within(group).queryByRole('button', { name: 'Staff' })).toBeNull();
  expect(within(group).getByText('Membre')).toBeInTheDocument(); // staffRole null (fixture par défaut)
  expect(screen.getByRole('checkbox', { name: /Coach/ })).toBeInTheDocument();
});

it('rôle & accès : cocher « Coach » appelle adminSetMemberCoach puis recharge la fiche', async () => {
  renderPage('ADMIN');
  await screen.findByText('Jean Dupont');
  fireEvent.click(await screen.findByRole('checkbox', { name: /Coach/ }));
  await waitFor(() => expect(api.adminSetMemberCoach).toHaveBeenCalledWith('club-1', 'u1', true, 'tok'));
  // le rechargement post-mutation repasse par la fiche (2e appel adminGetMemberHistory)
  await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalledTimes(2));
});

it('rôle & accès : cocher « Juge-arbitre » appelle adminSetMemberReferee, indépendant de Coach', async () => {
  renderPage('ADMIN');
  await screen.findByText('Jean Dupont');
  fireEvent.click(await screen.findByRole('checkbox', { name: /Juge-arbitre/ }));
  await waitFor(() => expect(api.adminSetMemberReferee).toHaveBeenCalledWith('club-1', 'u1', true, 'tok'));
  expect(api.adminSetMemberCoach).not.toHaveBeenCalled();
});

it('rôle & accès : viewer STAFF → aucun bloc Rôle/Coach/Juge-arbitre visible (canManageStaff=false)', async () => {
  renderPage('STAFF');
  await screen.findByText('Jean Dupont');
  expect(screen.queryByRole('checkbox', { name: /Coach/ })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: /Juge-arbitre/ })).toBeNull();
  expect(screen.queryByRole('group', { name: /Rôle de/ })).toBeNull();
  // l'interrupteur Abonné, lui, n'est pas gated par canManageStaff : il reste visible
  expect(screen.getByRole('checkbox', { name: /Abonné/ })).toBeInTheDocument();
});

it('rôle & accès : bloquer un membre appelle adminSetMemberBlocked(true)', async () => {
  renderPage('ADMIN');
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Bloquer' }));
  await waitFor(() => expect(api.adminSetMemberBlocked).toHaveBeenCalledWith('club-1', 'mb1', true, 'tok'));
});

it('rôle & accès : bloquer un membre staff → 409 MEMBER_IS_STAFF affiché en français', async () => {
  (api.adminSetMemberBlocked as jest.Mock).mockRejectedValue(new Error('MEMBER_IS_STAFF'));
  renderPage('ADMIN');
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Bloquer' }));
  expect(await screen.findByText(/retirez d'abord son rôle/i)).toBeInTheDocument();
});

it('rôle & accès : supprimer un membre → confirmation puis adminRemoveMember + navigation vers la liste', async () => {
  renderPage('ADMIN');
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer le membre' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' })); // confirmation
  await waitFor(() => expect(api.adminRemoveMember).toHaveBeenCalledWith('club-1', 'mb1', 'tok'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/members'));
});

it('rôle & accès : supprimer un membre staff → 409 MEMBER_IS_STAFF affiché en français', async () => {
  (api.adminRemoveMember as jest.Mock).mockRejectedValue(new Error('MEMBER_IS_STAFF'));
  renderPage('ADMIN');
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer le membre' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
  expect(await screen.findByText(/retirez d'abord son rôle/i)).toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalledWith('/admin/members');
});

// ───────────────────────── Carte « Abonnement & soldes » (MemberWalletCard) ─────────────────────────

it('wallet : abonnement affiché, « Renouveler » ouvre SubscriptionActions avec les données du membre', async () => {
  renderPage();
  await screen.findByText('Jean Dupont');
  expect(screen.getByText('Padel illimité')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Renouveler' }));
  // texte fixe de la phrase d'explication du dialog (évite le souci d'apostrophe typographique
  // du titre « Renouveler l’abonnement ») — preuve que SubscriptionActions s'est bien ouvert
  // avec le bon abonnement/forfait, pas juste que le bouton existe.
  expect(await screen.findByText(/Prolonge la période sans perte de jours/)).toBeInTheDocument();
  expect(api.adminGetSubscriptionPlans).toHaveBeenCalledWith('club-1', 'tok');
});

it('wallet : les soldes épuisés/expirés sont masqués derrière « tout voir » (→ porte Finances)', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue({
    ...HISTORY,
    finance: {
      ...HISTORY.finance,
      prepaid: {
        balances: [
          balEntries, // utilisable (3 entrées, pas d'expiration)
          { ...balEntries, id: 'pk-dead', name: 'Vieux carnet', creditsRemaining: 0 }, // épuisé
          { ...balEntries, id: 'pk-exp', name: 'Carnet expiré', expiresAt: '2020-01-01T00:00:00.000Z' }, // expiré
        ],
        consumption: [],
      },
    },
  });
  renderPage();
  await screen.findByText('Jean Dupont');
  const wallet = screen.getByRole('region', { name: 'Abonnement et soldes' });
  expect(within(wallet).getByText('Carnet 10')).toBeInTheDocument();
  expect(within(wallet).queryByText('Vieux carnet')).toBeNull();
  expect(within(wallet).queryByText('Carnet expiré')).toBeNull();
  // Le lien « tout voir » ouvre la porte Finances, où TOUS les soldes restent gérés.
  fireEvent.click(within(wallet).getByRole('button', { name: /2 autres soldes .* tout voir/ }));
  expect(await screen.findByText('Prépayé (carnets / porte-monnaie)')).toBeInTheDocument();
  expect(screen.getByText('Vieux carnet')).toBeInTheDocument();
});

// ───────────────────────── Contact (dans le hero) ─────────────────────────

it('hero : téléphone cliquable quand renseigné, absent sinon', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockResolvedValue({
    ...HISTORY, member: { ...HISTORY.member, phone: '0611009030' },
  });
  renderPage();
  await screen.findByText('Jean Dupont');
  expect(screen.getByRole('link', { name: '0611009030' })).toHaveAttribute('href', 'tel:0611009030');
});

// ───────────────────────── Carte « Messages » ─────────────────────────

it('carte Contact : « Envoyer un message » dépose le destinataire et navigue vers le composer', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Envoyer un message/ }));
  expect(JSON.parse(sessionStorage.getItem('palova:broadcast-recipients') ?? 'null'))
    .toEqual([{ userId: 'u1', name: 'Jean D.' }]);
  expect(mockPush).toHaveBeenCalledWith('/admin/broadcast');
});

it('carte Contact : liste les derniers messages reçus', async () => {
  renderPage();
  expect(await screen.findByText('Promo carnets')).toBeInTheDocument();
});

// ───────────────────────── Erreur de chargement ─────────────────────────

it('membre introuvable → message d\'erreur', async () => {
  (api.adminGetMemberHistory as jest.Mock).mockRejectedValueOnce(new Error('MEMBER_NOT_FOUND'));
  renderPage();
  await waitFor(() => expect(screen.getByText('Membre introuvable dans ce club.')).toBeInTheDocument());
});
