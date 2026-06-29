import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MatchesForYou } from '@/components/clubhouse/MatchesForYou';
import type { OpenMatch } from '@/lib/api';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);
const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

function m(over: Partial<OpenMatch> & { id: string }): OpenMatch {
  return {
    resourceName: over.resourceName ?? 'Court 1', startTime: future(2), endTime: future(3),
    maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
    players: [], targetLevelMin: 5, targetLevelMax: 5,
    interestedCount: 0, viewerIsInterested: false, interested: [], lastMessageAt: null, unreadCount: 0, ...over,
  };
}

it('affiche les recos reçues + lien Voir tout', () => {
  wrap(<MatchesForYou recos={[m({ id: 'a', resourceName: 'Court A' }), m({ id: 'b', resourceName: 'Court B' })]} timezone="Europe/Paris" />);
  expect(screen.getByText('Parties pour toi')).toBeInTheDocument();
  expect(screen.getByText('Court A')).toBeInTheDocument();
  expect(screen.getByText('Court B')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Voir tout/i })).toHaveAttribute('href', '/parties');
});

it('masqué si aucune reco', () => {
  const { container } = wrap(<MatchesForYou recos={[]} timezone="Europe/Paris" />);
  expect(container).toBeEmptyDOMElement();
});
