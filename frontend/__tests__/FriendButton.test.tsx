import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { FriendButton } from '@/components/social/FriendButton';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: { requestFriend: jest.fn(), respondFriend: jest.fn(), removeFriend: jest.fn() },
}));

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('FriendButton', () => {
  beforeEach(() => jest.clearAllMocks());

  it('none+requestable → « Ajouter en ami », clic envoie la demande', async () => {
    (api.requestFriend as jest.Mock).mockResolvedValue({ status: 'pending_out', requestable: false });
    wrap(<FriendButton slug="demo" userId="u2" token="t" relation={{ status: 'none', requestable: true }} />);
    const btn = screen.getByRole('button', { name: /Ajouter en ami/ });
    fireEvent.click(btn);
    await waitFor(() => expect(api.requestFriend).toHaveBeenCalledWith('demo', 'u2', 't'));
    expect(screen.getByRole('button', { name: /Demande envoyée/ })).toBeInTheDocument();
  });

  it('none+!requestable → désactivé « N\'accepte pas les demandes »', () => {
    wrap(<FriendButton slug="demo" userId="u2" token="t" relation={{ status: 'none', requestable: false }} />);
    expect(screen.getByRole('button', { name: /N'accepte pas les demandes/ })).toBeDisabled();
  });

  it('pending_in → « Accepter » appelle respondFriend(true)', async () => {
    (api.respondFriend as jest.Mock).mockResolvedValue({ status: 'friends', requestable: false });
    wrap(<FriendButton slug="demo" userId="u2" token="t" relation={{ status: 'pending_in', requestable: false }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Accepter/ }));
    await waitFor(() => expect(api.respondFriend).toHaveBeenCalledWith('demo', 'u2', true, 't'));
  });

  it('friends → clic retire (removeFriend)', async () => {
    (api.removeFriend as jest.Mock).mockResolvedValue({ status: 'none', requestable: true });
    wrap(<FriendButton slug="demo" userId="u2" token="t" relation={{ status: 'friends', requestable: false }} />);
    fireEvent.click(screen.getByRole('button', { name: /Amis/ }));
    await waitFor(() => expect(api.removeFriend).toHaveBeenCalledWith('demo', 'u2', 't'));
  });
});
