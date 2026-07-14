import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FollowButton } from '@/components/social/FollowButton';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent: '#fff', surface2: '#eee', line: '#ccc', text: '#111', textMute: '#666', fontUI: 'sans-serif' } }) }));
const followUser = jest.fn();
const unfollowUser = jest.fn();
jest.mock('@/lib/api', () => ({ api: { followUser: (...a: unknown[]) => followUser(...a), unfollowUser: (...a: unknown[]) => unfollowUser(...a) } }));

describe('FollowButton', () => {
  beforeEach(() => { followUser.mockReset().mockResolvedValue({ iFollow: true, followsMe: false, mutual: false }); unfollowUser.mockReset().mockResolvedValue({ iFollow: false, followsMe: false, mutual: false }); });

  it('affiche « ☆ Favori » quand on ne suit pas, et suit au clic (optimiste)', async () => {
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: false, mutual: false }} />);
    const btn = screen.getByRole('button', { name: '☆ Favori' });
    fireEvent.click(btn);
    expect(await screen.findByRole('button', { name: '★ Favori' })).toBeInTheDocument(); // optimiste
    await waitFor(() => expect(followUser).toHaveBeenCalledWith('demo', 'u2', 't'));
  });

  it('affiche « ★ Favori » et défait au clic', async () => {
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: true, mutual: false }} />);
    fireEvent.click(screen.getByRole('button', { name: '★ Favori' }));
    expect(await screen.findByRole('button', { name: '☆ Favori' })).toBeInTheDocument();
    await waitFor(() => expect(unfollowUser).toHaveBeenCalledWith('demo', 'u2', 't'));
  });

  it('un suivi mutuel affiche « ★ Favori » (plus « Amis »)', () => {
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: true, mutual: true }} />);
    expect(screen.getByRole('button', { name: '★ Favori' })).toBeInTheDocument();
    expect(screen.queryByText('Amis')).not.toBeInTheDocument();
  });

  it('revient à l\'état initial si l\'API échoue', async () => {
    followUser.mockRejectedValue(new Error('boom'));
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: false, mutual: false }} />);
    fireEvent.click(screen.getByRole('button', { name: '☆ Favori' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '☆ Favori' })).toBeInTheDocument()); // rollback
  });
});
