import { render, screen } from '@testing-library/react';
import { HomeHero } from '../components/platform/home/HomeHero';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('HomeHero', () => {
  it('salue par prénom et pose l\'accroche recherche (ne rejoue aucune réservation en vedette)', () => {
    wrap(<HomeHero firstName="Eric" />);
    expect(screen.getByText(/Bonjour Eric/)).toBeInTheDocument();
    expect(screen.getByText(/Où veux-tu jouer/)).toBeInTheDocument();
  });

  it('sans prénom → salutation générique', () => {
    wrap(<HomeHero firstName={null} />);
    expect(screen.getByText('Bonjour')).toBeInTheDocument();
    expect(screen.getByText(/Où veux-tu jouer/)).toBeInTheDocument();
  });
});
