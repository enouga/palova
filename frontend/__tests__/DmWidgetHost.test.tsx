import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { DmWidgetHost } from '@/components/messages/DmWidgetHost';
import { ThemeProvider } from '@/lib/ThemeProvider';

class FakeES { onmessage: unknown = null; onerror: unknown = null; close() {} }
(global as unknown as { EventSource: unknown }).EventSource = FakeES;

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// Déclaration de fonction (hoistée) : la factory jest.mock ci-dessous l'évalue avant les const.
function CONV() {
  return {
    id: 'c1', other: { userId: 'u2', firstName: 'Marie', lastName: 'D', avatarUrl: null },
    clubId: null, lastMessageAt: null, unreadCount: 0, lastMessage: null,
  };
}
jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  conversationStreamUrl: () => 'http://x/stream',
  dmImageUrl: () => 'http://x/img',
  api: {
    getMyProfile: jest.fn().mockResolvedValue({ id: 'u1' }),
    openConversation: jest.fn().mockResolvedValue(CONV()),
    getDmMessages: jest.fn().mockResolvedValue({ messages: [], meta: { myLastReadAt: null, otherLastReadAt: null, blocked: false, hasMore: false } }),
    markConversationRead: jest.fn().mockResolvedValue({ lastReadAt: 'x' }),
    postDmMessage: jest.fn(), uploadDmImage: jest.fn(), sendTyping: jest.fn().mockResolvedValue({ ok: true }),
    addDmReaction: jest.fn(), removeDmReaction: jest.fn(), deleteDmMessage: jest.fn(),
  },
}));
const apiMock = jest.requireMock('@/lib/api').api;

// useAuth mocké : connecté (pas de user.id → le host le résout via getMyProfile).
// useClub mocké : hôte plateforme (slug null).
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', clubId: null, ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null }) }));

const emitOpen = (userId: string) =>
  act(() => { window.dispatchEvent(new CustomEvent('palova:open-dm', { detail: { userId } })); });

it('desktop : palova:open-dm ouvre le widget ancré avec le fil', async () => {
  // useIsDesktop lit matchMedia — le forcer à desktop
  (window.matchMedia as unknown as jest.Mock) = jest.fn().mockReturnValue({
    matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  });
  render(<ThemeProvider><DmWidgetHost /></ThemeProvider>);
  emitOpen('u2');
  await waitFor(() => expect(apiMock.openConversation).toHaveBeenCalledWith('u2', 't', null));
  expect(await screen.findByText('Marie D')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /fermer/i }));
  expect(screen.queryByText('Marie D')).toBeNull();
});

it('desktop : conversation refusée (DM_DISABLED) affiche un message d\'erreur fermable', async () => {
  (window.matchMedia as unknown as jest.Mock) = jest.fn().mockReturnValue({
    matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  });
  apiMock.openConversation.mockRejectedValue(new Error('DM_DISABLED'));
  render(<ThemeProvider><DmWidgetHost /></ThemeProvider>);
  emitOpen('u2');
  expect(await screen.findByRole('alert')).toHaveTextContent("Ce joueur n'accepte pas les messages privés.");
  fireEvent.click(screen.getByRole('button', { name: /fermer/i }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('mobile : palova:open-dm route vers /me/messages?with=', async () => {
  (window.matchMedia as unknown as jest.Mock) = jest.fn().mockReturnValue({
    matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  });
  render(<ThemeProvider><DmWidgetHost /></ThemeProvider>);
  emitOpen('u2');
  await waitFor(() => expect(push).toHaveBeenCalledWith('/me/messages?with=u2'));
});
