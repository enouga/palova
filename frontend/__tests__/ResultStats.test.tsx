import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ResultStats } from '@/components/player/ResultStats';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

it('affiche matchs, taux, V/D et pastille de série (victoires)', () => {
  wrap(<ResultStats wins={18} losses={7} streak={3} tone="onSurface" />);
  expect(screen.getByText(/25 matchs/i)).toBeInTheDocument();
  expect(screen.getByText(/72\s*% de victoires/i)).toBeInTheDocument();
  expect(screen.getByText(/18 V/)).toBeInTheDocument();
  expect(screen.getByText(/3 victoires d'affilée/i)).toBeInTheDocument();
});

it('série de défaites → pastille "défaites"', () => {
  wrap(<ResultStats wins={10} losses={12} streak={-2} tone="onSurface" />);
  expect(screen.getByText(/2 défaites d'affilée/i)).toBeInTheDocument();
});

it('ne rend rien sans match décidé', () => {
  const { container } = wrap(<ResultStats wins={0} losses={0} streak={0} tone="onSurface" />);
  expect(container).toBeEmptyDOMElement();
});
