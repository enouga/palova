import { render, screen } from '@testing-library/react';
import { LevelHistoryChart } from '@/components/player/LevelHistoryChart';

it('rend une courbe avec des points', () => {
  const { container } = render(<LevelHistoryChart points={[
    { playedAt: '2026-06-01T00:00:00Z', level: 3 },
    { playedAt: '2026-06-05T00:00:00Z', level: 3.6 },
    { playedAt: '2026-06-10T00:00:00Z', level: 4 },
  ]} />);
  expect(container.querySelector('svg')).toBeTruthy();
  expect(container.querySelectorAll('circle').length).toBe(3);
});

it('état vide', () => {
  render(<LevelHistoryChart points={[]} />);
  expect(screen.getByText(/Pas encore d.historique/i)).toBeInTheDocument();
});
