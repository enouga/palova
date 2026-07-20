import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { DiscoverMapBackground } from '@/components/discover/DiscoverMapBackground';

// ThemeProvider lit localStorage après montage (peut écraser defaultMode) — on nettoie
// pour que `defaultMode` fasse foi dans chaque test.
beforeEach(() => localStorage.clear());

describe('DiscoverMapBackground', () => {
  it('rend une couche décorative aria-hidden et non interactive', () => {
    render(<ThemeProvider defaultMode="daylight"><DiscoverMapBackground /></ThemeProvider>);
    const layer = screen.getByTestId('discover-map');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).toHaveStyle({ pointerEvents: 'none' });
  });

  it('bascule la palette selon le thème (le point des épingles = le ton du fond)', () => {
    const { unmount } = render(<ThemeProvider defaultMode="daylight"><DiscoverMapBackground /></ThemeProvider>);
    expect(screen.getAllByTestId('discover-pin-dot')[0]).toHaveAttribute('fill', '#eef1f5');
    unmount();
    render(<ThemeProvider defaultMode="floodlit"><DiscoverMapBackground /></ThemeProvider>);
    expect(screen.getAllByTestId('discover-pin-dot')[0]).toHaveAttribute('fill', '#111110');
  });

  it('reflète le mode courant via data-mode', () => {
    render(<ThemeProvider defaultMode="floodlit"><DiscoverMapBackground /></ThemeProvider>);
    expect(screen.getByTestId('discover-map')).toHaveAttribute('data-mode', 'floodlit');
  });
});
