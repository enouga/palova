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
    onOpenChat: jest.fn(),
    onAuthPrompt: jest.fn(),
    ...overProps,
  };
}

describe('OpenMatchCard', () => {
  it('« Discuter » est actif pour un utilisateur connecté et appelle onOpenChat', () => {
    const match = makeMatch({ viewerIsParticipant: false });
    const onOpenChat = jest.fn();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { onOpenChat })} />
      </ThemeProvider>
    );
    expect(screen.getByText('VS')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /discuter/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onOpenChat).toHaveBeenCalledWith(match);
  });

  it("en-tête : date compacte (non répétée le même jour) et titre en une ligne avec title", () => {
    const match = makeMatch({ startTime: '2030-01-15T10:00:00.000Z', endTime: '2030-01-15T11:30:00.000Z' });
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match)} />
      </ThemeProvider>
    );
    // Paris (UTC+1 en janvier) : la date courte n'apparaît qu'une seule fois.
    expect(screen.getByText(/mar\. 15 janv\. · 11h00 → 12h30/)).toBeInTheDocument();
    // Le titre est protégé de l'écrasement (ellipsis) : le nom complet reste lisible via title.
    expect(screen.getByTitle('Terrain 1')).toBeInTheDocument();
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

  it('anonyme : « Rejoindre » appelle onAuthPrompt, et « Discuter » ouvre aussi l\'invite', () => {
    const match = makeMatch();
    const onAuthPrompt = jest.fn(), onJoin = jest.fn(), onOpenChat = jest.fn();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { isAnonymous: true, onAuthPrompt, onJoin, onOpenChat })} />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));
    expect(onAuthPrompt).toHaveBeenCalledWith(match);
    expect(onJoin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Discuter/i }));
    expect(onAuthPrompt).toHaveBeenCalledTimes(2);
    expect(onOpenChat).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Ça m'intéresse/i })).not.toBeInTheDocument();
  });

  it('organisateur : feuille d\'actions → « Passer dans l\'équipe 2 » appelle onSetTeams', () => {
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
    // Tap sur Bob → feuille d'actions → « Passer dans l'équipe 2 » (pleine → échange avec Dan).
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Bob B' }));
    fireEvent.click(screen.getByRole('button', { name: /Passer dans l'équipe 2/ }));
    // Échange Bob ↔ Dan sur la place D (slot 1) ; Org et Cara gardent la place G (slot 0).
    expect(onSetTeams).toHaveBeenCalledWith(match, {
      'u-org': 1, 'u-bob': 2, 'u-cara': 2, 'u-dan': 1,
    }, {
      'u-org': 0, 'u-bob': 1, 'u-cara': 0, 'u-dan': 1,
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
