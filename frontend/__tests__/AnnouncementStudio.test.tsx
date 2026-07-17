import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnnouncementStudio } from '@/components/admin/AnnouncementStudio';
import { api } from '@/lib/api';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: new Proxy({}, { get: (_t, p) => (p === 'mode' ? 'daylight' : `--${String(p)}`) }) }),
}));
jest.mock('@/lib/api', () => ({
  assetUrl: (u: string | null) => u,
  api: {
    adminCreateAnnouncement: jest.fn(),
    adminUpdateAnnouncement: jest.fn(),
    adminUploadAnnouncementImage: jest.fn(),
  },
}));

const mocked = api as jest.Mocked<typeof api>;

const withImage = {
  id: 'e1', title: 'Avec affiche', body: 'corps', linkUrl: 'https://club.fr/x',
  imageUrl: '/uploads/announcements/a.jpg', kind: 'INFO' as const, validUntil: null,
  isPublished: true, pinned: false, sortOrder: 0, createdAt: '', updatedAt: '',
};

const fillNew = () => {
  fireEvent.change(screen.getByPlaceholderText("Titre de l'annonce"), { target: { value: 'Open' } });
  fireEvent.change(screen.getByPlaceholderText('Détail de l’annonce…'), { target: { value: 'Corps' } });
};
const pickFile = () => {
  const file = new File(['x'], 'affiche.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText(/Affiche \(image\)/i), { target: { files: [file] } });
  return file;
};

describe('AnnouncementStudio', () => {
  const base = { clubId: 'club-1', token: 'tok', onClose: jest.fn(), onSaved: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mocked.adminCreateAnnouncement.mockResolvedValue({ id: 'new1' } as never);
    mocked.adminUpdateAnnouncement.mockResolvedValue({ id: 'e1' } as never);
    mocked.adminUploadAnnouncementImage.mockResolvedValue({ id: 'new1' } as never);
  });

  it('création : titre + contenu → adminCreateAnnouncement puis onSaved', async () => {
    render(<AnnouncementStudio {...base} editing={null} />);
    fireEvent.change(screen.getByPlaceholderText("Titre de l'annonce"), { target: { value: 'Mon titre' } });
    fireEvent.change(screen.getByPlaceholderText('Détail de l’annonce…'), { target: { value: 'Mon contenu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publier' }));
    await waitFor(() => expect(mocked.adminCreateAnnouncement).toHaveBeenCalledWith(
      'club-1', expect.objectContaining({ title: 'Mon titre', body: 'Mon contenu' }), 'tok',
    ));
    expect(base.onSaved).toHaveBeenCalled();
  });

  it('aperçu en direct : le titre saisi apparaît dans la zone d’aperçu', () => {
    render(<AnnouncementStudio {...base} editing={null} />);
    fireEvent.change(screen.getByPlaceholderText("Titre de l'annonce"), { target: { value: 'Tournoi P100' } });
    expect(screen.getByTestId('studio-preview')).toHaveTextContent('Tournoi P100');
  });

  it('validation : titre/contenu vides → message, pas d’appel', () => {
    render(<AnnouncementStudio {...base} editing={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publier' }));
    expect(screen.getByRole('alert')).toHaveTextContent('obligatoires');
    expect(mocked.adminCreateAnnouncement).not.toHaveBeenCalled();
  });

  it('édition : formulaire pré-rempli → adminUpdateAnnouncement', async () => {
    render(<AnnouncementStudio {...base} editing={{ ...withImage, title: 'Ancien titre', pinned: true }} />);
    expect(screen.getByDisplayValue('Ancien titre')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateAnnouncement).toHaveBeenCalledWith(
      'club-1', 'e1', expect.objectContaining({ title: 'Ancien titre', pinned: true }), 'tok',
    ));
  });

  it('création avec affiche : l’image est envoyée après la création (id obtenu)', async () => {
    render(<AnnouncementStudio {...base} editing={null} />);
    fillNew();
    const file = pickFile();
    fireEvent.click(screen.getByRole('button', { name: 'Publier' }));
    await waitFor(() => expect(mocked.adminUploadAnnouncementImage).toHaveBeenCalledWith('club-1', 'new1', file, 'tok'));
  });

  it("champ affiche : Ajouter → Changer/Retirer selon l'état (repli nom de fichier)", () => {
    render(<AnnouncementStudio {...base} editing={null} />);
    expect(screen.getByRole('button', { name: 'Ajouter une image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Retirer l'image" })).not.toBeInTheDocument();

    pickFile();
    expect(screen.getByRole('button', { name: "Changer l'image" })).toBeInTheDocument();
    expect(screen.getByText('affiche.jpg')).toBeInTheDocument(); // repli sans createObjectURL (jsdom)

    fireEvent.click(screen.getByRole('button', { name: "Retirer l'image" }));
    expect(screen.getByRole('button', { name: 'Ajouter une image' })).toBeInTheDocument();
    expect(screen.queryByText('affiche.jpg')).not.toBeInTheDocument();
  });

  it("édition : « Retirer l'image » envoie imageUrl null, sans upload", async () => {
    render(<AnnouncementStudio {...base} editing={withImage} />);
    fireEvent.click(screen.getByRole('button', { name: "Retirer l'image" }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateAnnouncement).toHaveBeenCalledWith(
      'club-1', 'e1', expect.objectContaining({ imageUrl: null }), 'tok',
    ));
    expect(mocked.adminUploadAnnouncementImage).not.toHaveBeenCalled();
  });

  it('édition : vider le champ Lien envoie linkUrl null (et non omis)', async () => {
    render(<AnnouncementStudio {...base} editing={withImage} />);
    expect(screen.getByPlaceholderText('https://…')).toHaveValue('https://club.fr/x');
    fireEvent.change(screen.getByPlaceholderText('https://…'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateAnnouncement).toHaveBeenCalledWith(
      'club-1', 'e1', expect.objectContaining({ linkUrl: null }), 'tok',
    ));
  });

  it("échec de l'upload d'affiche → le retry met à jour (jamais de doublon)", async () => {
    mocked.adminUpdateAnnouncement.mockResolvedValue({ id: 'new1' } as never); // l'update renvoie l'annonce créée
    mocked.adminUploadAnnouncementImage.mockRejectedValueOnce(new Error('réseau') as never);
    render(<AnnouncementStudio {...base} editing={null} />);
    fillNew();
    const file = pickFile();
    fireEvent.click(screen.getByRole('button', { name: 'Publier' }));

    expect(await screen.findByText(/l'envoi de l'image a échoué/i)).toBeInTheDocument();

    // Le studio a mémorisé l'id créé : le bouton bascule en « Enregistrer » et le retry met à jour.
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateAnnouncement).toHaveBeenCalledWith('club-1', 'new1', expect.anything(), 'tok'));
    expect(mocked.adminCreateAnnouncement).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocked.adminUploadAnnouncementImage).toHaveBeenLastCalledWith('club-1', 'new1', file, 'tok'));
  });
});
