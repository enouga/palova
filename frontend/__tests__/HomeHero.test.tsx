import { render, screen } from '@testing-library/react';
import { HomeHero } from '../components/platform/home/HomeHero';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('HomeHero', () => {
  it('salue par prénom et pose l\'en-tête tableau de bord (plus d\'accroche recherche)', () => {
    wrap(<HomeHero firstName="Eric" />);
    expect(screen.getByText(/Bonjour Eric/)).toBeInTheDocument();
    expect(screen.getByText(/Prêt à jouer/)).toBeInTheDocument();
    expect(screen.getByText(/Ton agenda, tes clubs et tes parties/)).toBeInTheDocument();
    // L'ancienne accroche recherche a déménagé dans la porte Découvrir.
    expect(screen.queryByText(/Où veux-tu jouer/)).toBeNull();
  });

  it('sans prénom → salutation générique', () => {
    wrap(<HomeHero firstName={null} />);
    expect(screen.getByText('Bonjour')).toBeInTheDocument();
    expect(screen.getByText(/Prêt à jouer/)).toBeInTheDocument();
  });
});
