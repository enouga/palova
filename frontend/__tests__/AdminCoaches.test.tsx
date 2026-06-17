import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminCoachesPage from '@/app/admin/coaches/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-demo', accentColor: '#d6ff3f' } }) }));
jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    adminListCoaches: jest.fn().mockResolvedValue([{ id: 'c1', name: 'Paul', bio: null, photoUrl: null, isActive: true, sortOrder: 0 }]),
    adminCreateCoach: jest.fn().mockResolvedValue({ id: 'c2', name: 'Marie' }),
    adminUpdateCoach: jest.fn(),
    adminDeleteCoach: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

function renderPage() {
  return render(
    <ThemeProvider>
      <AdminCoachesPage />
    </ThemeProvider>,
  );
}

describe('AdminCoachesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { api } = require('@/lib/api');
    api.adminListCoaches.mockResolvedValue([{ id: 'c1', name: 'Paul', bio: null, photoUrl: null, isActive: true, sortOrder: 0 }]);
    api.adminCreateCoach.mockResolvedValue({ id: 'c2', name: 'Marie' });
    api.adminDeleteCoach.mockResolvedValue({ ok: true });
  });

  it('affiche les coachs chargés', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Paul')).toBeInTheDocument());
  });

  it('crée un coach via le formulaire', async () => {
    const { api } = require('@/lib/api');
    renderPage();
    await waitFor(() => screen.getByText('Paul'));
    fireEvent.change(screen.getByPlaceholderText(/nom du coach/i), { target: { value: 'Marie' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter le coach/i }));
    await waitFor(() => expect(api.adminCreateCoach).toHaveBeenCalledWith('club-demo', expect.objectContaining({ name: 'Marie' }), 't'));
  });
});
