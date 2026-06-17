import { render, screen, fireEvent } from '@testing-library/react';
import { LevelSourceNote, LEVEL_SOURCE_PLAIN, LEVEL_SOURCE_HUMOR } from '../components/player/LevelSourceNote';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (humor?: boolean) =>
  render(<ThemeProvider><LevelSourceNote humor={humor} /></ThemeProvider>);

describe('LevelSourceNote', () => {
  it('crédite « grille Padel Magazine » (variante sobre)', () => {
    wrap();
    expect(screen.getByText('grille Padel Magazine')).toBeInTheDocument();
  });

  it('variante humour : crédite Padel Magazine + clin d’œil maison', () => {
    wrap(true);
    expect(screen.getByText('grille Padel Magazine')).toBeInTheDocument();
    expect(screen.getByText(/l'humour est maison/)).toBeInTheDocument();
  });

  it('clic → ouvre la grille des niveaux (feuille, contenu complet)', () => {
    wrap();
    expect(screen.queryByRole('dialog', { name: /Grille des niveaux/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog', { name: /Grille des niveaux/ })).toBeInTheDocument();
    expect(screen.getByText('Intermédiaire')).toBeInTheDocument(); // un palier
    expect(screen.getByText(/P50 et P100/)).toBeInTheDocument();    // volet compétition
  });

  it('les deux mentions créditent Padel Magazine', () => {
    expect(LEVEL_SOURCE_PLAIN).toMatch(/Padel Magazine/);
    expect(LEVEL_SOURCE_HUMOR).toMatch(/Padel Magazine/);
  });
});
