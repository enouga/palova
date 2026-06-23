import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import AdminBroadcastPage from '@/app/admin/broadcast/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-demo', accentColor: '#d6ff3f' } }) }));
jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    getClubBroadcasts: jest.fn().mockResolvedValue({
      recipientCount: 42,
      items: [
        {
          id: 'b1',
          title: 'Tournoi de printemps',
          body: 'Inscrivez-vous avant le 30 juin pour participer au tournoi.',
          url: null,
          recipientCount: 38,
          createdAt: '2026-06-01T10:00:00.000Z',
        },
      ],
    }),
    sendClubBroadcast: jest.fn().mockResolvedValue({ recipientCount: 42, broadcastId: 'b2' }),
  },
}));

function renderPage() {
  return render(
    <ThemeProvider>
      <AdminBroadcastPage />
    </ThemeProvider>,
  );
}

describe('AdminBroadcastPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { api } = require('@/lib/api');
    api.getClubBroadcasts.mockResolvedValue({
      recipientCount: 42,
      items: [
        {
          id: 'b1',
          title: 'Tournoi de printemps',
          body: 'Inscrivez-vous avant le 30 juin pour participer au tournoi.',
          url: null,
          recipientCount: 38,
          createdAt: '2026-06-01T10:00:00.000Z',
        },
      ],
    });
    api.sendClubBroadcast.mockResolvedValue({ recipientCount: 42, broadcastId: 'b2' });
  });

  it("affiche le nombre de membres actifs après chargement", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/42 membres actifs/i)).toBeInTheDocument(),
    );
  });

  it("affiche un broadcast dans l'historique", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Tournoi de printemps')).toBeInTheDocument(),
    );
    expect(screen.getByText(/38 destinataires/i)).toBeInTheDocument();
  });

  it("appelle sendClubBroadcast avec le titre et le message saisis puis confirme", async () => {
    const { api } = require('@/lib/api');
    renderPage();
    await waitFor(() => screen.getByText(/42 membres actifs/i));

    fireEvent.change(screen.getByPlaceholderText(/titre du message/i), {
      target: { value: 'Mon titre' },
    });
    fireEvent.change(screen.getByPlaceholderText(/contenu du message/i), {
      target: { value: 'Mon message détaillé' },
    });

    fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    // La boîte de confirmation doit apparaître
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument(),
    );

    // Confirmer l'envoi
    const sendButtons = screen.getAllByRole('button', { name: /envoyer/i });
    // Le dernier bouton "Envoyer" dans le dialog est le bouton de confirmation
    fireEvent.click(sendButtons[sendButtons.length - 1]);

    await waitFor(() =>
      expect(api.sendClubBroadcast).toHaveBeenCalledWith(
        'club-demo',
        { title: 'Mon titre', body: 'Mon message détaillé' },
        't',
      ),
    );
  });

  it("désactive le bouton Envoyer quand titre ou message est vide", async () => {
    renderPage();
    await waitFor(() => screen.getByText(/42 membres actifs/i));

    const btn = screen.getByRole('button', { name: /envoyer/i });
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/titre du message/i), {
      target: { value: 'Un titre' },
    });
    // message vide => toujours désactivé
    expect(btn).toBeDisabled();
  });
});
