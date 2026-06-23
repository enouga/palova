import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SettingsPage from '@/app/me/notifications/settings/page';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  text: '#000', textMute: '#666', textFaint: '#999', surface: '#fff', surface2: '#f3f3f3',
  line: '#ddd', accent: '#d6ff3f', onAccent: '#000', fontUI: 'sans-serif',
} }) }));
jest.mock('@/lib/api', () => ({
  api: {
    getNotificationPreferences: jest.fn().mockResolvedValue({ preferences: [] }),
    getMyClubs: jest.fn().mockResolvedValue([]),
    updateNotificationPreferences: jest.fn().mockResolvedValue({ ok: true }),
  },
}));
jest.mock('@/lib/usePush', () => ({ usePush: () => ({ status: 'unsupported', subscribe: jest.fn(), unsubscribe: jest.fn() }) }));

describe('NotificationSettings', () => {
  it('affiche la grille et verrouille CLUB_MESSAGES+Cloche', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText('Messages du club')).toBeInTheDocument());
    const locked = screen.getByLabelText('Messages du club – Cloche') as HTMLInputElement;
    expect(locked.checked).toBe(true);
    expect(locked.disabled).toBe(true);
  });

  it('enregistre les préférences', async () => {
    const { api } = require('@/lib/api');
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Mes parties'));
    fireEvent.click(screen.getByLabelText('Mes parties – Email'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(api.updateNotificationPreferences).toHaveBeenCalled());
  });
});
