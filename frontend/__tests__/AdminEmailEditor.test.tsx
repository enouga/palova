import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EmailEditorPage from '@/app/admin/emails/[type]/page';

jest.mock('next/navigation', () => ({ useParams: () => ({ type: 'registration.confirmed' }), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { fontUI: '', fontDisplay: '', text: '#000', textMute: '#555', textFaint: '#999', bg: '#fff', bgElev: '#fff', line: '#eee', accent: '#06c' } }) }));

const detail = {
  type: 'registration.confirmed', group: 'inscriptions', title: 'Inscription confirmée', description: 'd', hasCta: true,
  vars: [{ key: 'prenom', label: 'Prénom', sample: 'Marie' }, { key: 'activite', label: 'Activité', sample: 'Tournoi' }],
  defaults: { subject: 'Inscription confirmée — {{activite}}', heading: 'Inscription confirmée', bodyHtml: '<p>Bonjour {{prenom}}</p>', ctaLabel: 'Voir' },
  override: null,
};
const saveMock = jest.fn().mockResolvedValue({ unknownVars: [] });
jest.mock('@/lib/api', () => ({
  api: {
    adminGetEmail: jest.fn(() => Promise.resolve(detail)),
    adminSaveEmail: (...a: any[]) => saveMock(...a),
    adminResetEmail: jest.fn().mockResolvedValue({ ok: true }),
    adminPreviewEmail: jest.fn().mockResolvedValue({ subject: 's', html: '<html><body>aperçu</body></html>' }),
    adminTestEmail: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

describe('EmailEditorPage', () => {
  it('charge les défauts et permet d\'insérer une variable et de sauver', async () => {
    render(<EmailEditorPage />);
    await waitFor(() => expect(screen.getByDisplayValue('Inscription confirmée — {{activite}}')).toBeInTheDocument());
    // chip variable présent
    expect(screen.getByRole('button', { name: '{{prenom}}' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
  });
});
