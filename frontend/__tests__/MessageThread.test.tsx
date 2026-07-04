import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MessageThread } from '@/components/messages/MessageThread';
import { ThemeProvider } from '@/lib/ThemeProvider';

let lastES: FakeES | null = null;
class FakeES {
  url: string; onmessage: ((e: { data: string }) => void) | null = null; onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; lastES = this; }
  close() {}
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
(global as unknown as { EventSource: unknown }).EventSource = FakeES;

// Déclaration de fonction (hoistée) : la factory jest.mock ci-dessous l'évalue avant les const.
function MSG(id: string, authorId: string, body: string, over = {}) {
  return {
    id, author: { userId: authorId, firstName: authorId === 'u1' ? 'Moi' : 'Marie', lastName: 'X', avatarUrl: null },
    body, imageUrl: null, createdAt: '2026-07-04T10:00:00Z', deleted: false, reactions: [], ...over,
  };
}

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  conversationStreamUrl: () => 'http://x/stream',
  dmImageUrl: (c: string, m: string) => `http://x/${c}/${m}/image`,
  api: {
    getDmMessages: jest.fn().mockResolvedValue({
      messages: [MSG('m1', 'u2', 'salut'), MSG('m2', 'u1', 'yo')],
      meta: { myLastReadAt: null, otherLastReadAt: '2026-07-04T11:00:00Z', blocked: false, hasMore: false },
    }),
    postDmMessage: jest.fn().mockResolvedValue(MSG('m3', 'u1', 'nouveau')),
    deleteDmMessage: jest.fn().mockResolvedValue(MSG('m2', 'u1', '', { deleted: true })),
    addDmReaction: jest.fn().mockResolvedValue([{ emoji: '👍', userIds: ['u1'] }]),
    removeDmReaction: jest.fn().mockResolvedValue([]),
    markConversationRead: jest.fn().mockResolvedValue({ lastReadAt: '2026-07-04T12:00:00Z' }),
    sendTyping: jest.fn().mockResolvedValue({ ok: true }),
    uploadDmImage: jest.fn().mockResolvedValue(MSG('m4', 'u1', '', { imageUrl: 'c1/x.jpg' })),
  },
}));
const apiMock = jest.requireMock('@/lib/api').api;

const renderThread = (over = {}) => render(
  <ThemeProvider>
    <MessageThread conversationId="c1" token="t" viewerUserId="u1"
      other={{ userId: 'u2', firstName: 'Marie', lastName: 'D', avatarUrl: null }} {...over} />
  </ThemeProvider>,
);

it('charge le fil, marque lu à l\'ouverture, affiche ✓✓ Lu sur mon dernier message lu', async () => {
  renderThread();
  expect(await screen.findByText('salut')).toBeInTheDocument();
  expect(apiMock.markConversationRead).toHaveBeenCalledWith('c1', 't');
  expect(screen.getByText(/✓✓/)).toBeInTheDocument(); // otherLastReadAt (11h) >= createdAt (10h)
});

it('envoie un message (optimiste : draft vidé, restauré sur échec)', async () => {
  renderThread();
  await screen.findByText('salut');
  const input = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'nouveau' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(apiMock.postDmMessage).toHaveBeenCalledWith('c1', 'nouveau', 't'));
  expect(input.value).toBe('');
});

it('reçoit dm_message en SSE → upsert + markRead ; dm_typing → « Marie écrit… »', async () => {
  renderThread();
  await screen.findByText('salut');
  act(() => lastES!.emit({ type: 'dm_message', message: MSG('m9', 'u2', 'coucou') }));
  expect(await screen.findByText('coucou')).toBeInTheDocument();
  act(() => lastES!.emit({ type: 'dm_typing', userId: 'u2' }));
  expect(await screen.findByText(/Marie écrit/)).toBeInTheDocument();
});

it('dm_read en SSE fait passer mes messages en ✓✓ sans recharger', async () => {
  apiMock.getDmMessages.mockResolvedValueOnce({
    messages: [MSG('m2', 'u1', 'yo')],
    meta: { myLastReadAt: null, otherLastReadAt: null, blocked: false, hasMore: false },
  });
  renderThread();
  await screen.findByText('yo');
  expect(screen.queryByText(/✓✓/)).toBeNull();
  act(() => lastES!.emit({ type: 'dm_read', userId: 'u2', lastReadAt: '2026-07-04T12:00:00Z' }));
  expect(await screen.findByText(/✓✓/)).toBeInTheDocument();
});

it('réaction : toggle 👍 via la barre rapide → addDmReaction, chip « 👍 1 » affichée', async () => {
  renderThread();
  await screen.findByText('salut');
  fireEvent.click(screen.getAllByRole('button', { name: /réagir/i })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Réaction 👍' }));
  await waitFor(() => expect(apiMock.addDmReaction).toHaveBeenCalledWith('c1', 'm1', '👍', 't'));
});

it('conversation bloquée → composer désactivé avec message générique', async () => {
  apiMock.getDmMessages.mockResolvedValueOnce({
    messages: [], meta: { myLastReadAt: null, otherLastReadAt: null, blocked: true, hasMore: false },
  });
  renderThread();
  expect(await screen.findByText(/Vous ne pouvez pas échanger avec ce membre/)).toBeInTheDocument();
});

it('pagination : « Messages précédents » visible si hasMore, charge avec before=', async () => {
  apiMock.getDmMessages.mockResolvedValueOnce({
    messages: [MSG('m5', 'u2', 'récent')],
    meta: { myLastReadAt: null, otherLastReadAt: null, blocked: false, hasMore: true },
  });
  renderThread();
  await screen.findByText('récent');
  apiMock.getDmMessages.mockResolvedValueOnce({
    messages: [MSG('m4', 'u2', 'ancien')], meta: { myLastReadAt: null, otherLastReadAt: null, blocked: false, hasMore: false },
  });
  fireEvent.click(screen.getByRole('button', { name: /précédents/i }));
  await waitFor(() => expect(apiMock.getDmMessages).toHaveBeenCalledWith('c1', 't', 'm5'));
  expect(await screen.findByText('ancien')).toBeInTheDocument();
});
