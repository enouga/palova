import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MyProfilePage from '../app/me/profile/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

let clubCtx: { slug: string | null; club: { id: string; slug: string; name: string; levelSystemEnabled?: boolean } | null; loading: boolean } =
  { slug: null, club: null, loading: false };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubCtx }));

jest.mock('../components/ClubNav', () => ({ ClubNav: () => <nav /> }));

jest.mock('../lib/api', () => ({
  api: {
    getMyProfile: jest.fn(), getMyClubs: jest.fn(), getMyClubMembership: jest.fn(),
    getMyClubPackages: jest.fn(), getMyClubSubscriptions: jest.fn(), getMyPayments: jest.fn(),
    getMyPaymentMethod: jest.fn(), removeMyPaymentMethod: jest.fn(),
    getAccountDeletionSummary: jest.fn(), deleteMyAccount: jest.fn(),
    updateMyProfile: jest.fn(), updateMyClubMembership: jest.fn(), uploadMyAvatar: jest.fn(),
    getMyRating: jest.fn().mockResolvedValue(null), getRatingHistory: jest.fn().mockResolvedValue([]),
    getMyClubMatchStats: jest.fn(), calibrateRating: jest.fn(), changePassword: jest.fn(),
    getSports: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (p: string | null) => (p ? `http://localhost:3001${p}` : null),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const profile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede', phone: '0609032635', sex: 'MALE',
  birthDate: '1973-07-08T00:00:00.000Z', avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false, acceptsFriendRequests: false, acceptsDirectMessages: true, preferredSport: null,
};

const PADEL = { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true };

const wrap = () => render(<ThemeProvider><MyProfilePage /></ThemeProvider>);
const onClub = () => { clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo' }, loading: false }; };
const goTab = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));

// jsdom n'implémente pas URL.createObjectURL (l'aperçu local de l'avatar s'en sert).
// Stub local plutôt que global : AnnouncementStudio.test.tsx teste au contraire le repli
// quand l'API est absente, un stub dans jest.setup.ts le casserait.
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: jest.fn(() => 'blob:avatar'), configurable: true });
});

