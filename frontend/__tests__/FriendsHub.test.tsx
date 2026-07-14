import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FriendsHub, INVITE_DRAFT } from '@/components/social/FriendsHub';

// jsdom n'implémente pas scrollIntoView (utilisé par le deep-link ?tab=).
window.HTMLElement.prototype.scrollIntoView = jest.fn();

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc', bgElev: '#fff',
  text: '#111', textMute: '#666', fontUI: 'sans-serif', fontDisplay: 'serif', mode: 'light', lineStrong: '#ccc',
} }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
jest.mock('@/lib/useIsDesktop', () => ({ useIsDesktop: () => false }));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const openDm = jest.fn();
jest.mock('@/lib/messages', () => ({ openDm: (...a: unknown[]) => openDm(...a) }));

const listFriendships = jest.fn();
const listFriendRequests = jest.fn();
const listFollowing = jest.fn();
const listFollowers = jest.fn();
const getFriendsAgenda = jest.fn();
const getPlayerSuggestions = jest.fn();
const searchClubMembers = jest.fn();
const respondFriend = jest.fn();
const removeFriend = jest.fn();
const unfollowUser = jest.fn();
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: {
  listFriendships: (...a: unknown[]) => listFriendships(...a),
  listFriendRequests: (...a: unknown[]) => listFriendRequests(...a),
  listFollowing: (...a: unknown[]) => listFollowing(...a),
  listFollowers: (...a: unknown[]) => listFollowers(...a),
  getFriendsAgenda: (...a: unknown[]) => getFriendsAgenda(...a),
  getPlayerSuggestions: (...a: unknown[]) => getPlayerSuggestions(...a),
  searchClubMembers: (...a: unknown[]) => searchClubMembers(...a),
  respondFriend: (...a: unknown[]) => respondFriend(...a),
  removeFriend: (...a: unknown[]) => removeFriend(...a),
  unfollowUser: (...a: unknown[]) => unfollowUser(...a),
  requestFriend: jest.fn(),
  followUser: jest.fn().mockResolvedValue({ iFollow: true, followsMe: false, mutual: false }),
} }));

const friend = (id: string, first: string, extra: object = {}) =>
  ({ id, firstName: first, lastName: 'X', avatarUrl: null, mutual: true, ...extra });

describe('FriendsHub (hub à sections)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listFriendships.mockResolvedValue([friend('u2', 'Léa', { playedTogetherCount: 12, lastPlayedTogetherAt: '2026-07-11T10:00:00' })]);
    listFriendRequests.mockResolvedValue({ received: [], sent: [] });
    listFollowing.mockResolvedValue([friend('u2', 'Léa'), friend('u5', 'Adrien', { mutual: false })]);
    listFollowers.mockResolvedValue([]);
    getFriendsAgenda.mockResolvedValue([]);
    getPlayerSuggestions.mockResolvedValue([]);
    searchClubMembers.mockResolvedValue([]);
  });

  const mount = (props: object = {}) =>
    render(<FriendsHub slug="demo" token="t" timezone="Europe/Paris" {...props} />);

  it('amis en cartes riches, favoris dédupliqués des amis', async () => {
    mount();
    expect(await screen.findByText('Léa X')).toBeInTheDocument();
    expect(screen.getByText(/12 parties ensemble/)).toBeInTheDocument();
    // Léa est amie ET suivie → elle n'apparaît PAS dans Favoris ; Adrien si.
    expect(screen.getByText('Favoris ★ · 1')).toBeInTheDocument();
    expect(screen.getByText('Adrien')).toBeInTheDocument();
  });

  it('sections vides masquées (pas de bannière, pas de rail, pas de suggestions)', async () => {
    mount();
    await screen.findByText('Léa X');
    expect(screen.queryByText('Ça joue bientôt')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggestions')).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Demandes d'ami")).not.toBeInTheDocument();
  });

  it('bannière demandes : accepter', async () => {
    listFriendRequests.mockResolvedValue({ received: [friend('u3', 'Tom', { mutual: false })], sent: [] });
    respondFriend.mockResolvedValue({ status: 'friends', requestable: false });
    mount();
    fireEvent.click(await screen.findByText('Accepter'));
    await waitFor(() => expect(respondFriend).toHaveBeenCalledWith('demo', 'u3', true, 't'));
  });

  it('rail agenda affiché quand il y a des items', async () => {
    getFriendsAgenda.mockResolvedValue([{ kind: 'match', id: 'r1', startTime: '2026-07-18T16:30:00Z', endTime: null,
      label: 'Partie ouverte · Court 1', friends: [{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null }] }]);
    mount();
    expect(await screen.findByText('Partie ouverte · Court 1')).toBeInTheDocument();
  });

  it('recherche → annuaire « Dans le club », opt-out sans bouton ami', async () => {
    searchClubMembers.mockResolvedValue([
      { id: 'm1', firstName: 'Ines', lastName: 'A', iFollow: false, mutual: false, friend: { status: 'none', requestable: false } },
    ]);
    mount();
    await screen.findByText('Léa X');
    fireEvent.change(screen.getByLabelText('Rechercher un joueur'), { target: { value: 'ines' } });
    expect(await screen.findByText('Ines A')).toBeInTheDocument();
    expect(screen.getByText('Dans le club')).toBeInTheDocument();
    expect(screen.queryByText(/N'accepte pas/)).not.toBeInTheDocument();
    // le pied « Qui me suit » disparaît pendant la recherche
    expect(screen.queryByText(/Qui me suit/)).not.toBeInTheDocument();
  });

  it('⚡ Inviter à jouer ouvre le DM avec le brouillon', async () => {
    mount();
    fireEvent.click(await screen.findByText('⚡ Inviter à jouer'));
    expect(openDm).toHaveBeenCalledWith('u2', expect.objectContaining({ draft: INVITE_DRAFT }));
  });

  it('retirer un ami passe par la confirmation', async () => {
    removeFriend.mockResolvedValue({ status: 'none', requestable: true });
    mount();
    fireEvent.click(await screen.findByText('Retirer'));
    expect(screen.getByText('Retirer cet ami ?')).toBeInTheDocument();
    // « Retirer » apparaît deux fois (bouton de la carte encore présent sous l'overlay +
    // bouton de confirmation) : le dernier du DOM est celui de la ConfirmDialog.
    const buttons = screen.getAllByText('Retirer');
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(removeFriend).toHaveBeenCalledWith('demo', 'u2', 't'));
  });

  it('deep-link ?tab=followers déplie le pied', async () => {
    listFollowers.mockResolvedValue([friend('u9', 'Zoé', { mutual: false })]);
    mount({ anchor: 'followers' });
    expect(await screen.findByText('Zoé X')).toBeInTheDocument();
  });

  it("état d'accueil quand tout est vide", async () => {
    listFriendships.mockResolvedValue([]);
    listFollowing.mockResolvedValue([]);
    mount();
    expect(await screen.findByText(/Retrouvez ici vos partenaires de jeu/)).toBeInTheDocument();
  });
});
