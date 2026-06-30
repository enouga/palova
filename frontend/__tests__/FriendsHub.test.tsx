import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FriendsHub } from '@/components/social/FriendsHub';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent:'#fff', surface:'#fff', surface2:'#eee', line:'#ccc', text:'#111', textMute:'#666', fontUI:'sans-serif' } }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
const listFollowing = jest.fn();
const listFollowers = jest.fn();
const searchClubMembers = jest.fn();
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: {
  listFollowing: (...a: unknown[]) => listFollowing(...a),
  listFollowers: (...a: unknown[]) => listFollowers(...a),
  searchClubMembers: (...a: unknown[]) => searchClubMembers(...a),
  followUser: jest.fn().mockResolvedValue({ iFollow: true, followsMe: true, mutual: true }),
  unfollowUser: jest.fn().mockResolvedValue({ iFollow: false, followsMe: false, mutual: false }),
} }));

describe('FriendsHub', () => {
  beforeEach(() => {
    listFollowing.mockReset().mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true }]);
    listFollowers.mockReset().mockResolvedValue([{ id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: null, mutual: false }]);
    searchClubMembers.mockReset().mockResolvedValue([{ id: 'u9', firstName: 'New', lastName: 'Player', avatarUrl: null, level: null, iFollow: false, mutual: false }]);
  });

  it('charge mes amis (mutuels) par défaut', async () => {
    render(<FriendsHub slug="demo" token="t" initialTab="amis" />);
    expect(await screen.findByText(/Léa/)).toBeInTheDocument();
  });

  it('l\'onglet « Me suivent » liste les followers', async () => {
    render(<FriendsHub slug="demo" token="t" initialTab="followers" />);
    await waitFor(() => expect(listFollowers).toHaveBeenCalled());
    expect(await screen.findByText(/Tom/)).toBeInTheDocument();
  });

  it('onglet « Trouver » appelle searchClubMembers et affiche un bouton Suivre', async () => {
    render(<FriendsHub slug="demo" token="t" />);
    fireEvent.click(screen.getByText('Trouver'));
    expect(await screen.findByText(/New/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Suivre/i })).toBeInTheDocument();
    expect(searchClubMembers).toHaveBeenCalledWith('demo', '', 't');
  });

  it('onglet « Trouver » : taper une requête appelle searchClubMembers avec la query', async () => {
    render(<FriendsHub slug="demo" token="t" />);
    fireEvent.click(screen.getByText('Trouver'));
    // Wait for initial call to settle
    await waitFor(() => expect(searchClubMembers).toHaveBeenCalledWith('demo', '', 't'));
    searchClubMembers.mockResolvedValue([{ id: 'u9', firstName: 'New', lastName: 'Player', avatarUrl: null, level: null, iFollow: false, mutual: false }]);
    const input = screen.getByPlaceholderText('Rechercher un joueur à suivre…');
    fireEvent.change(input, { target: { value: 'New' } });
    await waitFor(() => expect(searchClubMembers).toHaveBeenCalledWith('demo', 'New', 't'));
    expect(await screen.findByText(/New Player/)).toBeInTheDocument();
  });

  it('rafraîchit mes listes après un suivi (onChange → reload) pour mettre à jour les compteurs', async () => {
    render(<FriendsHub slug="demo" token="t" />);
    fireEvent.click(screen.getByText('Trouver'));
    const followBtn = await screen.findByRole('button', { name: /Suivre/i });
    const before = listFollowing.mock.calls.length; // appelé une fois au montage
    fireEvent.click(followBtn);
    // le suivi réussit → onChange déclenche un re-fetch de listFollowing (compteur « Je suis »)
    await waitFor(() => expect(listFollowing.mock.calls.length).toBeGreaterThan(before));
  });
});
