import { render, screen, fireEvent } from '@testing-library/react';
import { OpenMatchCard, OpenMatchCardProps } from '../components/openmatch/OpenMatchCard';
import { ThemeProvider } from '../lib/ThemeProvider';
import { OpenMatch } from '../lib/api';

jest.mock('next/navigation', () => ({
  usePathname: () => '/parties',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  notificationsStreamUrl: () => 'http://x/stream',
  api: {
    searchClubMembers: jest.fn().mockResolvedValue([]),
    getMyProfile: jest.fn().mockResolvedValue({ firstName: 'Test', lastName: 'User', email: 't@t.fr', avatarUrl: null }),
  },
}));

const future = new Date(Date.now() + 48 * 3600e3).toISOString();

function makeMatch(over: Partial<OpenMatch> = {}): OpenMatch {
  return {
    id: 'm1',
    resourceName: 'Terrain 1',
    startTime: future,
    endTime: future,
    maxPlayers: 4,
    spotsLeft: 2,
    full: false,
    viewerIsParticipant: false,
    viewerIsOrganizer: false,
    players: [{ userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true }],
    interestedCount: 0,
    viewerIsInterested: false,
    interested: [],
    lastMessageAt: null,
    ...over,
  };
}

function makeProps(match: OpenMatch, overProps: Partial<OpenMatchCardProps> = {}): OpenMatchCardProps {
  return {
    match,
    timezone: 'Europe/Paris',
    slug: 'demo',
    token: 'tok',
    busy: false,
    addingOpen: false,
    onJoin: jest.fn(),
    onLeave: jest.fn(),
    onRemovePlayer: jest.fn(),
    onAddPlayer: jest.fn(),
    onToggleAdd: jest.fn(),
    onCancelAdd: jest.fn(),
    onRecordResult: jest.fn(),
    canRecordResult: false,
    onToggleInterest: jest.fn(),
    onOpenChat: jest.fn(),
    hasUnread: false,
    ...overProps,
  };
}

describe('OpenMatchCard', () => {
  it('affiche « Ça m\'intéresse » pour un non-participant non-intéressé et appelle onToggleInterest au clic', () => {
    const match = makeMatch({ viewerIsParticipant: false, viewerIsInterested: false });
    const onToggleInterest = jest.fn();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { onToggleInterest })} />
      </ThemeProvider>
    );
    const btn = screen.getByRole('button', { name: /Ça m'intéresse/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onToggleInterest).toHaveBeenCalledWith(match);
  });

  it('active le bouton « Discuter » quand viewerIsInterested est true', () => {
    const match = makeMatch({ viewerIsParticipant: false, viewerIsInterested: true });
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match)} />
      </ThemeProvider>
    );
    const btn = screen.getByRole('button', { name: /discuter/i });
    expect(btn).not.toBeDisabled();
  });

  it('désactive le bouton « Discuter » pour un non-participant non-intéressé', () => {
    const match = makeMatch({ viewerIsParticipant: false, viewerIsInterested: false });
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match)} />
      </ThemeProvider>
    );
    const btn = screen.getByRole('button', { name: /discuter/i });
    expect(btn).toBeDisabled();
  });

  it('affiche « 3 intéressés » quand interestedCount est 3', () => {
    const match = makeMatch({ interestedCount: 3 });
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match)} />
      </ThemeProvider>
    );
    expect(screen.getByText(/3 intéressés/)).toBeInTheDocument();
  });
});
