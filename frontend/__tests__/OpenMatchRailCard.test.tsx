import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { OpenMatchRailCard, RailMatch } from '@/components/match/OpenMatchRailCard';

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p, // Avatar
}));

const CLUB = { name: 'Padel Arena Paris', city: 'Paris', accentColor: '#5e93da' };

function makeMatch(over: Partial<RailMatch> = {}): RailMatch {
  return {
    id: 'm1',
    resourceName: 'Court 1',
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
    ...over,
  };
}

const wrap = (m: RailMatch, opts: { club?: typeof CLUB | null; distanceKm?: number | null } = {}) =>
  render(<ThemeProvider>
    <OpenMatchRailCard match={m} club={opts.club} distanceKm={opts.distanceKm} href="/parties/m1" timezone="Europe/Paris" />
  </ThemeProvider>);

describe('OpenMatchRailCard', () => {
  it('avec club : nom du club, distance, sièges vides, lien', () => {
    wrap(makeMatch(), { club: CLUB, distanceKm: 3.4 });
    expect(screen.getByText('Padel Arena Paris')).toBeInTheDocument();
    expect(screen.getByText('· 3 km')).toBeInTheDocument();
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(2);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/parties/m1');
  });

  it('sans club : ni nom de club, ni liseré identitaire', () => {
    const { container } = wrap(makeMatch());
    expect(screen.queryByText('Padel Arena Paris')).not.toBeInTheDocument();
    expect(container.querySelector('[data-club-band]')).toBeNull();
  });

  it('chips type + genre : Pour de vrai par défaut, Pour le fun si competitive=false, Féminine', () => {
    const { unmount } = wrap(makeMatch({ gender: 'WOMEN' }));
    expect(screen.getByText('Pour de vrai')).toBeInTheDocument();
    expect(screen.getByText('Féminine')).toBeInTheDocument();
    unmount();
    wrap(makeMatch({ competitive: false }));
    expect(screen.getByText('Pour le fun')).toBeInTheDocument();
  });

  it('complet : chip Complet, CTA « Voir la partie », aucun siège vide', () => {
    wrap(makeMatch({
      full: true, spotsLeft: 0,
      players: [
        { userId: 'u1', firstName: 'A', lastName: 'A', avatarUrl: null, isOrganizer: true },
        { userId: 'u2', firstName: 'B', lastName: 'B', avatarUrl: null, isOrganizer: false },
        { userId: 'u3', firstName: 'C', lastName: 'C', avatarUrl: null, isOrganizer: false },
        { userId: 'u4', firstName: 'D', lastName: 'D', avatarUrl: null, isOrganizer: false },
      ],
    }));
    expect(screen.getByText('Complet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voir la partie/ })).toBeInTheDocument();
    expect(screen.queryAllByTestId('empty-seat')).toHaveLength(0);
  });

  it('non complet : CTA « Rejoindre → » et méta Tous niveaux sans fourchette', () => {
    wrap(makeMatch({ targetLevelMin: null, targetLevelMax: null }));
    expect(screen.getByText('Rejoindre →')).toBeInTheDocument();
    expect(screen.getByText(/Tous niveaux/)).toBeInTheDocument();
  });
});
