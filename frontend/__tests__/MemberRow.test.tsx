import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { MemberRow } from '../components/admin/members/MemberRow';
import type { Member } from '../lib/api';

jest.mock('../lib/api', () => ({ assetUrl: (u: string | null) => u }));

const NOW = Date.UTC(2026, 6, 13); // 2026-07-13
const base: Member = {
  id: 'm1', userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr', phone: null,
  isSubscriber: true, membershipNo: null, status: 'ACTIVE', note: null, watch: false,
  hasActiveSubscription: true, subscriptionPlan: 'Padel illimité', avatarUrl: null, level: null,
  subscription: { id: 'sub-1', planId: 'p1', planName: 'Padel illimité', expiresAt: '2026-07-21T00:00:00Z', monthlyPriceSnapshot: '39.00', sportKeys: ['padel'] },
};
const wrap = (props: Partial<Parameters<typeof MemberRow>[0]> = {}) => render(
  <ThemeProvider>
    <MemberRow m={base} selected={false} nowMs={NOW} onOpen={jest.fn()} {...props} />
  </ThemeProvider>,
);

it('clic sur la ligne → onOpen (une seule zone cliquable)', () => {
  const onOpen = jest.fn();
  wrap({ onOpen });
  screen.getByRole('button', { name: 'Ouvrir la fiche de Jean Dupont' }).click();
  expect(onOpen).toHaveBeenCalled();
});

it('hors contexte abonnés : pas de pastille échéance', () => {
  wrap();
  expect(screen.queryByText(/Expire dans/)).not.toBeInTheDocument();
  expect(screen.queryByText(/échéance/)).not.toBeInTheDocument();
});

it('en contexte abonnés : pastille échéance (compte à rebours si proche)', () => {
  wrap({ subscriptionContext: true });
  expect(screen.getByText(/Expire dans 8 j/)).toBeInTheDocument(); // 21/07 − 13/07 = 8 j
  expect(screen.getByText(/échéance/)).toBeInTheDocument();
});

it('abonné lointain : pastille « Actif » (pas de compte à rebours)', () => {
  wrap({ subscriptionContext: true, m: { ...base, subscription: { ...base.subscription!, expiresAt: '2027-01-01T00:00:00Z' } } });
  expect(screen.getByText('Actif')).toBeInTheDocument();
  expect(screen.queryByText(/Expire dans/)).not.toBeInTheDocument();
});
