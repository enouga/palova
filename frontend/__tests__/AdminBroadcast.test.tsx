import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminBroadcastPage from '@/app/admin/broadcast/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-demo', accentColor: '#d6ff3f' } }) }));

// Éditeur riche stubé : un textarea simple qui émet le format stocké (HTML) tel quel.
jest.mock('@/components/admin/email/RichEmailEditor', () => ({
  RichEmailEditor: ({ value, onChange }: { value: string; onChange: (s: string) => void }) => (
    <textarea aria-label="Message" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
jest.mock('@/components/admin/email/EmailPreview', () => ({
  EmailPreview: ({ html }: { html: string }) => <div data-testid="preview">{html}</div>,
}));

jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    getClubBroadcasts: jest.fn(),
    sendClubBroadcast: jest.fn(),
    previewClubBroadcast: jest.fn().mockResolvedValue({ html: '<html>preview</html>' }),
    adminUploadEmailImage: jest.fn().mockResolvedValue({ url: '/uploads/email-images/x.png' }),
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
    api.previewClubBroadcast.mockResolvedValue({ html: '<html>preview</html>' });
  });

  it('affiche le nombre de membres actifs après chargement', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/42 membres actifs/i)).toBeInTheDocument(),
    );
  });

  it("affiche un broadcast dans l'historique (texte brut)", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Tournoi de printemps')).toBeInTheDocument(),
    );
    expect(screen.getByText(/38 destinataires/i)).toBeInTheDocument();
  });

  it('appelle sendClubBroadcast avec le titre et le corps HTML saisis puis confirme', async () => {
    const { api } = require('@/lib/api');
    renderPage();
    await waitFor(() => screen.getByText(/42 membres actifs/i));

    fireEvent.change(screen.getByPlaceholderText(/titre du message/i), {
      target: { value: 'Mon titre' },
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: '<p>Mon message</p>' },
    });

    fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    const sendButtons = screen.getAllByRole('button', { name: /envoyer/i });
    fireEvent.click(sendButtons[sendButtons.length - 1]);

    await waitFor(() =>
      expect(api.sendClubBroadcast).toHaveBeenCalledWith(
        'club-demo',
        { title: 'Mon titre', bodyHtml: '<p>Mon message</p>', channels: { email: false, inApp: true, push: true } },
        't',
      ),
    );
  });

  const switchFor = (label: string) => screen.getByText(label).closest('[role="switch"]') as HTMLElement;

  it('Email est grisé/désactivé et non activable ; envoie cloche + push par défaut', async () => {
    const { api } = require('@/lib/api');
    renderPage();
    await waitFor(() => screen.getByText(/membres actifs/i));
    fireEvent.change(screen.getByPlaceholderText(/titre du message/i), { target: { value: 'T' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '<p>Corps</p>' } });

    // Email désactivé : off par défaut, cliquer ne l'active pas.
    expect(switchFor('Email')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(switchFor('Email'));
    expect(switchFor('Email')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    await waitFor(() => screen.getByRole('dialog'));
    const btns = screen.getAllByRole('button', { name: /envoyer/i });
    fireEvent.click(btns[btns.length - 1]);

    await waitFor(() =>
      expect(api.sendClubBroadcast).toHaveBeenCalledWith(
        'club-demo',
        expect.objectContaining({ channels: { email: false, inApp: true, push: true } }),
        't',
      ),
    );
  });

  it('couple le push à la cloche (décocher la cloche coupe le push)', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/membres actifs/i));
    fireEvent.click(switchFor("Notification dans l'appli"));
    expect(switchFor('Notification push')).toHaveAttribute('aria-checked', 'false');
  });

  it('désactive Envoyer si aucun canal actif (email déjà désactivé + cloche coupée)', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/membres actifs/i));
    fireEvent.change(screen.getByPlaceholderText(/titre du message/i), { target: { value: 'T' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '<p>Corps</p>' } });

    const btn = screen.getByRole('button', { name: /envoyer/i });
    expect(btn).not.toBeDisabled();                            // email off mais cloche on

    fireEvent.click(switchFor("Notification dans l'appli"));   // cloche off → push off → aucun canal
    expect(btn).toBeDisabled();
  });

  it("masque l'aperçu email et affiche la note (envoi email désactivé)", async () => {
    renderPage();
    await waitFor(() => screen.getByText(/membres actifs/i));
    expect(screen.queryByTestId('preview')).toBeNull();
    expect(screen.getByText(/email est temporairement désactivé/i)).toBeInTheDocument();
  });

  it('désactive le bouton Envoyer tant que le titre ou le corps est vide', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/42 membres actifs/i));

    const btn = screen.getByRole('button', { name: /envoyer/i });
    expect(btn).toBeDisabled();

    // Titre seul => toujours désactivé (corps vide).
    fireEvent.change(screen.getByPlaceholderText(/titre du message/i), {
      target: { value: 'Un titre' },
    });
    expect(btn).toBeDisabled();

    // Corps réel => activé.
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: '<p>Du contenu</p>' },
    });
    expect(btn).not.toBeDisabled();
  });
});
