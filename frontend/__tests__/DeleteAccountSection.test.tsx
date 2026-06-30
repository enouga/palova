import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteAccountSection } from '@/components/profile/DeleteAccountSection';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { surface: '#fff', surface2: '#eee', line: '#ddd', lineStrong: '#bbb', text: '#000', textMute: '#555', textFaint: '#999', fontUI: 'ui', fontDisplay: 'd', accent: '#06c', onAccent: '#fff', bgElev: '#fff' } }),
}));
const logout = jest.fn();
jest.mock('@/lib/useAuth', () => ({ logout: () => logout() }));
jest.mock('@/lib/api', () => ({ api: { getAccountDeletionSummary: jest.fn(), deleteMyAccount: jest.fn() } }));
import { api } from '@/lib/api';

beforeEach(() => { logout.mockReset(); (api.deleteMyAccount as jest.Mock).mockReset(); });

it('bloque si je gère un club (unique OWNER)', async () => {
  (api.getAccountDeletionSummary as jest.Mock).mockResolvedValue({ blockingClubs: ['Club A'], futureReservations: 0, activeSubscriptions: 0, balances: [] });
  render(<DeleteAccountSection token="t" />);
  fireEvent.click(await screen.findByRole('button', { name: /Supprimer mon compte/i }));
  expect(screen.getByText(/Club A/)).toBeInTheDocument();
  // bouton de confirmation désactivé
  const confirm = screen.getByRole('button', { name: /Supprimer définitivement|Confirmer/i });
  expect(confirm).toBeDisabled();
});

it('supprime après saisie du mot de passe puis logout', async () => {
  (api.getAccountDeletionSummary as jest.Mock).mockResolvedValue({ blockingClubs: [], futureReservations: 2, activeSubscriptions: 1, balances: ['Porte-monnaie — 10,00 €'] });
  (api.deleteMyAccount as jest.Mock).mockResolvedValue({ ok: true });
  render(<DeleteAccountSection token="t" />);
  fireEvent.click(await screen.findByRole('button', { name: /Supprimer mon compte/i }));
  expect(screen.getByText(/2 réservation/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/mot de passe/i), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: /Supprimer définitivement|Confirmer/i }));
  await waitFor(() => expect(api.deleteMyAccount).toHaveBeenCalledWith('password123', 't'));
  await waitFor(() => expect(logout).toHaveBeenCalled());
});