describe('Page Mon profil — onglets + SaveBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/me/profile');
    document.cookie = 'token=abc; path=/';
    clubCtx = { slug: null, club: null, loading: false };
    api.getMyProfile.mockResolvedValue(profile);
    api.getMyClubs.mockResolvedValue([]);
    api.getMyClubMembership.mockResolvedValue(null);
    api.getMyClubPackages.mockResolvedValue([]);
    api.getMyClubSubscriptions.mockResolvedValue([]);
    api.getMyPayments.mockResolvedValue([]);
    api.getMyPaymentMethod.mockResolvedValue(null);
    api.getAccountDeletionSummary.mockResolvedValue({ blockingClubs: [], futureReservations: 0, activeSubscriptions: 0, balances: [] });
    api.updateMyProfile.mockResolvedValue(profile);
    api.uploadMyAvatar.mockResolvedValue({ ...profile, avatarUrl: '/uploads/avatars/u1-2.png' });
    api.changePassword.mockResolvedValue({ ok: true });
    api.getMyClubMatchStats.mockResolvedValue({ wins: 0, losses: 0, streak: 0 });
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  // --- Onglets ---

  it('ouvre sur Identité, sans barre d’enregistrement au repos', async () => {
    wrap();
    expect(await screen.findByRole('region', { name: 'Informations' })).toBeInTheDocument();
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
  });

  it('change d’onglet et reflète l’onglet actif dans l’URL', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Préférences');
    expect(await screen.findByRole('region', { name: 'Préférences' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Informations' })).not.toBeInTheDocument();
    expect(window.location.search).toContain('tab=preferences');
  });

  it('ouvre sur l’onglet nommé dans ?tab= au montage', async () => {
    window.history.replaceState(null, '', '/me/profile?tab=securite');
    wrap();
    expect(await screen.findByRole('region', { name: 'Mot de passe' })).toBeInTheDocument();
  });

  it('hôte plateforme : pas d’onglet Portefeuille', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    expect(screen.queryByRole('button', { name: 'Portefeuille' })).not.toBeInTheDocument();
  });

  it('?tab=portefeuille sur un hôte sans portefeuille retombe sur Identité (pas d’onglet mort)', async () => {
    window.history.replaceState(null, '', '/me/profile?tab=portefeuille');
    wrap();
    expect(await screen.findByRole('region', { name: 'Informations' })).toBeInTheDocument();
  });

  it('club OFF : pas d’onglet Niveau', async () => {
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo', levelSystemEnabled: false }, loading: false };
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    expect(screen.queryByRole('button', { name: 'Niveau' })).not.toBeInTheDocument();
  });

  // --- Brouillon & SaveBar ---

  it('éditer un champ révèle la barre et Enregistrer envoie le PATCH complet', async () => {
    wrap();
    fireEvent.change(await screen.findByLabelText('Téléphone'), { target: { value: '0700000000' } });
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '0700000000', sex: 'MALE', birthDate: '1973-07-08' }), 'abc',
    ));
    expect(await screen.findByText('Enregistré ✓')).toBeInTheDocument();
  });

  it('les préférences sont différées : aucun appel réseau avant Enregistrer', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Préférences');
    const group = await screen.findByRole('group', { name: 'Propose-moi les parties à mon niveau' });
    fireEvent.click(within(group).getByText('Oui'));
    expect(api.updateMyProfile).not.toHaveBeenCalled();
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ autoMatchProposals: true }), 'abc',
    ));
  });

  it('la langue est différée et part dans le même PATCH', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Préférences');
    fireEvent.change(await screen.findByLabelText('Langue'), { target: { value: 'es' } });
    expect(api.updateMyProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }), 'abc'));
  });

  it('le sport préféré est différé et part en preferredSportId', async () => {
    api.getSports.mockResolvedValue([PADEL]);
    wrap();
    const region = await screen.findByRole('region', { name: 'Sport préféré' });
    fireEvent.click(within(region).getByText('Padel'));
    expect(api.updateMyProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ preferredSportId: 'sport-padel' }), 'abc',
    ));
  });

  it('Annuler restaure le brouillon et cache la barre, sans appel réseau', async () => {
    wrap();
    const phone = await screen.findByLabelText('Téléphone');
    fireEvent.change(phone, { target: { value: '0700000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(phone).toHaveValue('0609032635');
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
    expect(api.updateMyProfile).not.toHaveBeenCalled();
  });

  it('un échec d’enregistrement s’affiche dans la barre, sans flash de succès', async () => {
    api.updateMyProfile.mockRejectedValue(new Error('Boom'));
    wrap();
    fireEvent.change(await screen.findByLabelText('Téléphone'), { target: { value: '0700000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    expect(screen.queryByText('Enregistré ✓')).not.toBeInTheDocument();
  });

  it('une édition faite pendant un enregistrement en vol n’est pas écrasée (régression)', async () => {
    let resolve!: (v: unknown) => void;
    api.updateMyProfile.mockReturnValue(new Promise((r) => { resolve = r; }));
    wrap();
    const phone = await screen.findByLabelText('Téléphone');
    fireEvent.change(phone, { target: { value: '0700000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    // L'utilisateur continue d'éditer pendant que la requête est en vol.
    fireEvent.change(phone, { target: { value: '0788888888' } });
    resolve(profile);
    await waitFor(() => expect(phone).toHaveValue('0788888888'));
    // …et la page reste dirty : la seconde édition n'a pas été enregistrée.
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
  });

  // --- Hors brouillon ---

  it('l’onglet Préférences ne rend AUCUN sélecteur de thème (il vit dans l’en-tête)', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Préférences');
    await screen.findByRole('region', { name: 'Préférences' });
    expect(screen.queryByText('Thème')).not.toBeInTheDocument();
    expect(screen.queryByText('Sombre')).not.toBeInTheDocument();
    // Le ThemeToggle de l'en-tête plateforme, lui, est bien là.
    expect(screen.getByLabelText('Changer de thème')).toBeInTheDocument();
  });

  it('l’upload d’avatar ne rend jamais la page dirty', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choisir une photo de profil'), { target: { files: [file] } });
    await waitFor(() => expect(api.uploadMyAvatar).toHaveBeenCalled());
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
  });

  it('l’upload d’avatar pendant une édition ne détruit pas le brouillon (régression)', async () => {
    wrap();
    const phone = await screen.findByLabelText('Téléphone');
    fireEvent.change(phone, { target: { value: '0700000000' } });
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choisir une photo de profil'), { target: { files: [file] } });
    await waitFor(() => expect(api.uploadMyAvatar).toHaveBeenCalled());
    expect(phone).toHaveValue('0700000000');
  });

  it('refuse un format de fichier non supporté sans appeler l’API', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    const file = new File(['x'], 'a.gif', { type: 'image/gif' });
    fireEvent.change(screen.getByLabelText('Choisir une photo de profil'), { target: { files: [file] } });
    expect(api.uploadMyAvatar).not.toHaveBeenCalled();
    expect(await screen.findByText(/Format d’image non supporté/)).toBeInTheDocument();
  });

  it('le mot de passe garde son bouton propre, hors de la barre', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Sécurité');
    fireEvent.change(await screen.findByLabelText('Mot de passe actuel'), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'password123' } });
    // Éditer le formulaire de mot de passe ne rend PAS la page dirty.
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le mot de passe' }));
    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith('old', 'password123', 'abc'));
    expect(await screen.findByText('Modifié ✓')).toBeInTheDocument();
  });

  it('refuse une confirmation qui ne correspond pas, sans appeler l’API', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Sécurité');
    fireEvent.change(await screen.findByLabelText('Nouveau mot de passe'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'autre1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le mot de passe' }));
    expect(await screen.findByText('Les mots de passe ne correspondent pas.')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('refuse un nouveau mot de passe trop court, sans appeler l’API', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Sécurité');
    fireEvent.change(await screen.findByLabelText('Nouveau mot de passe'), { target: { value: 'court' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'court' } });
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le mot de passe' }));
    expect(await screen.findByText('Le mot de passe doit faire au moins 8 caractères.')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  // --- Identité / Niveau ---

  it('le hero affiche l’identité ; l’email n’est plus un champ', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    expect(screen.getByText('Eric Nougayrede')).toBeInTheDocument();
    expect(screen.getByText('eric@palova.fr')).toBeInTheDocument();
    // L'astuce « L'email ne peut pas être modifié » n'a plus lieu d'être : plus aucun champ email.
    expect(screen.queryByText('L’email ne peut pas être modifié.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Téléphone')).toHaveValue('0609032635');
  });

  it('l’onglet Niveau affiche le bilan V/D du club', async () => {
    onClub();
    api.getMyRating.mockResolvedValue({ calibrated: true, level: 5.2, tier: 'Intermédiaire', isProvisional: false, reliability: 80 });
    api.getMyClubMatchStats.mockResolvedValue({ wins: 3, losses: 1, streak: 2 });
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Niveau');
    expect(await screen.findByText(/Résultats · Club Démo/)).toBeInTheDocument();
  });

  it('niveau non calibré : état neutre, « Affiner » révèle le calibrage', async () => {
    api.getMyRating.mockResolvedValue({ calibrated: false, level: null, tier: '—', isProvisional: true, reliability: 10 });
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Niveau');
    expect(await screen.findByText(/Niveau en cours de calibrage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Affiner mon niveau/ }));
    expect(await screen.findByText(/Place le curseur sur le niveau/)).toBeInTheDocument();
  });

  it('calibrer envoie le niveau choisi', async () => {
    api.getMyRating.mockResolvedValue({ calibrated: false, level: null, tier: '—', isProvisional: true, reliability: 10 });
    api.calibrateRating.mockResolvedValue({ calibrated: true, level: 4, tier: 'Intermédiaire', isProvisional: true, reliability: 40 });
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Niveau');
    fireEvent.click(await screen.findByRole('button', { name: /Affiner mon niveau/ }));
    // Le curseur vaut 4 par défaut (DEFAULT dans LevelCalibration).
    fireEvent.click(await screen.findByRole('button', { name: 'Valider mon niveau' }));
    await waitFor(() => expect(api.calibrateRating).toHaveBeenCalledWith(4, 'abc', 'padel'));
  });
});

describe('Page Mon profil — licence (seconde ressource)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState(null, '', '/me/profile');
    document.cookie = 'token=abc; path=/';
    onClub();
    api.getMyProfile.mockResolvedValue(profile);
    api.getMyClubs.mockResolvedValue([]);
    api.getMyClubMembership.mockResolvedValue({ membershipNo: 'LIC42', status: 'ACTIVE', isSubscriber: true, since: '2024-03-01T00:00:00.000Z' });
    api.getMyClubPackages.mockResolvedValue([]);
    api.getMyClubSubscriptions.mockResolvedValue([]);
    api.getMyPayments.mockResolvedValue([]);
    api.getMyPaymentMethod.mockResolvedValue(null);
    api.getMyClubMatchStats.mockResolvedValue({ wins: 0, losses: 0, streak: 0 });
    api.getSports.mockResolvedValue([]);
    api.updateMyProfile.mockResolvedValue(profile);
    api.updateMyClubMembership.mockResolvedValue({ membershipNo: 'LIC99', status: 'ACTIVE', isSubscriber: true });
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('la licence passe par la barre, pas par un bouton propre', async () => {
    wrap();
    const input = await screen.findByLabelText('N° de licence / adhérent');
    expect(input).toHaveValue('LIC42');
    fireEvent.change(input, { target: { value: 'LIC99' } });
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyClubMembership).toHaveBeenCalledWith('demo', 'LIC99', 'abc'));
    // Profil non touché → pas de PATCH profil inutile.
    expect(api.updateMyProfile).not.toHaveBeenCalled();
  });

  it('profil ET licence dirty : les deux ressources partent sur un seul Enregistrer', async () => {
    wrap();
    fireEvent.change(await screen.findByLabelText('Téléphone'), { target: { value: '0700000000' } });
    fireEvent.change(screen.getByLabelText('N° de licence / adhérent'), { target: { value: 'LIC99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalled());
    expect(api.updateMyClubMembership).toHaveBeenCalledWith('demo', 'LIC99', 'abc');
  });

  it('échec partiel : le profil se rebaseline même si la licence échoue', async () => {
    api.updateMyClubMembership.mockRejectedValue(new Error('Licence refusée'));
    wrap();
    fireEvent.change(await screen.findByLabelText('Téléphone'), { target: { value: '0700000000' } });
    fireEvent.change(screen.getByLabelText('N° de licence / adhérent'), { target: { value: 'LIC99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Licence refusée');
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalled());
    expect(screen.queryByText('Enregistré ✓')).not.toBeInTheDocument();
  });

  it('Annuler restaure aussi la licence', async () => {
    wrap();
    const input = await screen.findByLabelText('N° de licence / adhérent');
    fireEvent.change(input, { target: { value: 'LIC99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(input).toHaveValue('LIC42');
    expect(api.updateMyClubMembership).not.toHaveBeenCalled();
  });

  it('le hero porte les chips du membre (abonné, année d’adhésion)', async () => {
    api.getMyClubMembership.mockResolvedValue({
      membershipNo: 'LIC42', status: 'ACTIVE', isSubscriber: true, since: '2024-03-01T00:00:00.000Z',
    });
    wrap();
    expect(await screen.findByText('Membre depuis 2024')).toBeInTheDocument();
    expect(screen.getByText(/Abonné/)).toBeInTheDocument();
    expect(screen.getByText('Club Démo')).toBeInTheDocument(); // kicker = nom du club
  });

  it('le hero porte le badge de niveau du joueur', async () => {
    api.getMyRating.mockResolvedValue({ calibrated: true, level: 6.2, tier: 'Confirmé', isProvisional: false, reliability: 90 });
    wrap();
    expect(await screen.findByLabelText('Niveau 6.2')).toBeInTheDocument();
  });
});
