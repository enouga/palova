import { render, screen, fireEvent } from '@testing-library/react';
import { DayJournal } from '../components/admin/ventes/DayJournal';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { CaissePayment, PaymentMethod } from '@/lib/api';

const pay = (over: Partial<CaissePayment>): CaissePayment => ({
  id: 'p1', amount: '25.00', method: 'CASH' as PaymentMethod, participantId: null,
  payerName: 'Karim B.', note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null,
  createdAt: '2026-07-10T15:30:00.000Z', status: 'CAPTURED', refundedAmount: '0.00', receiptNo: null,
  reservation: { id: 'rv-1', startTime: '2026-07-10T15:00:00.000Z', resource: { name: 'Padel 1' }, user: { firstName: 'Karim', lastName: 'B.' } },
  memberPackage: null, ...over,
});
const sale = pay({ id: 'p2', amount: '90.00', method: 'CARD' as PaymentMethod, reservation: null,
  createdAt: '2026-07-10T16:00:00.000Z', // 18:00 Paris — distinct from the resa row so '17:30' is unique
  memberPackage: { id: 'mp', kind: 'ENTRIES', user: { firstName: 'Marie', lastName: 'Dupont' }, template: { name: 'Carnet 10' } } });

const base = {
  payments: [pay({}), sale], tz: 'Europe/Paris',
  totalsByMethod: { CASH: '25.00', CARD: '90.00' } as Record<string, string>,
  filter: 'all' as const, onFilter: jest.fn(), onReceipt: jest.fn(), onRefund: jest.fn(), busy: false,
};
const renderJ = (over = {}) => render(<ThemeProvider><DayJournal {...base} {...over} /></ThemeProvider>);

it('liste les encaissements avec heure locale et montant', () => {
  renderJ();
  expect(screen.getByText('17:30')).toBeInTheDocument();      // 15:30 UTC → 17:30 Paris
  expect(screen.getByText('90,00 €')).toBeInTheDocument();
});

it('filtre « Ventes » ne garde que les paiements sans réservation', () => {
  renderJ({ filter: 'sales' });
  expect(screen.getByText(/Marie Dupont/)).toBeInTheDocument();
  expect(screen.queryByText(/Padel 1/)).not.toBeInTheDocument();
});

it('filtre « Résas » ne garde que les paiements liés à une réservation', () => {
  renderJ({ filter: 'resa' });
  expect(screen.getByText(/Padel 1/)).toBeInTheDocument();
  expect(screen.queryByText(/Marie Dupont/)).not.toBeInTheDocument();
});

it('clic sur un onglet de filtre remonte onFilter', () => {
  const onFilter = jest.fn();
  renderJ({ onFilter });
  fireEvent.click(screen.getByRole('button', { name: 'Ventes' }));
  expect(onFilter).toHaveBeenCalledWith('sales');
});

it('carte « Compter la caisse » montre un chip par moyen d\'argent avec son total', () => {
  renderJ();
  expect(screen.getByText(/Espèces 25/)).toBeInTheDocument();
  expect(screen.getByText(/Carte 90/)).toBeInTheDocument();
});
