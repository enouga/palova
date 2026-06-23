import { render, screen } from '@testing-library/react';
import { ReliabilityMeter } from '../components/player/ReliabilityMeter';

it('affiche le pourcentage de fiabilité', () => {
  render(<ReliabilityMeter pct={62} />);
  expect(screen.getByText(/62\s*%/)).toBeInTheDocument();
});

it('expose un role meter avec aria-valuenow', () => {
  render(<ReliabilityMeter pct={62} />);
  const meter = screen.getByRole('meter');
  expect(meter).toHaveAttribute('aria-valuenow', '62');
});

it('borne les valeurs hors [0,100]', () => {
  render(<ReliabilityMeter pct={140} />);
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
});
