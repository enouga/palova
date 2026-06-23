import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { LevelHistoryChart } from '@/components/player/LevelHistoryChart';
import { RatingPoint } from '@/lib/api';

const renderChart = (points: RatingPoint[]) =>
  render(<ThemeProvider><LevelHistoryChart points={points} /></ThemeProvider>);

it('mouvement réel : trace une courbe + puce de delta', () => {
  const { container } = renderChart([
    { playedAt: '2026-06-01T00:00:00Z', level: 3 },
    { playedAt: '2026-06-05T00:00:00Z', level: 3.6 },
    { playedAt: '2026-06-10T00:00:00Z', level: 4 },
  ]);
  // courbe tracée
  expect(container.querySelector('path')).toBeTruthy();
  // puce de delta : +1,0 sur 3 matchs
  expect(screen.getByText(/\+1,0/)).toBeInTheDocument();
  expect(screen.getByText(/3 matchs/)).toBeInTheDocument();
});

it('niveau plat : pas de courbe, état « stable »', () => {
  const { container } = renderChart([
    { playedAt: '2026-06-01T00:00:00Z', level: 3.0 },
    { playedAt: '2026-06-05T00:00:00Z', level: 3.05 },
  ]);
  expect(container.querySelector('path')).toBeNull();
  expect(screen.getByText(/stable/i)).toBeInTheDocument();
});

it('état vide', () => {
  renderChart([]);
  expect(screen.getByText(/Pas encore d.historique/i)).toBeInTheDocument();
});
