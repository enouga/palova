import { render, screen } from '@testing-library/react';
import { WalletSection } from '@/components/profile/WalletSection';
import type { MemberPackage, Subscription } from '@/lib/api';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { surface: '#fff', surface2: '#eee', line: '#ddd', text: '#000', textMute: '#555', textFaint: '#999', fontUI: 'ui', accent: '#06c', onAccent: '#fff' } }),
}));

const wallet: MemberPackage = { id: 'w1', kind: 'WALLET', creditsTotal: null, creditsRemaining: null, amountTotal: '50.00', amountRemaining: '53.50', purchasedAt: '2026-01-01', expiresAt: null, template: { name: 'Porte-monnaie' } };
const sub = { id: 's1', planId: 'p1', status: 'ACTIVE', startedAt: '2026-01-01', expiresAt: '2026-12-31', monthlyPriceSnapshot: '30.00', sportKeys: ['padel'], offPeakOnly: false, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null, plan: { name: 'Mensuel' } } as Subscription;

it('affiche soldes et abonnements', () => {
  render(<WalletSection packages={[wallet]} subscriptions={[sub]} />);
  expect(screen.getByText(/Porte-monnaie/)).toBeInTheDocument();
  expect(screen.getByText(/53,50/)).toBeInTheDocument();
  expect(screen.getByText('Mensuel')).toBeInTheDocument();
});

it('état vide neutre', () => {
  render(<WalletSection packages={[]} subscriptions={[]} />);
  expect(screen.getByText(/Aucun solde|Aucun abonnement|rien/i)).toBeInTheDocument();
});
