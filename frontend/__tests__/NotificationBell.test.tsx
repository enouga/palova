import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NotificationBell } from '@/components/notifications/NotificationBell';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  text: '#000', textMute: '#666', textFaint: '#999', surface: '#fff', surface2: '#f3f3f3',
  surfaceHi: '#eee', line: '#ddd', accent: '#d6ff3f', onAccent: '#000', fontUI: 'sans-serif', shadowSoft: 'none',
} }) }));
jest.mock('@/lib/api', () => ({
  api: {
    getUnreadCount: jest.fn().mockResolvedValue({ count: 2 }),
    getNotifications: jest.fn().mockResolvedValue({ items: [
      { id: 'n1', title: 'Nouveau joueur', body: 'Marie a rejoint ta partie', url: '/parties',
        readAt: null, createdAt: new Date().toISOString(), category: 'MY_GAMES', type: 'x', clubId: null, data: null },
    ], nextCursor: null }),
    markNotificationRead: jest.fn().mockResolvedValue({ ok: true }),
    markAllNotificationsRead: jest.fn().mockResolvedValue({ ok: true }),
  },
  notificationsStreamUrl: () => 'http://x/stream',
}));

// EventSource n'existe pas en jsdom : stub minimal.
beforeAll(() => {
  (global as any).EventSource = class { onmessage: ((e: any) => void) | null = null; close() {} } as any;
});

describe('NotificationBell', () => {
  it('affiche le badge de non-lus', async () => {
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
  });

  it('ouvre le panneau et liste les notifications', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    await waitFor(() => expect(screen.getByText('Nouveau joueur')).toBeInTheDocument());
  });

  it('sur mobile, ouvre le panneau en feuille centrée (fixed, plein largeur)', async () => {
    // matchMedia stub (jest.setup) → useIsDesktop = false → variante mobile.
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    const panel = await screen.findByRole('region', { name: 'Notifications' });
    expect(panel).toHaveStyle({ position: 'fixed' });
    expect(panel).toHaveStyle({ maxWidth: '480px' });
    expect(panel).toHaveStyle({ margin: '0px auto' });
  });

  it('sur desktop, garde le panneau ancré sous la cloche (absolute)', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: true, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      render(<NotificationBell />);
      fireEvent.click(screen.getByLabelText('Notifications'));
      const panel = await screen.findByRole('region', { name: 'Notifications' });
      await waitFor(() => expect(panel).toHaveStyle({ position: 'absolute' }));
    } finally {
      window.matchMedia = original;
    }
  });
});
