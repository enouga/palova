import { render, screen } from '@testing-library/react';
import { PaymentsHistory } from '@/components/profile/PaymentsHistory';
import type { MyPayment } from '@/lib/api';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { surface: '#fff', surface2: '#eee', line: '#ddd', text: '#000', textMute: '#555', textFaint: '#999', fontUI: 'ui' } }),
}));

const payments: MyPayment[] = [
  { id: 'p1', date: '2026-06-14T12:00:00.000Z', amountCents: 2500, refundedCents: 0, method: 'CARD', status: 'CAPTURED', label: 'Réservation Court 2 · 14/06/2026' },
  { id: 'p2', date: '2026-06-01T09:00:00.000Z', amountCents: 8000, refundedCents: 1000, method: 'ONLINE', status: 'PARTIALLY_REFUNDED', label: 'Achat — Carnet 10' },
];

it('liste les paiements avec montant et libellé', () => {
  render(<PaymentsHistory payments={payments} />);
  expect(screen.getByText('Réservation Court 2 · 14/06/2026')).toBeInTheDocument();
  expect(screen.getByText('25,00 €')).toBeInTheDocument();
  expect(screen.getByText(/remboursé/i)).toBeInTheDocument(); // p2 a un refund
});

it('état vide', () => {
  render(<PaymentsHistory payments={[]} />);
  expect(screen.getByText(/Aucun paiement/i)).toBeInTheDocument();
});
