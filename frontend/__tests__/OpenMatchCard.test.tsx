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
    setOpenMatchTeams: jest.fn().mockResolvedValue({ id: 'r1' }),
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
    players: [{ userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true, team: 1 as (1 | 2) }],
    interestedCount: 0,
    viewerIsInterested: false,
    interested: [],
    lastMessageAt: null,
    unreadCount: 0,
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
    onSetTeams: jest.fn(),
    onAddPlayer: jest.fn(),
    onReplacePlayer: jest.fn(),
    onToggleAdd: jest.fn(),
    onCancelAdd: jest.fn(),
    onRecordResult: jest.fn(),
    canRecordResult: false,
    onToggleInterest: jest.fn(),
    onOpenChat: jest.fn(),
    onAuthPrompt: jest.fn(),
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
    expect(screen.getByText('VS')).toBeInTheDocument();
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

  it('affiche le chip sport quand showSport et sport sont fournis', () => {
    const match = makeMatch({ sport: { key: 'padel', name: 'Padel' } });
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { showSport: true })} />
      </ThemeProvider>
    );
    expect(screen.getByText('Padel')).toBeInTheDocument();
  });

  it('masque le chip sport quand showSport est false', () => {
    const match = makeMatch({ sport: { key: 'padel', name: 'Padel' } });
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { showSport: false })} />
      </ThemeProvider>
    );
    expect(screen.queryByText('Padel')).not.toBeInTheDocument();
  });

  it('affiche le badge numérique quand unreadCount > 0', () => {
    const match = makeMatch({ unreadCount: 3, viewerIsParticipant: true });
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match)} />
      </ThemeProvider>
    );
    expect(screen.getByLabelText('3 non lus')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('n\'affiche pas de badge quand unreadCount est 0', () => {
    const match = makeMatch({ unreadCount: 0 });
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match)} />
      </ThemeProvider>
    );
    expect(screen.queryByLabelText(/non lus/)).not.toBeInTheDocument();
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

  it('anonyme : « Rejoindre » appelle onAuthPrompt (pas onJoin) et masque Discuter / Ça m\'intéresse', () => {
    const match = makeMatch();
    const onAuthPrompt = jest.fn(), onJoin = jest.fn();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { isAnonymous: true, onAuthPrompt, onJoin })} />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));
    expect(onAuthPrompt).toHaveBeenCalledWith(match);
    expect(onJoin).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Discuter/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ça m'intéresse/i })).not.toBeInTheDocument();
  });

  it('organisateur : « → » déplace un joueur dans l\'autre équipe et appelle onSetTeams', () => {
    const match = makeMatch({
      viewerIsOrganizer: true, viewerIsParticipant: true, spotsLeft: 0, full: true,
      players: [
        { userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true, team: 1 as (1 | 2) },
        { userId: 'u-bob', firstName: 'Bob', lastName: 'B', avatarUrl: null, isOrganizer: false, team: 1 as (1 | 2) },
        { userId: 'u-cara', firstName: 'Cara', lastName: 'C', avatarUrl: null, isOrganizer: false, team: 2 as (1 | 2) },
        { userId: 'u-dan', firstName: 'Dan', lastName: 'D', avatarUrl: null, isOrganizer: false, team: 2 as (1 | 2) },
      ],
    });
    const onSetTeams = jest.fn();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { onSetTeams })} />
      </ThemeProvider>
    );
    // Chaque joueur a un bouton « → » ; ordre DOM : Org, Bob, Cara, Dan.
    const moveBtns = screen.getAllByRole('button', { name: /Passer dans l'autre équipe/ });
    // Bob (team1[1]) → l'équipe 2 étant pleine, échange avec le joueur d'en face (Dan, team2[1]).
    fireEvent.click(moveBtns[1]);

    expect(onSetTeams).toHaveBeenCalledWith(match, {
      'u-org': 1, 'u-bob': 2, 'u-cara': 2, 'u-dan': 1,
    });
  });

  it('affiche un bouton Partager (même en anonyme)', () => {
    const match = makeMatch();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { isAnonymous: true })} />
      </ThemeProvider>
    );
    expect(screen.getByRole('button', { name: /partager/i })).toBeInTheDocument();
  });
});
