import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MatchDiscussion } from '@/components/match/MatchDiscussion';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  assetUrl: (u: string | null) => u, // requis par Avatar
  api: {
    getMatchComments: jest.fn(),
    postMatchComment: jest.fn(),
  },
}));
import { api } from '@/lib/api';

const renderWithTheme = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

const thread = {
  status: 'DISPUTED' as const,
  comments: [
    { id: 'k1', body: 'Le score est faux', createdAt: '2026-06-11T10:00:00Z', isStaff: false,
      author: { firstName: 'Manon', lastName: 'Membre', avatarUrl: null } },
    { id: 'k2', body: 'On vérifie', createdAt: '2026-06-11T11:00:00Z', isStaff: true,
      author: { firstName: 'Sam', lastName: 'Staff', avatarUrl: null } },
  ],
};

it('affiche les messages et le badge Staff', async () => {
  (api.getMatchComments as jest.Mock).mockResolvedValue(thread);
  renderWithTheme(<MatchDiscussion matchId="m1" token="t" canWrite={false} />);
  expect(await screen.findByText('Le score est faux')).toBeInTheDocument();
  expect(screen.getByText('On vérifie')).toBeInTheDocument();
  expect(screen.getByText('Staff')).toBeInTheDocument();
  expect(screen.getByText('Discussion close.')).toBeInTheDocument();
});

it('un échec réseau affiche un message distinct de « Aucun message. » + un bouton Réessayer', async () => {
  (api.getMatchComments as jest.Mock).mockRejectedValueOnce(new Error('network'));
  renderWithTheme(<MatchDiscussion matchId="m1" token="t" canWrite={false} />);
  await screen.findByText(/impossible de charger la discussion/i);
  expect(screen.queryByText('Aucun message.')).not.toBeInTheDocument();

  (api.getMatchComments as jest.Mock).mockResolvedValueOnce({ status: 'DISPUTED', comments: [] });
  fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
  await screen.findByText('Aucun message.');
});

it('envoie un message quand canWrite', async () => {
  (api.getMatchComments as jest.Mock).mockResolvedValue(thread);
  (api.postMatchComment as jest.Mock).mockResolvedValue({ ok: true });
  renderWithTheme(<MatchDiscussion matchId="m1" token="t" canWrite />);
  await screen.findByText('Le score est faux');
  fireEvent.change(screen.getByPlaceholderText('Votre message…'), { target: { value: 'Je confirme le 6-4' } });
  fireEvent.click(screen.getByText('Envoyer'));
  await waitFor(() => expect(api.postMatchComment).toHaveBeenCalledWith('m1', 'Je confirme le 6-4', 't'));
});
