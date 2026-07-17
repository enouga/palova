import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminAnnouncementsPage from '@/app/admin/announcements/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Padel Arena' } }) }));
// Le studio a sa propre suite (AnnouncementStudio.test.tsx) — ici on teste la page.
jest.mock('@/components/admin/AnnouncementStudio', () => ({
  AnnouncementStudio: ({ editing, onClose }: { editing: { id: string } | null; onClose: () => void }) => (
    <div data-testid="studio">
      <span>{editing ? `edition:${editing.id}` : 'creation'}</span>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminGetAnnouncements: jest.fn(),
    adminReorderAnnouncements: jest.fn(),
    adminDeleteAnnouncement: jest.fn(),
  },
}));
import { api } from '@/lib/api';
const mocked = api as jest.Mocked<typeof api>;

const ann = (over: Partial<Record<string, unknown>>) => ({
  id: 'a1', title: 'Un', body: 'x', linkUrl: null, imageUrl: null, kind: 'INFO',
  validUntil: null, isPublished: true, pinned: false, sortOrder: 0, createdAt: '2026-01-01', updatedAt: '',
  ...over,
});

const wrap = () => render(<ThemeProvider><AdminAnnouncementsPage /></ThemeProvider>);

describe('/admin/announcements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.adminReorderAnnouncements.mockResolvedValue([] as never);
    mocked.adminDeleteAnnouncement.mockResolvedValue({ ok: true } as never);
    mocked.adminGetAnnouncements.mockResolvedValue([
      ann({ id: 'a1', title: 'Un', pinned: true, kind: 'TOURNAMENT' }),
      ann({ id: 'a2', title: 'Deux', sortOrder: 1, isPublished: false }),
    ] as never);
  });

  it('affiche la liste avec type, badge « À la une » et statut brouillon', async () => {
    wrap();
    expect(await screen.findByText('Un')).toBeInTheDocument();
    expect(screen.getByText('Deux')).toBeInTheDocument();
    expect(screen.getByText('À la une', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Brouillon', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Tournoi', { selector: 'span' })).toBeInTheDocument();
  });

  it('« Nouvelle annonce » ouvre le studio en création', async () => {
    wrap();
    await screen.findByText('Un');
    expect(screen.queryByTestId('studio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Nouvelle annonce/i }));
    expect(screen.getByTestId('studio')).toHaveTextContent('creation');
  });

  it('« Modifier » ouvre le studio en édition sur la bonne annonce', async () => {
    wrap();
    await screen.findByText('Un');
    fireEvent.click(screen.getAllByRole('button', { name: 'Modifier' })[1]);
    expect(screen.getByTestId('studio')).toHaveTextContent('edition:a2');
  });

  it('flèche ↓ sur la 1re ligne → adminReorderAnnouncements dans le nouvel ordre', async () => {
    wrap();
    await screen.findByText('Un');
    fireEvent.click(screen.getByRole('button', { name: 'Descendre Un' }));
    await waitFor(() => expect(mocked.adminReorderAnnouncements).toHaveBeenCalledWith('c1', ['a2', 'a1'], 't'));
  });

  it('flèches bornées : ↑ désactivée en tête, ↓ désactivée en fin', async () => {
    wrap();
    await screen.findByText('Un');
    expect(screen.getByRole('button', { name: 'Monter Un' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descendre Deux' })).toBeDisabled();
  });

  it('glisser-déposer : déposer la 1re sur la 2e réordonne', async () => {
    wrap();
    await screen.findByText('Un');
    const handles = screen.getAllByTitle('Glisser pour réordonner');
    fireEvent.dragStart(handles[0]);
    fireEvent.drop(screen.getByTestId('ann-row-a2'));
    await waitFor(() => expect(mocked.adminReorderAnnouncements).toHaveBeenCalledWith('c1', ['a2', 'a1'], 't'));
  });

  it('« Supprimer » appelle l’API puis recharge', async () => {
    wrap();
    await screen.findByText('Un');
    fireEvent.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]);
    await waitFor(() => expect(mocked.adminDeleteAnnouncement).toHaveBeenCalledWith('c1', 'a1', 't'));
    await waitFor(() => expect(mocked.adminGetAnnouncements).toHaveBeenCalledTimes(2));
  });

  it('aucune annonce → état vide', async () => {
    mocked.adminGetAnnouncements.mockResolvedValue([] as never);
    wrap();
    expect(await screen.findByText(/Aucune annonce pour l'instant/)).toBeInTheDocument();
  });
});
