import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SettingsPage from '@/app/me/notifications/settings/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }), logout: jest.fn() }));
// Hôte plateforme (slug null) → branche en-tête BackButton/ThemeToggle/ProfileMenu,
// pas de montage de la vraie ClubNav (qui exigerait le mock de ses appels API + SSE).
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null }) }));
jest.mock('@/lib/api', () => ({
  api: {
    getNotificationPreferences: jest.fn().mockResolvedValue({ preferences: [] }),
    getMyClubs: jest.fn().mockResolvedValue([]),
    updateNotificationPreferences: jest.fn().mockResolvedValue({ ok: true }),
    getMyProfile: jest.fn().mockResolvedValue({ id: 'u1', firstName: 'Test', lastName: 'User', email: 't@x.fr', avatarUrl: null }),
    getMyMemberships: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));
jest.mock('@/lib/usePush', () => ({ usePush: () => ({ status: 'unsupported', subscribe: jest.fn(), unsubscribe: jest.fn() }) }));

const mount = () => render(<ThemeProvider><SettingsPage /></ThemeProvider>);

describe('NotificationSettings', () => {
  it('affiche le shell standard (en-tête plateforme) et la grille, verrouille CLUB_MESSAGES+Cloche', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Messages du club')).toBeInTheDocument());
    // Shell : la page porte désormais l'en-tête standard (branche plateforme).
    expect(screen.getByLabelText('Retour')).toBeInTheDocument();
    expect(screen.getByLabelText('Changer de thème')).toBeInTheDocument();
    const locked = screen.getByLabelText('Messages du club – Cloche') as HTMLInputElement;
    expect(locked.checked).toBe(true);
    expect(locked.disabled).toBe(true);
  });

  it('enregistre les préférences', async () => {
    const { api } = require('@/lib/api');
    mount();
    await waitFor(() => screen.getByText('Mes parties'));
    fireEvent.click(screen.getByLabelText('Mes parties – Email'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(api.updateNotificationPreferences).toHaveBeenCalled());
  });
});
