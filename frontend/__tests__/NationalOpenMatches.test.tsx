import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { NationalOpenMatches } from '@/components/platform/NationalOpenMatches';
import type { NationalOpenMatch } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p, // Avatar
}));

function makeMatch(over: Partial<NationalOpenMatch> = {}): NationalOpenMatch {
  return {
    id: 'm1',
    resourceName: 'Court 1',
    sport: { key: 'padel', name: 'Padel' },
    startTime: '2026-07-08T16:00:00.000Z',
    endTime: '2026-07-08T17:30:00.000Z',
    maxPlayers: 4,
    spotsLeft: 2,
    full: false,
    targetLevelMin: 4,
    targetLevelMax: 6,
    players: [
      { userId: 'org', firstName: 'Léa', lastName: 'Martin', avatarUrl: null, isOrganizer: true, team: 1, slot: 0 },
      { userId: 'p2', firstName: 'Tom', lastName: 'Durand', avatarUrl: null, isOrganizer: false, team: 2, slot: 0 },
    ],
    club: { slug: 'padel-arena-paris', name: 'Padel Arena Paris', city: 'Paris', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null },
    ...over,
  };
}

const wrap = (matches: NationalOpenMatch[]) =>
  render(<ThemeProvider><NationalOpenMatches matches={matches} /></ThemeProvider>);

describe('NationalOpenMatches', () => {
  it('rend une carte par partie : club · ville, places, sièges vides, lien cross-sous-domaine', () => {
    wrap([makeMatch()]);

    expect(screen.getByText('Padel Arena Paris')).toBeInTheDocument();
    expect(screen.getByText('· Paris')).toBeInTheDocument();
    expect(screen.getByText('2 places')).toBeInTheDocument();
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(2);
    expect(screen.getByText(/Niveau 4 à 6/)).toBeInTheDocument();

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', expect.stringContaining('padel-arena-paris.'));
    expect(link).toHaveAttribute('href', expect.stringContaining('/parties/m1'));
    expect(screen.getByText('Rejoindre →')).toBeInTheDocument();
  });

  it('sans fourchette de niveau → « Tous niveaux »', () => {
    wrap([makeMatch({ targetLevelMin: null, targetLevelMax: null })]);
    expect(screen.getByText(/Tous niveaux/)).toBeInTheDocument();
  });

  it('1 place restante → chip singulier', () => {
    wrap([makeMatch({
      spotsLeft: 1,
      players: [
        { userId: 'a', firstName: 'A', lastName: 'A', avatarUrl: null, isOrganizer: true, team: 1, slot: 0 },
        { userId: 'b', firstName: 'B', lastName: 'B', avatarUrl: null, isOrganizer: false, team: 1, slot: 1 },
        { userId: 'c', firstName: 'C', lastName: 'C', avatarUrl: null, isOrganizer: false, team: 2, slot: 0 },
      ],
    })]);
    expect(screen.getByText('1 place')).toBeInTheDocument();
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(1);
  });

  it('liste vide → rien rendu', () => {
    const { container } = wrap([]);
    expect(container.firstChild).toBeNull();
  });
});
