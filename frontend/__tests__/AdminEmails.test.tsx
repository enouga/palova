import { render, screen, waitFor } from '@testing-library/react';
import AdminEmailsPage from '@/app/admin/emails/page';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { fontUI: '', fontDisplay: '', text: '#000', textMute: '#555', textFaint: '#999', bg: '#fff', bgElev: '#fff', line: '#eee', accent: '#06c' } }) }));
jest.mock('@/lib/api', () => ({
  api: {
    adminListEmails: jest.fn().mockResolvedValue({ items: [
      { type: 'registration.confirmed', group: 'inscriptions', title: 'Inscription confirmée', description: 'd', customized: true },
      { type: 'payment.refunded', group: 'paiement', title: 'Remboursement', description: 'd', customized: false },
    ] }),
  },
}));

describe('AdminEmailsPage', () => {
  it('affiche les gabarits groupés avec badge Personnalisé/Défaut', async () => {
    render(<AdminEmailsPage />);
    await waitFor(() => expect(screen.getByText('Inscription confirmée')).toBeInTheDocument());
    expect(screen.getByText('Remboursement')).toBeInTheDocument();
    expect(screen.getByText('Personnalisé')).toBeInTheDocument();
    expect(screen.getByText('Défaut')).toBeInTheDocument();
  });
});
