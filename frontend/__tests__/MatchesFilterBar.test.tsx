import { render, screen, fireEvent } from '@testing-library/react';
import { MatchesFilterBar } from '../components/openmatch/MatchesFilterBar';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { MatchAlert } from '../lib/api';

const noop = () => {};

const baseProps = {
  levelEnabled: true,
  authenticated: true,
  myLevel: null as number | null,
  myLevelMin: null as number | null,
  myLevelMax: null as number | null,
  fMin: 1,
  fMax: 8,
  onLevelChange: noop,
  kindFilter: 'all' as const,
  onKindChange: noop,
  resultCount: 0,
  alerts: [] as MatchAlert[],
  timezone: 'Europe/Paris',
  onDeleteAlert: noop,
  onCreateAlert: noop,
};

function renderBar(overrides: Partial<typeof baseProps> = {}) {
  return render(<ThemeProvider><MatchesFilterBar {...baseProps} {...overrides} /></ThemeProvider>);
}

describe('MatchesFilterBar', () => {
  it('affiche les chips Type de partie et notifie au clic', () => {
    const onKindChange = jest.fn();
    renderBar({ onKindChange });
    expect(screen.getByRole('button', { name: 'Toutes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compétitives' }));
    expect(onKindChange).toHaveBeenCalledWith('competitive');
    fireEvent.click(screen.getByRole('button', { name: 'Amicales' }));
    expect(onKindChange).toHaveBeenCalledWith('friendly');
  });

  it('affiche le compteur de parties au singulier et au pluriel', () => {
    const { rerender } = renderBar({ resultCount: 1 });
    expect(screen.getByText('1 partie')).toBeInTheDocument();
    rerender(<ThemeProvider><MatchesFilterBar {...baseProps} resultCount={3} /></ThemeProvider>);
    expect(screen.getByText('3 parties')).toBeInTheDocument();
  });

  it('le pied est masqué pour un anonyme sans filtre actif', () => {
    renderBar({ authenticated: false, levelEnabled: false, kindFilter: 'all' });
    expect(screen.queryByTestId('matches-filter-footer')).not.toBeInTheDocument();
  });

  it('le pied apparaît pour un anonyme dès qu\'un filtre Type est actif', () => {
    renderBar({ authenticated: false, levelEnabled: false, kindFilter: 'friendly', resultCount: 2 });
    expect(screen.getByTestId('matches-filter-footer')).toBeInTheDocument();
    expect(screen.getByText('2 parties')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /créer une alerte/i })).not.toBeInTheDocument();
  });

  it('masque le groupe Niveau si le club n\'a pas le système de niveau', () => {
    renderBar({ levelEnabled: false, myLevel: 5, myLevelMin: 4, myLevelMax: 6 });
    expect(screen.queryByRole('button', { name: 'Tous' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toutes' })).toBeInTheDocument();
  });

  it('masque le groupe Niveau pour un visiteur anonyme', () => {
    renderBar({ authenticated: false, myLevel: 5, myLevelMin: 4, myLevelMax: 6 });
    expect(screen.queryByRole('button', { name: 'Tous' })).not.toBeInTheDocument();
  });

  it('chip « À mon niveau » actif quand la fourchette correspond au préset', () => {
    renderBar({ myLevel: 5, myLevelMin: 4, myLevelMax: 6, fMin: 4, fMax: 6 });
    const chip = screen.getByRole('button', { name: /À mon niveau · 4–6/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('« Régler ▾ » déplie et replie le curseur de niveau', () => {
    renderBar({ myLevel: 5, myLevelMin: 4, myLevelMax: 6 });
    expect(screen.queryByLabelText('Niveau minimum')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Régler/ }));
    expect(screen.getByLabelText('Niveau minimum')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Régler/ }));
    expect(screen.queryByLabelText('Niveau minimum')).not.toBeInTheDocument();
  });

  it('fourchette personnalisée : le chip affiche « Niveau x–y » et devient actif', () => {
    renderBar({ myLevel: 5, myLevelMin: 4, myLevelMax: 6, fMin: 3, fMax: 6.5 });
    const chip = screen.getByRole('button', { name: /Niveau 3–6,5/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('affiche les chips d\'alertes actives et supprime au clic sur ✕', () => {
    const onDeleteAlert = jest.fn();
    const alerts: MatchAlert[] = [{
      id: 'al1', windowStart: '2026-07-17T16:00:00.000Z', windowEnd: '2026-07-17T19:00:00.000Z',
      targetLevelMin: null, targetLevelMax: null,
    }];
    renderBar({ alerts, onDeleteAlert });
    fireEvent.click(screen.getByRole('button', { name: "Supprimer l'alerte" }));
    expect(onDeleteAlert).toHaveBeenCalledWith('al1');
  });

  it('bouton « Créer une alerte » visible seulement pour un connecté', () => {
    const { rerender } = renderBar({ authenticated: true });
    expect(screen.getByRole('button', { name: /créer une alerte/i })).toBeInTheDocument();
    rerender(<ThemeProvider><MatchesFilterBar {...baseProps} authenticated={false} /></ThemeProvider>);
    expect(screen.queryByRole('button', { name: /créer une alerte/i })).not.toBeInTheDocument();
  });

  it('« Tous » et « À mon niveau » ne sont jamais actifs en même temps (fourchette « mon niveau » qui couvre toute l\'échelle)', () => {
    renderBar({ myLevel: 4.5, myLevelMin: 1, myLevelMax: 8, fMin: 1, fMax: 8 });
    expect(screen.getByRole('button', { name: /À mon niveau/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tous' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('affiche « 0 partie » quand le compteur est nul', () => {
    renderBar({ resultCount: 0 });
    expect(screen.getByText('0 partie')).toBeInTheDocument();
  });
});
