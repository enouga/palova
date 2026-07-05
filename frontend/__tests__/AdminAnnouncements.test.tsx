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

  it('tableau : colonne Type + pastille affiche si imageUrl', async () => {
    mocked.adminGetAnnouncements.mockResolvedValue([
      { id: 'a1', title: 'Avec affiche', body: '', linkUrl: null, imageUrl: '/uploads/announcements/a.jpg', kind: 'OFFER', validUntil: null, isPublished: true, pinned: false, createdAt: '2026-07-01', updatedAt: '' },
    ] as never);
    wrap();
    expect(await screen.findByText('Avec affiche')).toBeInTheDocument();
    // « Offre » apparaît dans le select du formulaire ET dans la colonne Type du tableau.
    expect(screen.getAllByText('Offre').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Affiche')).toBeInTheDocument();
  });
});
