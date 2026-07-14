import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminModerationPage from '@/app/admin/moderation/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-demo', accentColor: '#d6ff3f' } }) }));

jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    adminListReports: jest.fn(),
    adminResolveReport: jest.fn(),
  },
}));

const REPORT = {
  id: 'rep-1', reason: 'SPAM', detail: 'gênant', status: 'OPEN', resolution: null,
  createdAt: '2026-07-14T10:00:00.000Z', resolvedAt: null,
  reporter: { id: 'r1', firstName: 'Marie', lastName: 'D' },
  message: { id: 'm1', body: 'contenu signalé', deleted: false, createdAt: '2026-07-14T09:55:00.000Z', author: { id: 'a1', firstName: 'Léo', lastName: 'B' } },
  match: { reservationId: 'resa-1', startTime: '2026-07-14T18:00:00.000Z', resourceName: 'Court 1' },
};

function renderPage() {
  const { api } = require('@/lib/api');
  api.adminListReports.mockResolvedValue({ items: [REPORT] });
  api.adminResolveReport.mockResolvedValue({ ...REPORT, status: 'RESOLVED', resolution: 'DELETED' });
  return render(<ThemeProvider><AdminModerationPage /></ThemeProvider>);
}

it('affiche un signalement ouvert avec l extrait du message et le motif', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('contenu signalé')).toBeInTheDocument());
  expect(screen.getByText(/spam/i)).toBeInTheDocument();
  expect(screen.getByText(/court 1/i)).toBeInTheDocument();
});

it('Supprimer le message appelle adminResolveReport avec DELETE après confirmation', async () => {
  const { api } = require('@/lib/api');
  renderPage();
  await waitFor(() => screen.getByText('contenu signalé'));
  fireEvent.click(screen.getByRole('button', { name: /supprimer le message/i }));
  fireEvent.click(screen.getByRole('button', { name: /^supprimer$/i }));
  await waitFor(() => expect(api.adminResolveReport).toHaveBeenCalledWith('club-demo', 'rep-1', 'DELETE', 't'));
});

it('Rejeter appelle adminResolveReport avec REJECT', async () => {
  const { api } = require('@/lib/api');
  renderPage();
  await waitFor(() => screen.getByText('contenu signalé'));
  fireEvent.click(screen.getByRole('button', { name: /rejeter/i }));
  await waitFor(() => expect(api.adminResolveReport).toHaveBeenCalledWith('club-demo', 'rep-1', 'REJECT', 't'));
});

it('erreur de chargement (ex: FORBIDDEN) affiche un message au lieu de « Aucun signalement » silencieux', async () => {
  const { api } = require('@/lib/api');
  api.adminListReports.mockRejectedValue(new Error('FORBIDDEN'));
  render(<ThemeProvider><AdminModerationPage /></ThemeProvider>);
  expect(await screen.findByText(/réservée aux administrateurs/i)).toBeInTheDocument();
  expect(screen.queryByText('Aucun signalement.')).not.toBeInTheDocument();
});
