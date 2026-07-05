import { render, screen } from '@testing-library/react';
import { OpenMatchesRail } from '@/components/clubhouse/OpenMatchesRail';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { OpenMatch } from '@/lib/api';

const match = (over: Partial<OpenMatch>): OpenMatch => ({
  id: 'm1', resourceName: 'Terrain 1', startTime: '2026-07-06T18:00:00Z', endTime: '2026-07-06T19:30:00Z',
  maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [{ userId: 'u1', firstName: 'Ana', lastName: 'B', avatarUrl: null, isOrganizer: true }],
  targetLevelMin: 4, targetLevelMax: 6, lastMessageAt: null, unreadCount: 0, ...over,
});

const wrap = (matches: OpenMatch[]) =>
  render(<ThemeProvider><OpenMatchesRail matches={matches} timezone="Europe/Paris" /></ThemeProvider>);

describe('OpenMatchesRail', () => {
  it('rend les cartes avec places restantes + niveau, lien vers /parties/[id]', () => {
    wrap([match({})]);
    expect(screen.getByText(/2 places/)).toBeInTheDocument();
    expect(screen.getByText(/Niveau 4 à 6/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Terrain 1/i })).toHaveAttribute('href', '/parties/m1');
    expect(screen.getByRole('link', { name: /Toutes les parties/i })).toHaveAttribute('href', '/parties');
  });

  it('rien si aucune partie', () => {
    const { container } = wrap([]);
    expect(container.firstChild).toBeNull();
  });
});
