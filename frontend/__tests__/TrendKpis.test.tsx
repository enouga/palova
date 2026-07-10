import { render, screen } from '@testing-library/react';
import { TrendKpis } from '../components/admin/ventes/TrendKpis';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { TrendModel } from '@/lib/caisse';

const trend: TrendModel = {
  points: [
    { key: '2026-07-04', cents: 0 }, { key: '2026-07-05', cents: 1000 },
    { key: '2026-07-06', cents: 0 }, { key: '2026-07-07', cents: 2000 },
    { key: '2026-07-08', cents: 3000 }, { key: '2026-07-09', cents: 0 },
    { key: '2026-07-10', cents: 2000 },
  ],
  todayCents: 2000, prevWeekCents: 1000, deltaPct: 100,
};

const renderKpis = (over: Partial<React.ComponentProps<typeof TrendKpis>> = {}) =>
  render(<ThemeProvider><TrendKpis collectedCents={42550} outstanding="297.00" count={12} trend={trend} weekday="vendredi" {...over} /></ThemeProvider>);

it('affiche encaissé, reste dû et nombre d\'encaissements', () => {
  renderKpis();
  expect(screen.getByText('425,50 €')).toBeInTheDocument();
  expect(screen.getByText('297,00 €')).toBeInTheDocument();
  expect(screen.getByText('12')).toBeInTheDocument();
});

it('affiche le delta vs même jour S-1', () => {
  renderKpis();
  expect(screen.getByText(/vs vendredi dernier/)).toBeInTheDocument();
  expect(screen.getByText(/\+100\s*%/)).toBeInTheDocument();
});

it('masque le delta quand deltaPct est null', () => {
  renderKpis({ trend: { ...trend, deltaPct: null } });
  expect(screen.queryByText(/vs vendredi dernier/)).not.toBeInTheDocument();
});
