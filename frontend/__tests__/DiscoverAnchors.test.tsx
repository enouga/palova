import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { DiscoverAnchors } from '@/components/discover/DiscoverAnchors';

const items = [
  { id: 'parties', label: 'Parties', count: 4 },
  { id: 'tournois', label: 'Tournois', count: 2 },
  { id: 'clubs', label: 'Clubs', count: null }, // null = compteur inconnu (pas encore chargé)
];

it('rend une ancre par section avec compteur (masqué si null)', () => {
  render(<ThemeProvider><DiscoverAnchors items={items} active="parties" onJump={jest.fn()} /></ThemeProvider>);
  expect(screen.getByRole('button', { name: 'Parties 4' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tournois 2' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Clubs' })).toBeInTheDocument(); // pas de compteur
});

it('signale la section active (aria-current)', () => {
  render(<ThemeProvider><DiscoverAnchors items={items} active="tournois" onJump={jest.fn()} /></ThemeProvider>);
  expect(screen.getByRole('button', { name: 'Tournois 2' })).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('button', { name: 'Parties 4' })).not.toHaveAttribute('aria-current');
});

it('clic → onJump(id)', () => {
  const onJump = jest.fn();
  render(<ThemeProvider><DiscoverAnchors items={items} active="parties" onJump={onJump} /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Clubs' }));
  expect(onJump).toHaveBeenCalledWith('clubs');
});
