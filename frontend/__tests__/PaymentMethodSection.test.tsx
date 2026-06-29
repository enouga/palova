import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PaymentMethodSection } from '@/components/profile/PaymentMethodSection';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { surface: '#fff', surface2: '#eee', line: '#ddd', lineStrong: '#bbb', text: '#000', textMute: '#555', textFaint: '#999', fontUI: 'ui', fontDisplay: 'd', accent: '#06c', onAccent: '#fff', bgElev: '#fff' } }),
}));
jest.mock('@/lib/api', () => ({
  api: { getMyPaymentMethod: jest.fn(), removeMyPaymentMethod: jest.fn() },
}));
import { api } from '@/lib/api';

it('affiche la carte puis la retire', async () => {
  (api.getMyPaymentMethod as jest.Mock).mockResolvedValue({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2027 });
  (api.removeMyPaymentMethod as jest.Mock).mockResolvedValue({ ok: true });
  render(<PaymentMethodSection slug="demo" token="t" />);
  expect(await screen.findByText(/Visa •••• 4242/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Retirer/i }));
  fireEvent.click(screen.getByRole('button', { name: /Confirmer|Retirer ma carte/i }));
  await waitFor(() => expect(api.removeMyPaymentMethod).toHaveBeenCalledWith('demo', 't'));
});

it('état vide si pas de carte', async () => {
  (api.getMyPaymentMethod as jest.Mock).mockResolvedValue(null);
  render(<PaymentMethodSection slug="demo" token="t" />);
  expect(await screen.findByText(/Aucune carte/i)).toBeInTheDocument();
});
