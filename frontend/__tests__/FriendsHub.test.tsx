import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FriendsHub } from '@/components/social/FriendsHub';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent:'#fff', surface:'#fff', surface2:'#eee', line:'#ccc', text:'#111', textMute:'#666', fontUI:'sans-serif' } }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const openDm = jest.fn();
jest.mock('@/lib/messages', () => ({ openDm: (...a: unknown[]) => openDm(...a) }));
const listFriendships = jest.fn();
const listFriendRequests = jest.fn();
const listFollowing = jest.fn();
const listFollowers = jest.fn();
const searchClubMembers = jest.fn();
const respondFriend = jest.fn();
const removeFriend = jest.fn();
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: {
  listFriendships: (...a: unknown[]) => listFriendships(...a),
  listFriendRequests: (...a: unknown[]) => listFriendRequests(...a),
  listFollowing: (...a: unknown[]) => listFollowing(...a),
  listFollowers: (...a: unknown[]) => listFollowers(...a),
  searchClubMembers: (...a: unknown[]) => searchClubMembers(...a),
  respondFriend: (...a: unknown[]) => respondFriend(...a),
  removeFriend: (...a: unknown[]) => removeFriend(...a),
  requestFriend: jest.fn(),
  followUser: jest.fn().mockResolvedValue({ iFollow: true, followsMe: true, mutual: true }),
  unfollowUser: jest.fn().mockResolvedValue({ iFollow: false, followsMe: false, mutual: false }),
} }));

describe('FriendsHub', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listFriendships.mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true }]);
    listFriendRequests.mockResolvedValue({
      received: [{ id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: null, mutual: false }],
      sent: [{ id: 'u4', firstName: 'Zoé', lastName: 'K', avatarUrl: null, mutual: false }],
    });
    listFollowing.mockResolvedValue([]);
    listFollowers.mockResolvedValue([]);
    searchClubMembers.mockResolvedValue([]);
  });

  it('onglet Amis = amitiés confirmées', async () => {
    render(<FriendsHub slug="demo" token="t" />);
    expect(await screen.findByText('Léa M')).toBeInTheDocument();
  });

  it('bouton 💬 « Écrire à » sur une ligne → openDm avec le bon userId', async () => {
    render(<FriendsHub slug="demo" token="t" />);
    await screen.findByText('Léa M');
    fireEvent.click(screen.getByRole('button', { name: 'Écrire à Léa M' }));
    expect(openDm).toHaveBeenCalledWith('u2', expect.objectContaining({ isDesktop: expect.any(Boolean) }));
  });

  it('onglet Demandes affiche les reçues avec Accepter/Refuser', async () => {
    respondFriend.mockResolvedValue({ status: 'friends', requestable: false });
    render(<FriendsHub slug="demo" token="t" initialTab="demandes" />);
    expect(await screen.findByText('Tom B')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Accepter/ }));
    await waitFor(() => expect(respondFriend).toHaveBeenCalledWith('demo', 'u3', true, 't'));
  });

  it('onglet Demandes affiche aussi les envoyées', async () => {
    render(<FriendsHub slug="demo" token="t" initialTab="demandes" />);
    expect(await screen.findByText('Zoé K')).toBeInTheDocument();
  });

  it('onglet Abonnés : un follower que je suis en retour affiche « ★ Favori », pas « ☆ Favori »', async () => {
    listFollowers.mockResolvedValue([{ id: 'u5', firstName: 'Max', lastName: 'R', avatarUrl: null, mutual: true }]);
    render(<FriendsHub slug="demo" token="t" initialTab="followers" />);
    expect(await screen.findByText('Max R')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '★ Favori' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '☆ Favori' })).not.toBeInTheDocument();
  });
});
