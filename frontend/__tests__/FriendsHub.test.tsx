import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FriendsHub } from '@/components/social/FriendsHub';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent:'#fff', surface:'#fff', surface2:'#eee', line:'#ccc', text:'#111', textMute:'#666', fontUI:'sans-serif' } }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
const listFollowing = jest.fn();
const listFollowers = jest.fn();
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: {
  listFollowing: (...a: unknown[]) => listFollowing(...a),
  listFollowers: (...a: unknown[]) => listFollowers(...a),
  followUser: jest.fn().mockResolvedValue({ iFollow: true, followsMe: true, mutual: true }),
  unfollowUser: jest.fn().mockResolvedValue({ iFollow: false, followsMe: false, mutual: false }),
} }));

describe('FriendsHub', () => {
  beforeEach(() => {
    listFollowing.mockReset().mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true }]);
    listFollowers.mockReset().mockResolvedValue([{ id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: null, mutual: false }]);
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
});
