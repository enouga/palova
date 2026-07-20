import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminSupportPage from '@/app/admin/support/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ slug: 'padel-arena-paris', club: { id: 'club-demo', name: 'Padel Arena Paris', accentColor: '#d6ff3f' } }) }));

jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: { adminCreateSupportTicket: jest.fn(), getClubFaq: jest.fn().mockResolvedValue({ socle: [], custom: [] }) },
}));

jest.mock('@/components/ui/Markdown', () => ({ Markdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

beforeEach(() => {
  const { api } = require('@/lib/api');
  api.adminCreateSupportTicket.mockClear();
});

function renderPage() {
  return render(<ThemeProvider><AdminSupportPage /></ThemeProvider>);
}

function fillAndSubmit() {
  fireEvent.click(screen.getByRole('button', { name: 'Bug' }));
  fireEvent.change(screen.getByLabelText('Sujet'), { target: { value: 'Planning cassé' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Le planning ne charge plus sur mobile.' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
}

it('affiche la FAQ gérant (PLATFORM_FAQ) et la note de transparence', () => {
  renderPage();
  expect(screen.getByText("Qu'est-ce que Palova ?")).toBeInTheDocument();
  expect(screen.getByText(/votre nom, votre email et le nom du club sont transmis/i)).toBeInTheDocument();
});

it('envoie le ticket et affiche le numéro', async () => {
  const { api } = require('@/lib/api');
  api.adminCreateSupportTicket.mockResolvedValue({ number: 42 });
  renderPage();
  fillAndSubmit();
  await waitFor(() => expect(api.adminCreateSupportTicket).toHaveBeenCalledWith(
    'club-demo',
    { category: 'BUG', subject: 'Planning cassé', description: 'Le planning ne charge plus sur mobile.' },
    't',
  ));
  expect(await screen.findByText(/#42/)).toBeInTheDocument();
});

it('succès sans numéro (repli backend) : message sans référence', async () => {
  const { api } = require('@/lib/api');
  api.adminCreateSupportTicket.mockResolvedValue({ number: null });
  renderPage();
  fillAndSubmit();
  const status = await screen.findByRole('status');
  expect(status.textContent).toMatch(/demande transmise/i);
  expect(status.textContent).not.toContain('#');
});

it('RATE_LIMITED → message dédié', async () => {
  const { api } = require('@/lib/api');
  api.adminCreateSupportTicket.mockRejectedValue(new Error('RATE_LIMITED'));
  renderPage();
  fillAndSubmit();
  expect(await screen.findByText(/réessayez dans une heure/i)).toBeInTheDocument();
});

it('validation locale : sujet trop court → pas d appel API', () => {
  const { api } = require('@/lib/api');
  renderPage();
  fireEvent.change(screen.getByLabelText('Sujet'), { target: { value: 'ab' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Une description valide.' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
  expect(screen.getByText(/3 caractères min/i)).toBeInTheDocument();
  expect(api.adminCreateSupportTicket).not.toHaveBeenCalled();
});
