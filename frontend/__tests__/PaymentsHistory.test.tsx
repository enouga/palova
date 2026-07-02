import { render, screen, fireEvent } from '@testing-library/react';
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

it('limite à 5 paiements puis « Voir tout » déplie le reste', () => {
  const many: MyPayment[] = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}`, date: '2026-06-14T12:00:00.000Z', amountCents: 1300, refundedCents: 0,
    method: 'CARD', status: 'CAPTURED', label: `Réservation ${i}`,
  }));
  render(<PaymentsHistory payments={many} />);

  // Par défaut : 5 lignes visibles, les suivantes masquées.
  expect(screen.getByText('Réservation 0')).toBeInTheDocument();
  expect(screen.getByText('Réservation 4')).toBeInTheDocument();
  expect(screen.queryByText('Réservation 5')).not.toBeInTheDocument();

  // Déplier.
  fireEvent.click(screen.getByRole('button', { name: /Voir tout \(8\)/ }));
  expect(screen.getByText('Réservation 7')).toBeInTheDocument();

  // Replier.
  fireEvent.click(screen.getByRole('button', { name: /Réduire/ }));
  expect(screen.queryByText('Réservation 7')).not.toBeInTheDocument();
});

it('pas de bouton « Voir tout » si ≤ 5 paiements', () => {
  render(<PaymentsHistory payments={payments} />);
  expect(screen.queryByRole('button', { name: /Voir tout/ })).not.toBeInTheDocument();
});
