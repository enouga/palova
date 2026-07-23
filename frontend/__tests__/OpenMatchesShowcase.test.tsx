import { render, screen } from '@testing-library/react';
import { OpenMatchesShowcase } from '@/components/clubhouse/OpenMatchesShowcase';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { OpenMatch } from '@/lib/api';

const match = (over: Partial<OpenMatch>): OpenMatch => ({
  id: 'm1', resourceName: 'Terrain 1', startTime: '2026-07-06T18:00:00Z', endTime: '2026-07-06T19:30:00Z',
  maxPlayers: 4, spotsLeft: 3, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [{ userId: 'u1', firstName: 'Ana', lastName: 'B', avatarUrl: null, isOrganizer: true }],
  targetLevelMin: 4, targetLevelMax: 6, lastMessageAt: null, unreadCount: 0, messageCount: 0, ...over,
});

const wrap = (matches: OpenMatch[]) =>
  render(<ThemeProvider><OpenMatchesShowcase matches={matches} timezone="Europe/Paris" /></ThemeProvider>);

describe('OpenMatchesShowcase', () => {
  it('carte : sièges vides dessinés (maxPlayers - inscrits), niveau, CTA Rejoindre → /parties/[id]', () => {
    wrap([match({})]);
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(3);
    expect(screen.getByText(/Niveau 4 à 6/)).toBeInTheDocument();
    expect(screen.getByText(/3 places/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Rejoindre la partie/ })).toHaveAttribute('href', '/parties/m1');
  });

  it('pas de lien « Toutes les parties » (retiré, doublon avec la nav)', () => {
    wrap([match({})]);
    expect(screen.queryByRole('link', { name: /Toutes/i })).toBeNull();
  });

  it('affiche le genre (Féminine) dans la méta de la carte', () => {
    wrap([match({ gender: 'WOMEN' })]);
    expect(screen.getByText(/Féminine/)).toBeInTheDocument();
  });

  it('1 place restante → chip singulier (urgence)', () => {
    wrap([match({ spotsLeft: 1, players: [
      { userId: 'u1', firstName: 'A', lastName: 'A', avatarUrl: null, isOrganizer: true },
      { userId: 'u2', firstName: 'B', lastName: 'B', avatarUrl: null, isOrganizer: false },
      { userId: 'u3', firstName: 'C', lastName: 'C', avatarUrl: null, isOrganizer: false },
    ] })]);
    expect(screen.getByText('1 place')).toBeInTheDocument();
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(1);
  });

  it('partie complète → chip Complet + CTA « Voir la partie », aucun siège vide', () => {
    wrap([match({ spotsLeft: 0, full: true, players: [
      { userId: 'u1', firstName: 'A', lastName: 'A', avatarUrl: null, isOrganizer: true },
      { userId: 'u2', firstName: 'B', lastName: 'B', avatarUrl: null, isOrganizer: false },
      { userId: 'u3', firstName: 'C', lastName: 'C', avatarUrl: null, isOrganizer: false },
      { userId: 'u4', firstName: 'D', lastName: 'D', avatarUrl: null, isOrganizer: false },
    ] })]);
    expect(screen.getByText('Complet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voir la partie/ })).toHaveAttribute('href', '/parties/m1');
    expect(screen.queryAllByTestId('empty-seat')).toHaveLength(0);
  });

  it('plafond 6 cartes ; rien si aucune partie', () => {
    wrap(Array.from({ length: 8 }, (_, i) => match({ id: `m${i}` })));
    expect(screen.getAllByRole('link', { name: /Rejoindre la partie/ })).toHaveLength(6);
    const { container } = wrap([]);
    expect(container.firstChild).toBeNull();
  });

  it('sans fourchette de niveau, pas de mention Niveau', () => {
    wrap([match({ targetLevelMin: null, targetLevelMax: null })]);
    expect(screen.queryByText(/Niveau/)).not.toBeInTheDocument();
  });

  it('affiche le compteur de résultats', () => {
    wrap([match({})]);
    expect(screen.getByText('1 partie')).toBeInTheDocument();
  });

  it('le compteur reflète le plafond de 6 cartes, pas le total réel', () => {
    wrap(Array.from({ length: 8 }, (_, i) => match({ id: `m${i}` })));
    expect(screen.getByText('6 parties')).toBeInTheDocument();
  });
});
