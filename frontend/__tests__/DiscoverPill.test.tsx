import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// Import après le mock (le composant lit useRouter au montage).
import { DiscoverPill } from '@/components/platform/home/DiscoverPill';

const wrap = () => render(<ThemeProvider><DiscoverPill /></ThemeProvider>);

describe('DiscoverPill (porte Où jouer)', () => {
  beforeEach(() => { push.mockClear(); });

  it('clic sur la porte → /decouvrir', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /Où jouer · clubs, parties, tournois/ }));
    expect(push).toHaveBeenCalledWith('/decouvrir');
  });

  it('plus de recherche embarquée : ni champ de saisie ni « Autour de moi » (la pilule blanche est la signature exclusive de /decouvrir)', () => {
    wrap();
    expect(screen.queryByPlaceholderText('Ville, code postal ou département')).toBeNull();
    expect(screen.queryByRole('button', { name: /Autour de moi/ })).toBeNull();
  });

  it('l\'icône France est décorative (aria-hidden)', () => {
    wrap();
    expect(screen.getByTestId('france-icon')).toHaveAttribute('aria-hidden', 'true');
  });
});
