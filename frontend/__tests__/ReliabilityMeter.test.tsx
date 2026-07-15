import { render, screen } from '@testing-library/react';
import { ReliabilityMeter } from '../components/player/ReliabilityMeter';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

it('affiche le pourcentage de fiabilité', () => {
  wrap(<ReliabilityMeter pct={62} />);
  expect(screen.getByText(/62\s*%/)).toBeInTheDocument();
});

it('expose un role meter avec aria-valuenow', () => {
  wrap(<ReliabilityMeter pct={62} />);
  const meter = screen.getByRole('meter');
  expect(meter).toHaveAttribute('aria-valuenow', '62');
});

it('borne les valeurs hors [0,100]', () => {
  wrap(<ReliabilityMeter pct={140} />);
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
});
