import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { NationalMatchCard } from '@/components/platform/NationalMatchCard';
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
    club: { slug: 'padel-arena-paris', name: 'Padel Arena Paris', city: 'Paris', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: null, longitude: null },
    ...over,
  };
}

const wrap = (match: NationalOpenMatch, distanceKm?: number | null) =>
  render(<ThemeProvider><NationalMatchCard match={match} distanceKm={distanceKm} /></ThemeProvider>);

describe('NationalMatchCard', () => {
  it('distance affichée quand distanceKm est fourni', () => {
    wrap(makeMatch(), 3.4);
    expect(screen.getByText('· 3 km')).toBeInTheDocument();
  });

  it('sans distanceKm → aucune mention de distance', () => {
    wrap(makeMatch());
    expect(screen.queryByText(/km/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ m$/)).not.toBeInTheDocument();
  });

  it('carte complète : nom du club, sièges vides, lien vers la partie', () => {
    wrap(makeMatch());
    expect(screen.getByText('Padel Arena Paris')).toBeInTheDocument();
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(2);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', expect.stringContaining('/parties/m1'));
  });
});
