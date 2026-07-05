import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagesHub } from '@/components/messages/MessagesHub';
import { ThemeProvider } from '@/lib/ThemeProvider';

class FakeES { onmessage: unknown = null; onerror: unknown = null; close() {} }
(global as unknown as { EventSource: unknown }).EventSource = FakeES;

// Déclaration de fonction (hoistée) : la factory jest.mock ci-dessous l'évalue avant les const.
function CONV() {
  return {
    id: 'c1', other: { userId: 'u2', firstName: 'Marie', lastName: 'Dupont', avatarUrl: null },
    clubId: 'club-demo', lastMessageAt: '2026-07-04T10:00:00Z', unreadCount: 2,
    lastMessage: { body: 'on joue ?', hasImage: false, mine: false, deleted: false },
  };
}

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  conversationStreamUrl: () => 'http://x/stream',
  notificationsStreamUrl: () => 'http://x/notif',
  dmImageUrl: () => 'http://x/img',
  api: {
    listConversations: jest.fn().mockResolvedValue([CONV()]),
    openConversation: jest.fn().mockResolvedValue(CONV()),
    getDmMessages: jest.fn().mockResolvedValue({ messages: [], meta: { myLastReadAt: null, otherLastReadAt: null, blocked: false, hasMore: false } }),
    markConversationRead: jest.fn().mockResolvedValue({ lastReadAt: 'x' }),
    listBlockedUsers: jest.fn().mockResolvedValue([]),
    blockUser: jest.fn().mockResolvedValue({ blocked: true }),
    unblockUser: jest.fn().mockResolvedValue({ blocked: false }),
    postDmMessage: jest.fn(), uploadDmImage: jest.fn(), sendTyping: jest.fn().mockResolvedValue({ ok: true }),
    addDmReaction: jest.fn(), removeDmReaction: jest.fn(), deleteDmMessage: jest.fn(),
    listClubFriends: jest.fn().mockResolvedValue([]),
    searchClubMembers: jest.fn().mockResolvedValue([]),
  },
}));
const apiMock = jest.requireMock('@/lib/api').api;

// jsdom = mobile par défaut (matchMedia stubé) → parcours liste → fil.
const renderHub = (over = {}) => render(
  <ThemeProvider><MessagesHub token="t" viewerUserId="u1" clubSlug="demo" {...over} /></ThemeProvider>,
);

it('liste les conversations avec aperçu et badge de non-lus', async () => {
  renderHub();
  expect(await screen.findByText('Marie Dupont')).toBeInTheDocument();
  expect(screen.getByText('on joue ?')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
});

it('tap sur une conversation → ouvre le fil (mobile) puis retour', async () => {
  renderHub();
  fireEvent.click(await screen.findByText('Marie Dupont'));
  await waitFor(() => expect(apiMock.getDmMessages).toHaveBeenCalledWith('c1', 't'));
  fireEvent.click(screen.getByRole('button', { name: /retour/i }));
  expect(await screen.findByText('on joue ?')).toBeInTheDocument();
});

it('deeplink initialWith → openConversation puis fil ouvert', async () => {
  renderHub({ initialWith: 'u2' });
  await waitFor(() => expect(apiMock.openConversation).toHaveBeenCalledWith('u2', 't', 'demo'));
  await waitFor(() => expect(apiMock.getDmMessages).toHaveBeenCalled());
});

it('menu ⋮ de l\'en-tête du fil : « Bloquer ce membre » → blockUser après confirmation', async () => {
  renderHub();
  fireEvent.click(await screen.findByText('Marie Dupont'));
  await waitFor(() => expect(apiMock.getDmMessages).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /options de la conversation/i }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /bloquer/i }));
  fireEvent.click(await screen.findByRole('button', { name: /^bloquer$/i })); // ConfirmDialog
  await waitFor(() => expect(apiMock.blockUser).toHaveBeenCalledWith('u2', 't'));
});

it('« Membres bloqués » liste et débloque', async () => {
  apiMock.listBlockedUsers.mockResolvedValue([{ userId: 'u9', firstName: 'Paul', lastName: 'R', avatarUrl: null }]);
  renderHub();
  await screen.findByText('Marie Dupont');
  fireEvent.click(screen.getByRole('button', { name: /membres bloqués/i }));
  expect(await screen.findByText('Paul R')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /débloquer/i }));
  await waitFor(() => expect(apiMock.unblockUser).toHaveBeenCalledWith('u9', 't'));
});

it('bouton « Nouveau » ouvre le panneau, sélectionner un membre ouvre son fil et ferme le panneau', async () => {
  apiMock.searchClubMembers.mockResolvedValue([{ id: 'u5', firstName: 'Nina', lastName: 'K' }]);
  apiMock.openConversation.mockResolvedValue({
    id: 'c2', other: { userId: 'u5', firstName: 'Nina', lastName: 'K', avatarUrl: null },
    clubId: 'club-demo', lastMessageAt: null, unreadCount: 0, lastMessage: null,
  });
  renderHub();
  await screen.findByText('Marie Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Nouvelle conversation' }));
  fireEvent.change(await screen.findByPlaceholderText('Rechercher un membre…'), { target: { value: 'nina' } });
  fireEvent.click(await screen.findByText('Nina K'));
  await waitFor(() => expect(apiMock.openConversation).toHaveBeenCalledWith('u5', 't', 'demo'));
  expect(screen.queryByRole('dialog', { name: 'Nouvelle conversation' })).not.toBeInTheDocument();
  await waitFor(() => expect(apiMock.getDmMessages).toHaveBeenCalledWith('c2', 't'));
});

it('sans clubSlug, le bouton « Nouveau » est masqué', async () => {
  renderHub({ clubSlug: null });
  await screen.findByText('Marie Dupont');
  expect(screen.queryByRole('button', { name: 'Nouvelle conversation' })).not.toBeInTheDocument();
});
