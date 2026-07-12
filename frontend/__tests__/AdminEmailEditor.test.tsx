import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EmailEditorPage from '@/app/admin/emails/[type]/page';

jest.mock('next/navigation', () => ({ useParams: () => ({ type: 'registration.confirmed' }), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { fontUI: '', fontDisplay: '', text: '#000', textMute: '#555', textFaint: '#999', bg: '#fff', bgElev: '#fff', line: '#eee', accent: '#06c' } }) }));

// Double léger de l'éditeur riche : textarea contrôlée qui parle le format stocké.
jest.mock('@/components/admin/email/RichEmailEditor', () => ({
  RichEmailEditor: ({ value, onChange }: { value: string; onChange: (s: string) => void }) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const detail = {
  type: 'registration.confirmed', group: 'inscriptions', title: 'Inscription confirmée', description: 'd', hasCta: true,
  vars: [{ key: 'prenom', label: 'Prénom', sample: 'Marie' }, { key: 'activite', label: 'Activité', sample: 'Tournoi' }],
  defaults: { subject: 'Inscription confirmée — {{activite}}', heading: 'Inscription confirmée', bodyHtml: '<p>Bonjour {{prenom}}</p>', ctaLabel: 'Voir' },
  override: null,
};
const saveMock = jest.fn().mockResolvedValue({ unknownVars: [] });
const previewMock = jest.fn().mockResolvedValue({ subject: 's', html: '<html><body>aperçu</body></html>' });
jest.mock('@/lib/api', () => ({
  api: {
    adminGetEmail: jest.fn(() => Promise.resolve(detail)),
    adminSaveEmail: (...a: unknown[]) => saveMock(...a),
    adminResetEmail: jest.fn().mockResolvedValue({ ok: true }),
    adminPreviewEmail: (...a: unknown[]) => previewMock(...a),
    adminTestEmail: jest.fn().mockResolvedValue({ ok: true }),
    adminUploadEmailImage: jest.fn().mockResolvedValue({ url: '/uploads/email-images/x.png' }),
  },
}));

describe('EmailEditorPage', () => {
  beforeEach(() => { saveMock.mockClear(); previewMock.mockClear(); });

  it('charge les défauts (format stocké) et enregistre le brouillon', async () => {
    render(<EmailEditorPage />);
    await waitFor(() => expect(screen.getByDisplayValue('Inscription confirmée — {{activite}}')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const draft = saveMock.mock.calls[0][2];
    expect(draft.subject).toBe('Inscription confirmée — {{activite}}');
    expect(draft.bodyHtml).toBe('<p>Bonjour {{prenom}}</p>');
  });

  it('une modification du corps part au format stocké et déclenche l\'aperçu', async () => {
    render(<EmailEditorPage />);
    const body = await screen.findByDisplayValue('<p>Bonjour {{prenom}}</p>');
    fireEvent.change(body, { target: { value: '<p>Salut {{prenom}} !</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][2].bodyHtml).toBe('<p>Salut {{prenom}} !</p>');
    await waitFor(() => expect(previewMock).toHaveBeenCalled());
  });
});
