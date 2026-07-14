import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SuperAdminModerationPage from '@/app/superadmin/moderation/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));

jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    platformListReports: jest.fn(),
    platformResolveReport: jest.fn(),
    platformReportImage: jest.fn(),
  },
}));

const REPORT = {
  id: 'rep-2', reason: 'HARASSMENT', detail: null, status: 'OPEN', resolution: null,
  createdAt: '2026-07-14T10:00:00.000Z', resolvedAt: null,
  reporter: { id: 'r1', firstName: 'Marie', lastName: 'D' },
  message: { id: 'dm1', body: 'message privé signalé', deleted: false, createdAt: '2026-07-14T09:55:00.000Z', author: { id: 'a1', firstName: 'Léo', lastName: 'B' }, hasImage: false },
  conversationId: 'c1',
};

function renderPage() {
  const { api } = require('@/lib/api');
  api.platformListReports.mockResolvedValue({ items: [REPORT] });
  api.platformResolveReport.mockResolvedValue({ ...REPORT, status: 'RESOLVED', resolution: 'DELETED' });
  return render(<ThemeProvider><SuperAdminModerationPage /></ThemeProvider>);
}

it('affiche un signalement DM ouvert', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('message privé signalé')).toBeInTheDocument());
  expect(screen.getByText(/harcèlement/i)).toBeInTheDocument();
});

it('Supprimer le message appelle platformResolveReport DELETE après confirmation', async () => {
  const { api } = require('@/lib/api');
  renderPage();
  await waitFor(() => screen.getByText('message privé signalé'));
  fireEvent.click(screen.getByRole('button', { name: /supprimer le message/i }));
  fireEvent.click(screen.getByRole('button', { name: /^supprimer$/i }));
  await waitFor(() => expect(api.platformResolveReport).toHaveBeenCalledWith('rep-2', 'DELETE', 't'));
});

it('Rejeter appelle platformResolveReport REJECT', async () => {
  const { api } = require('@/lib/api');
  renderPage();
  await waitFor(() => screen.getByText('message privé signalé'));
  fireEvent.click(screen.getByRole('button', { name: /rejeter/i }));
  await waitFor(() => expect(api.platformResolveReport).toHaveBeenCalledWith('rep-2', 'REJECT', 't'));
});
