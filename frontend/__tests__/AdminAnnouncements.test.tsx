import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminAnnouncementsPage from '@/app/admin/announcements/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Padel Arena' } }) }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminGetAnnouncements: jest.fn().mockResolvedValue([]),
    adminCreateAnnouncement: jest.fn().mockResolvedValue({ id: 'a-new' }),
    adminUpdateAnnouncement: jest.fn(),
    adminDeleteAnnouncement: jest.fn(),
    adminUploadAnnouncementImage: jest.fn().mockResolvedValue({ id: 'a-new' }),
  },
}));
import { api } from '@/lib/api';
const mocked = api as jest.Mocked<typeof api>;

const wrap = () => render(<ThemeProvider><AdminAnnouncementsPage /></ThemeProvider>);

beforeAll(() => { window.scrollTo = jest.fn(); });

describe('/admin/announcements — annonces enrichies', () => {
  beforeEach(() => jest.clearAllMocks());

  it('publie une annonce avec type + date de fin, puis uploade l affiche', async () => {
    mocked.adminGetAnnouncements.mockResolvedValue([] as never);
    wrap();
    await waitFor(() => expect(mocked.adminGetAnnouncements).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText("Titre de l'annonce"), { target: { value: 'Open P250' } });
    fireEvent.change(screen.getByPlaceholderText("Détail de l'annonce…"), { target: { value: 'Affiche' } });
    fireEvent.change(screen.getByLabelText(/^Type$/i), { target: { value: 'TOURNAMENT' } });
    fireEvent.change(screen.getByLabelText(/Afficher jusqu'au/i), { target: { value: '2026-09-15' } });

    const file = new File(['x'], 'affiche.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(/Affiche \(image\)/i), { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: /Publier/i }));

    await waitFor(() => expect(mocked.adminCreateAnnouncement).toHaveBeenCalledWith(
      'c1', expect.objectContaining({ kind: 'TOURNAMENT', validUntil: '2026-09-15' }), 't',
    ));
    await waitFor(() => expect(mocked.adminUploadAnnouncementImage).toHaveBeenCalledWith('c1', 'a-new', file, 't'));
  });

  it('liste : chaque annonce expose ses actions Modifier/Supprimer + statut + type/date', async () => {
    mocked.adminGetAnnouncements.mockResolvedValue([
      { id: 'a1', title: 'Épinglée avec un très long titre qui déborde largement', body: 'Un corps de texte lui aussi très long pour vérifier que rien ne pousse les actions hors de la ligne.', linkUrl: null, imageUrl: '/uploads/announcements/a.jpg', kind: 'INFO', validUntil: null, isPublished: true, pinned: true, createdAt: '2026-07-05', updatedAt: '' },
      { id: 'a2', title: 'Brouillon', body: '', linkUrl: null, imageUrl: null, kind: 'EVENT', validUntil: null, isPublished: false, pinned: false, createdAt: '2026-06-30', updatedAt: '' },
    ] as never);
    wrap();
    await screen.findByText('Brouillon', { selector: 'span' });
    // Une paire d'actions PAR annonce (l'ancienne table les cachait derrière un scroll horizontal).
    expect(screen.getAllByRole('button', { name: 'Modifier' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Supprimer' })).toHaveLength(2);
    expect(screen.getByText('Épinglée', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/créée le 05\/07\/2026/)).toBeInTheDocument();
  });

  it('liste : type + pastille affiche si imageUrl', async () => {
    mocked.adminGetAnnouncements.mockResolvedValue([
      { id: 'a1', title: 'Avec affiche', body: '', linkUrl: null, imageUrl: '/uploads/announcements/a.jpg', kind: 'OFFER', validUntil: null, isPublished: true, pinned: false, createdAt: '2026-07-01', updatedAt: '' },
    ] as never);
    wrap();
    expect(await screen.findByText('Avec affiche')).toBeInTheDocument();
    // « Offre » apparaît dans le select du formulaire ET dans la colonne Type du tableau.
    expect(screen.getAllByText('Offre').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Affiche')).toBeInTheDocument();
  });

  it("champ affiche : boutons Ajouter → Changer/Retirer selon l'état", async () => {
    mocked.adminGetAnnouncements.mockResolvedValue([] as never);
    wrap();
    await waitFor(() => expect(mocked.adminGetAnnouncements).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: 'Ajouter une image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Retirer l'image" })).not.toBeInTheDocument();

    const file = new File(['x'], 'affiche.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(/Affiche \(image\)/i), { target: { files: [file] } });

    expect(screen.getByRole('button', { name: "Changer l'image" })).toBeInTheDocument();
    expect(screen.getByText('affiche.jpg')).toBeInTheDocument(); // repli sans createObjectURL (jsdom)

    fireEvent.click(screen.getByRole('button', { name: "Retirer l'image" }));
    expect(screen.getByRole('button', { name: 'Ajouter une image' })).toBeInTheDocument();
    expect(screen.queryByText('affiche.jpg')).not.toBeInTheDocument();
  });

  it("modifier : « Retirer l'image » envoie imageUrl null", async () => {
    mocked.adminGetAnnouncements.mockResolvedValue([
      { id: 'a1', title: 'Avec affiche', body: 'corps', linkUrl: null, imageUrl: '/uploads/announcements/a.jpg', kind: 'INFO', validUntil: null, isPublished: true, pinned: false, createdAt: '2026-07-01', updatedAt: '' },
    ] as never);
    mocked.adminUpdateAnnouncement.mockResolvedValue({ id: 'a1' } as never);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    fireEvent.click(screen.getByRole('button', { name: "Retirer l'image" }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateAnnouncement).toHaveBeenCalledWith(
      'c1', 'a1', expect.objectContaining({ imageUrl: null }), 't',
    ));
    expect(mocked.adminUploadAnnouncementImage).not.toHaveBeenCalled();
  });

  it('modifier : vider le champ Lien envoie linkUrl null (et non omis)', async () => {
    mocked.adminGetAnnouncements.mockResolvedValue([
      { id: 'a1', title: 'Avec lien', body: 'corps', linkUrl: 'https://club.fr/x', imageUrl: null, kind: 'INFO', validUntil: null, isPublished: true, pinned: false, createdAt: '2026-07-01', updatedAt: '' },
    ] as never);
    mocked.adminUpdateAnnouncement.mockResolvedValue({ id: 'a1' } as never);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    expect(screen.getByPlaceholderText('https://…')).toHaveValue('https://club.fr/x');
    fireEvent.change(screen.getByPlaceholderText('https://…'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateAnnouncement).toHaveBeenCalledWith(
      'c1', 'a1', expect.objectContaining({ linkUrl: null }), 't',
    ));
  });

  it('Publier sans contenu → message clair, aucun appel de création', async () => {
    mocked.adminGetAnnouncements.mockResolvedValue([] as never);
    wrap();
    await waitFor(() => expect(mocked.adminGetAnnouncements).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText("Titre de l'annonce"), { target: { value: 'Titre seul' } });
    fireEvent.click(screen.getByRole('button', { name: /Publier/i }));

    expect(await screen.findByText(/titre et le contenu sont obligatoires/i)).toBeInTheDocument();
    expect(mocked.adminCreateAnnouncement).not.toHaveBeenCalled();
  });

  it("création : échec de l'upload d'affiche → le retry met à jour (pas de doublon)", async () => {
    mocked.adminGetAnnouncements.mockResolvedValue([] as never);
    mocked.adminCreateAnnouncement.mockResolvedValue({ id: 'a-new' } as never);
    mocked.adminUpdateAnnouncement.mockResolvedValue({ id: 'a-new' } as never);
    mocked.adminUploadAnnouncementImage.mockResolvedValue({ id: 'a-new' } as never);
    mocked.adminUploadAnnouncementImage.mockRejectedValueOnce(new Error('réseau') as never);
    wrap();
    await waitFor(() => expect(mocked.adminGetAnnouncements).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText("Titre de l'annonce"), { target: { value: 'Open' } });
    fireEvent.change(screen.getByPlaceholderText("Détail de l'annonce…"), { target: { value: 'Corps' } });
    const file = new File(['x'], 'affiche.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(/Affiche \(image\)/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /Publier/i }));

    expect(await screen.findByText(/l'envoi de l'image a échoué/i)).toBeInTheDocument();

    // Le formulaire est passé en mode édition : le retry est un update, pas un 2e create.
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateAnnouncement).toHaveBeenCalledWith('c1', 'a-new', expect.anything(), 't'));
    expect(mocked.adminCreateAnnouncement).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocked.adminUploadAnnouncementImage).toHaveBeenLastCalledWith('c1', 'a-new', file, 't'));
  });
});
