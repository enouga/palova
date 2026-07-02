import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MyProfilePage from '../app/me/profile/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// Contexte club contrôlable : slug null = hôte plateforme, sinon hôte club.
let clubCtx: { slug: string | null; club: { id: string; slug: string; name: string; levelSystemEnabled?: boolean } | null; loading: boolean } =
  { slug: null, club: null, loading: false };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubCtx }));

jest.mock('../components/ClubNav', () => ({ ClubNav: () => <nav /> }));

jest.mock('../lib/api', () => ({
  api: {
    getMyProfile: jest.fn(),
    getMyClubs: jest.fn(),
    getMyClubMembership: jest.fn(),
    getMyClubPackages: jest.fn(),
    getMyClubSubscriptions: jest.fn(),
    getMyPayments: jest.fn(),
    getMyPaymentMethod: jest.fn(),
    removeMyPaymentMethod: jest.fn(),
    getAccountDeletionSummary: jest.fn(),
    deleteMyAccount: jest.fn(),
    updateMyProfile: jest.fn(),
    updateMyClubMembership: jest.fn(),
    uploadMyAvatar: jest.fn(),
    getMyRating: jest.fn().mockResolvedValue(null),
    getRatingHistory: jest.fn().mockResolvedValue([]),
    getMyClubMatchStats: jest.fn(),
    calibrateRating: jest.fn(),
    changePassword: jest.fn(),
    getSports: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (p: string | null) => (p ? `http://localhost:3001${p}` : null),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const profile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede', phone: '0609032635', sex: 'MALE',
  birthDate: '1973-07-08T00:00:00.000Z', avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false,
};

const wrap = () => render(<ThemeProvider><MyProfilePage /></ThemeProvider>);

describe('Page Mon profil', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
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

  it('affiche identité, email non modifiable et valeurs des champs', async () => {
    wrap();
    expect(await screen.findByText('Eric')).toBeInTheDocument();
    expect(screen.getByText('Nougayrede')).toBeInTheDocument();
    expect(screen.getByText('eric@palova.fr')).toBeInTheDocument();
    expect(screen.getByText('L’email ne peut pas être modifié.')).toBeInTheDocument();
    expect(screen.getByLabelText('Téléphone')).toHaveValue('0609032635');
    expect(screen.getByLabelText('Date de naissance')).toHaveTextContent('08/07/1973');
  });

  it('affiche les stats de résultat du club sous le niveau', async () => {
    clubCtx = { slug: 'arena', club: { id: 'c1', slug: 'arena', name: 'Padel Arena', levelSystemEnabled: true }, loading: false };
    api.getMyRating.mockResolvedValue({ level: 5.2, tier: 'Confirmé', isProvisional: false, reliability: 0.85, calibrated: true, matchesPlayed: 25 });
    api.getMyClubMatchStats.mockResolvedValue({ wins: 18, losses: 7, streak: 3 });
    wrap();
    expect(await screen.findByText(/Résultats · Padel Arena/i)).toBeInTheDocument();
    expect(screen.getByText(/25 matchs/i)).toBeInTheDocument();
    expect(screen.getByText(/72\s*% de victoires/i)).toBeInTheDocument();
    expect(screen.getByText(/3 victoires d'affilée/i)).toBeInTheDocument();
  });

  it("pas de stats de résultat sur l'hôte plateforme (slug null)", async () => {
    // clubCtx reste { slug: null } (défaut du beforeEach)
    api.getMyRating.mockResolvedValue({ level: 5.2, tier: 'Confirmé', isProvisional: false, reliability: 0.85, calibrated: true, matchesPlayed: 25 });
    api.getMyClubMatchStats.mockResolvedValue({ wins: 18, losses: 7, streak: 3 });
    wrap();
    await screen.findByText('Eric');
    expect(screen.queryByText(/Résultats ·/i)).toBeNull();
    expect(api.getMyClubMatchStats).not.toHaveBeenCalled();
  });

  it('Enregistrer envoie téléphone, sexe et date de naissance', async () => {
    wrap();
    await screen.findByLabelText('Téléphone');
    fireEvent.change(screen.getByLabelText('Téléphone'), { target: { value: '0699999999' } });
    // Calendrier maison : ouvrir le popup (mois de la valeur = juillet 1973) puis cliquer un jour.
    fireEvent.click(screen.getByLabelText('Date de naissance'));
    fireEvent.click(screen.getByLabelText('15/07/1973'));
    fireEvent.click(screen.getByText('Femme'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      { phone: '0699999999', sex: 'FEMALE', birthDate: '1973-07-15' }, 'abc',
    ));
    expect(await screen.findByText('Enregistré ✓')).toBeInTheDocument();
  });

  it("la sélection d'un fichier déclenche l'upload d'avatar", async () => {
    global.URL.createObjectURL = jest.fn(() => 'blob:preview');
    wrap();
    const input = await screen.findByLabelText('Choisir une photo de profil');
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.uploadMyAvatar).toHaveBeenCalledWith(file, 'abc'));
  });

  it('refuse un format de fichier non supporté sans appeler l\'API', async () => {
    wrap();
    const input = await screen.findByLabelText('Choisir une photo de profil');
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('Format d’image non supporté (JPEG, PNG ou WebP)')).toBeInTheDocument();
    expect(api.uploadMyAvatar).not.toHaveBeenCalled();
  });

  it('changer la langue appelle updateMyProfile({ locale })', async () => {
    wrap();
    const select = await screen.findByLabelText('Langue');
    fireEvent.change(select, { target: { value: 'en' } });
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith({ locale: 'en' }, 'abc'));
  });

  it('activer « parties à mon niveau » appelle updateMyProfile({ autoMatchProposals: true })', async () => {
    api.updateMyProfile.mockResolvedValue({ ...profile, autoMatchProposals: true });
    wrap();
    const group = await screen.findByRole('group', { name: /parties à mon niveau/i });
    fireEvent.click(within(group).getByText('Oui'));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith({ autoMatchProposals: true }, 'abc'));
    // l'état retourné est reflété : « Oui » devient l'option active (fontWeight 700)
    await waitFor(() => expect(within(group).getByText('Oui')).toHaveStyle({ fontWeight: 700 }));
  });

  it('le sélecteur de thème bascule en sombre (localStorage)', async () => {
    wrap();
    await screen.findByText('Thème');
    fireEvent.click(screen.getByText('Sombre'));
    expect(localStorage.getItem('palova-theme')).toBe('floodlit');
  });

  it('hôte club + membre : la section licence enregistre via updateMyClubMembership', async () => {
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo' }, loading: false };
    api.getMyClubMembership.mockResolvedValue({ membershipNo: 'LIC42', status: 'ACTIVE', isSubscriber: true });
    api.updateMyClubMembership.mockResolvedValue({ membershipNo: 'LIC99', status: 'ACTIVE', isSubscriber: true });
    wrap();
    const input = await screen.findByLabelText('N° de licence / adhérent');
    expect(input).toHaveValue('LIC42');
    fireEvent.change(input, { target: { value: 'LIC99' } });
    fireEvent.click(screen.getAllByText('Enregistrer')[1]);
    await waitFor(() => expect(api.updateMyClubMembership).toHaveBeenCalledWith('demo', 'LIC99', 'abc'));
  });

  it('hôte plateforme : pas de section licence', async () => {
    wrap();
    await screen.findByText('Eric');
    expect(screen.queryByLabelText('N° de licence / adhérent')).not.toBeInTheDocument();
  });

  it('club OFF : pas de section niveau', async () => {
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo', levelSystemEnabled: false }, loading: false };
    wrap();
    await screen.findByText('Eric');
    expect(screen.queryByRole('region', { name: /mon niveau/i })).not.toBeInTheDocument();
  });

  it('changer le mot de passe appelle api.changePassword puis affiche le succès', async () => {
    wrap();
    fireEvent.change(await screen.findByLabelText('Mot de passe actuel'), { target: { value: 'oldpass123' } });
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'newpass456' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'newpass456' } });
    fireEvent.click(screen.getByText('Modifier le mot de passe'));
    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith('oldpass123', 'newpass456', 'abc'));
    expect(await screen.findByText('Modifié ✓')).toBeInTheDocument();
  });

  it('refuse si la confirmation ne correspond pas, sans appeler l\'API', async () => {
    wrap();
    fireEvent.change(await screen.findByLabelText('Mot de passe actuel'), { target: { value: 'oldpass123' } });
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'newpass456' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'different' } });
    fireEvent.click(screen.getByText('Modifier le mot de passe'));
    expect(await screen.findByText('Les mots de passe ne correspondent pas.')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('refuse un nouveau mot de passe trop court, sans appeler l\'API', async () => {
    wrap();
    fireEvent.change(await screen.findByLabelText('Mot de passe actuel'), { target: { value: 'oldpass123' } });
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'court' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'court' } });
    fireEvent.click(screen.getByText('Modifier le mot de passe'));
    expect(await screen.findByText('Le mot de passe doit faire au moins 8 caractères.')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('enregistre le sport préféré', async () => {
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
      { id: 'sport-tennis', key: 'tennis', name: 'Tennis', icon: '🎾', published: true },
    ]);
    api.getMyProfile.mockResolvedValue({ ...profile, preferredSport: null });
    api.updateMyProfile.mockResolvedValue({ ...profile, preferredSport: { id: 'sport-tennis', key: 'tennis', name: 'Tennis' } });
    wrap();
    const group = await screen.findByRole('group', { name: /sport préféré/i });
    fireEvent.click(within(group).getByText('Tennis'));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ preferredSportId: 'sport-tennis' }), expect.any(String),
    ));
  });

  it('« Sport préféré » est une région dédiée, hors de Préférences', async () => {
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
    ]);
    wrap();
    const sportRegion = await screen.findByRole('region', { name: 'Sport préféré' });
    expect(sportRegion).toBeInTheDocument();
    // Le pill 'Aucun' du sport préféré est bien DANS la région dédiée…
    expect(within(sportRegion).getByText('Aucun')).toBeInTheDocument();
    // …et PAS dans la région Préférences.
    const prefRegion = screen.getByRole('region', { name: 'Préférences' });
    expect(within(prefRegion).queryByText('Sport préféré')).not.toBeInTheDocument();
  });

  it('niveau : padel uniquement, sans sélecteur de sport, découplé du sport préféré', async () => {
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
      { id: 'sport-tennis', key: 'tennis', name: 'Tennis', icon: '🎾', published: true },
    ]);
    api.getMyRating.mockResolvedValue({ level: 5.2, calibrated: true, gamesPlayed: 10, tier: 'CONFIRMED', sport: 'padel' });
    api.getMyProfile.mockResolvedValue({ ...profile, preferredSport: { id: 'sport-tennis', key: 'tennis', name: 'Tennis' } });
    wrap();
    const region = await screen.findByRole('region', { name: /mon niveau/i });
    expect(region).toHaveTextContent(/Padel/);
    expect(screen.queryByRole('group', { name: /sport du niveau/i })).not.toBeInTheDocument();
    // Le rating chargé est celui du padel, jamais du sport préféré (tennis).
    await waitFor(() => expect(api.getMyRating).toHaveBeenCalledWith(expect.any(String), 'padel'));
    expect(api.getMyRating).not.toHaveBeenCalledWith(expect.any(String), 'tennis');
    expect(api.getRatingHistory).not.toHaveBeenCalledWith(expect.any(String), 'tennis');
  });

  it('niveau : sans niveau → état neutre, pas d\'auto-éval forcée ; « Affiner » révèle le calibrage (padel)', async () => {
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
    ]);
    // backend renvoie un état neutre (plus jamais null) quand le joueur n'a pas de niveau
    api.getMyRating.mockResolvedValue({ calibrated: false, level: null, tier: '', isProvisional: true, reliability: 50, matchesPlayed: 0 });
    api.calibrateRating.mockResolvedValue({ level: 4.0, calibrated: true, tier: 'Intermédiaire', isProvisional: true, reliability: 50, matchesPlayed: 0 });
    wrap();
    const region = await screen.findByRole('region', { name: /mon niveau/i });
    // pas d'auto-évaluation mise en avant : aucun bouton « Passer » d'emblée
    expect(within(region).queryByRole('button', { name: /passer|skip/i })).not.toBeInTheDocument();
    // l'affinage est optionnel : on l'ouvre explicitement
    fireEvent.click(within(region).getByRole('button', { name: /affiner/i }));
    fireEvent.click(await within(region).findByRole('button', { name: /passer|skip/i }));
    await waitFor(() => expect(api.calibrateRating).toHaveBeenCalledWith(null, expect.any(String), 'padel'));
  });

  it('affiche le menu de navigation listant les régions rendues', async () => {
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
    ]);
    wrap();
    const nav = await screen.findByRole('navigation', { name: /sections du profil/i });
    expect(within(nav).getByText('Identité')).toBeInTheDocument();
    expect(within(nav).getByText('Sport')).toBeInTheDocument();
    expect(within(nav).getByText('Infos')).toBeInTheDocument();
    expect(within(nav).getByText('Préf.')).toBeInTheDocument();
    expect(within(nav).getByText('Sécu.')).toBeInTheDocument();
    expect(within(nav).getByText('Niveau')).toBeInTheDocument();
  });

  it('le menu omet « Niveau » quand le club a désactivé les niveaux', async () => {
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo', levelSystemEnabled: false }, loading: false };
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
    ]);
    wrap();
    const nav = await screen.findByRole('navigation', { name: /sections du profil/i });
    expect(within(nav).queryByText('Niveau')).not.toBeInTheDocument();
  });
});
