import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    updateMyProfile: jest.fn(),
    updateMyClubMembership: jest.fn(),
    uploadMyAvatar: jest.fn(),
    getMyRating: jest.fn().mockResolvedValue(null),
    getRatingHistory: jest.fn().mockResolvedValue([]),
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
    api.updateMyProfile.mockResolvedValue(profile);
    api.uploadMyAvatar.mockResolvedValue({ ...profile, avatarUrl: '/uploads/avatars/u1-2.png' });
    api.changePassword.mockResolvedValue({ ok: true });
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
    expect(screen.queryByText('Mon niveau padel')).not.toBeInTheDocument();
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
    const select = await screen.findByLabelText(/sport préféré/i);
    fireEvent.change(select, { target: { value: 'sport-tennis' } });
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ preferredSportId: 'sport-tennis' }), expect.any(String),
    ));
  });
});
