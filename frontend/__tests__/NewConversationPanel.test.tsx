import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { NewConversationPanel } from '@/components/messages/NewConversationPanel';

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    listClubFriends: jest.fn(),
    searchClubMembers: jest.fn(),
    openConversation: jest.fn(),
  },
}));
const apiMock = jest.requireMock('@/lib/api').api;

const onClose = jest.fn();
const onOpened = jest.fn();

const renderPanel = () => render(
  <ThemeProvider>
    <NewConversationPanel slug="demo" token="t" viewerUserId="u1" onClose={onClose} onOpened={onOpened} />
  </ThemeProvider>,
);

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.listClubFriends.mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true }]);
  apiMock.searchClubMembers.mockResolvedValue([{ id: 'u3', firstName: 'Tom', lastName: 'B' }]);
  apiMock.openConversation.mockResolvedValue({
    id: 'c9', other: { userId: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null },
    clubId: 'demo', lastMessageAt: null, unreadCount: 0, lastMessage: null,
  });
});

it('champ vide affiche mes amis', async () => {
  renderPanel();
  expect(await screen.findByText('Léa M')).toBeInTheDocument();
  expect(apiMock.searchClubMembers).not.toHaveBeenCalled();
});

it('aucun ami → invite à taper un nom', async () => {
  apiMock.listClubFriends.mockResolvedValue([]);
  renderPanel();
  expect(await screen.findByText('Tapez un nom pour trouver un membre.')).toBeInTheDocument();
});

it('taper un nom déclenche la recherche annuaire (débounce) et remplace la liste des amis', async () => {
  renderPanel();
  await screen.findByText('Léa M');
  fireEvent.change(screen.getByPlaceholderText('Rechercher un membre…'), { target: { value: 'tom' } });
  await waitFor(() => expect(apiMock.searchClubMembers).toHaveBeenCalledWith('demo', 'tom', 't'));
  expect(await screen.findByText('Tom B')).toBeInTheDocument();
  expect(screen.queryByText('Léa M')).not.toBeInTheDocument();
});

it('clic sur la croix ferme le panneau', async () => {
  renderPanel();
  await screen.findByText('Léa M');
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onClose).toHaveBeenCalled();
});

it('le viewer est absent des amis et des résultats de recherche', async () => {
  apiMock.listClubFriends.mockResolvedValue([{ id: 'u1', firstName: 'Moi', lastName: 'Même', avatarUrl: null, mutual: true }]);
  apiMock.searchClubMembers.mockResolvedValue([{ id: 'u1', firstName: 'Moi', lastName: 'Même' }]);
  renderPanel();
  await waitFor(() => expect(apiMock.listClubFriends).toHaveBeenCalled());
  expect(screen.queryByText('Moi Même')).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Rechercher un membre…'), { target: { value: 'moi' } });
  await waitFor(() => expect(apiMock.searchClubMembers).toHaveBeenCalled());
  expect(screen.queryByText('Moi Même')).not.toBeInTheDocument();
});

it('clic sur un membre ouvre la conversation et notifie le parent', async () => {
  renderPanel();
  fireEvent.click(await screen.findByText('Léa M'));
  await waitFor(() => expect(apiMock.openConversation).toHaveBeenCalledWith('u2', 't', 'demo'));
  await waitFor(() => expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({ id: 'c9' })));
});

it('échec de openConversation affiche une erreur et laisse le panneau ouvert', async () => {
  apiMock.openConversation.mockRejectedValue(new Error('boom'));
  renderPanel();
  fireEvent.click(await screen.findByText('Léa M'));
  expect(await screen.findByText("Impossible d'ouvrir cette conversation.")).toBeInTheDocument();
  expect(onOpened).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
