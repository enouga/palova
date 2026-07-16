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
    const editing = {
      id: 'e1', title: 'Ancien titre', body: 'Ancien corps', linkUrl: null, imageUrl: null,
      kind: 'TOURNAMENT' as const, validUntil: null, isPublished: true, pinned: true, sortOrder: 0,
      createdAt: '', updatedAt: '',
    };
    render(<AnnouncementStudio {...base} editing={editing} />);
    expect(screen.getByDisplayValue('Ancien titre')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateAnnouncement).toHaveBeenCalledWith(
      'club-1', 'e1', expect.objectContaining({ title: 'Ancien titre', pinned: true }), 'tok',
    ));
  });
});
