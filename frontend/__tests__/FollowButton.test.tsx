import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FollowButton } from '@/components/social/FollowButton';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent: '#fff', surface2: '#eee', line: '#ccc', text: '#111', textMute: '#666', fontUI: 'sans-serif' } }) }));
const followUser = jest.fn();
const unfollowUser = jest.fn();
jest.mock('@/lib/api', () => ({ api: { followUser: (...a: unknown[]) => followUser(...a), unfollowUser: (...a: unknown[]) => unfollowUser(...a) } }));

describe('FollowButton', () => {
  beforeEach(() => { followUser.mockReset().mockResolvedValue({ iFollow: true, followsMe: false, mutual: false }); unfollowUser.mockReset().mockResolvedValue({ iFollow: false, followsMe: false, mutual: false }); });

  it('affiche « Suivre » quand on ne suit pas, et suit au clic (optimiste)', async () => {
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: false, mutual: false }} />);
    const btn = screen.getByRole('button', { name: /suivre/i });
    fireEvent.click(btn);
    expect(await screen.findByRole('button', { name: /suivi/i })).toBeInTheDocument(); // optimiste
    await waitFor(() => expect(followUser).toHaveBeenCalledWith('demo', 'u2', 't'));
  });

  it('affiche « Suivi(e) » et défait au clic', async () => {
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: true, mutual: false }} />);
    fireEvent.click(screen.getByRole('button', { name: /suivi/i }));
    expect(await screen.findByRole('button', { name: /suivre/i })).toBeInTheDocument();
    await waitFor(() => expect(unfollowUser).toHaveBeenCalledWith('demo', 'u2', 't'));
  });

  it('affiche « Amis » quand mutuel', () => {
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: true, mutual: true }} />);
    expect(screen.getByRole('button', { name: /amis/i })).toBeInTheDocument();
  });

  it('revient à l\'état initial si l\'API échoue', async () => {
    followUser.mockRejectedValue(new Error('boom'));
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: false, mutual: false }} />);
    fireEvent.click(screen.getByRole('button', { name: /suivre/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /suivre/i })).toBeInTheDocument()); // rollback
  });
});
