import { render, screen, fireEvent } from '@testing-library/react';
import { MyAgendaListItem } from '../components/calendar/MyAgendaListItem';
import { ThemeProvider } from '../lib/ThemeProvider';

const tournamentItem = {
  kind: 'tournament' as const,
  id: 't1',
  start: '2030-01-01T10:00:00Z',
  past: false,
  reg: {
    id: 'reg1',
    status: 'CONFIRMED',
    tournament: {
      id: 't1', name: 'Open', category: 'P500', gender: 'MEN',
      sport: { key: 'tennis', name: 'Tennis' },
      startTime: '2030-01-01T10:00:00Z', endTime: null,
      club: { slug: 'demo', name: 'Demo', timezone: 'Europe/Paris' },
    },
  },
};

const baseProps = {
  now: Date.parse('2029-12-01T00:00:00Z'),
  localSlug: null,
  token: null,
  onCancel: jest.fn(),
  onPlayersChanged: jest.fn(),
  onOpenChat: jest.fn(),
};

describe('MyAgendaListItem — places G/D persistées (lecture seule)', () => {
  it('un participant padel avec slot: 1 rend à droite (donnée serveur, pas l\'ordre d\'arrivée)', () => {
    const item = {
      kind: 'reservation' as const,
      id: 'r1',
      start: '2020-01-01T10:00:00Z',
      past: true,
      r: {
        id: 'r1', startTime: '2020-01-01T10:00:00Z', endTime: '2020-01-01T11:00:00Z',
        status: 'CONFIRMED', totalPrice: '25',
        resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Demo', slug: 'demo', timezone: 'Europe/Paris' } },
        capacity: 4,
        participants: [
          { id: 'p1', userId: 'u1', isOrganizer: true, firstName: 'Paul', lastName: 'B', avatarUrl: null, team: 1, slot: 1 },
        ],
      },
    };
    render(
      <ThemeProvider>
        <MyAgendaListItem {...baseProps} item={item as any} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Paul B').closest('[data-player-slot]')).toHaveAttribute('data-player-slot', 'D');
  });
});

describe('MyAgendaListItem — badge sport', () => {
  // baseProps.localSlug = null (plateforme) → le nom du club vit dans la chip du marqueur,
  // plus dans le texte du sous-titre.
  it('préfixe le sport au sous-titre quand showSport', () => {
    render(
      <ThemeProvider>
        <MyAgendaListItem {...baseProps} item={tournamentItem as any} showSport />
      </ThemeProvider>,
    );
    expect(screen.getByText(/Tennis · P500 · Messieurs/)).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });

  it('sans showSport, pas de préfixe sport', () => {
    render(
      <ThemeProvider>
        <MyAgendaListItem {...baseProps} item={tournamentItem as any} showSport={false} />
      </ThemeProvider>,
    );
    expect(screen.getByText(/P500 · Messieurs/)).toBeInTheDocument();
    expect(screen.queryByText(/Tennis · P500/)).not.toBeInTheDocument();
  });
});

describe('MyAgendaListItem — marqueur club (entrée d\'un autre club)', () => {
  const foreignProps = { ...baseProps, localSlug: 'autre-club' };
  const tintedItem = () => {
    const it = JSON.parse(JSON.stringify(tournamentItem));
    it.reg.tournament.club.accentColor = '#34b27b';
    return it;
  };

  it('tournoi étranger : liseré + chip à la couleur du club, nom retiré du sous-titre texte', () => {
    const { container } = render(
      <ThemeProvider>
        <MyAgendaListItem {...foreignProps} item={tintedItem() as any} />
      </ThemeProvider>,
    );
    const stripe = container.querySelector('[data-club-stripe]');
    expect(stripe).toBeInTheDocument();
    expect(stripe).toHaveStyle('background: #34b27b');
    expect(screen.getByText('Demo').tagName).toBe('SPAN'); // chip
    expect(screen.queryByText(/P500 · Messieurs · Demo/)).not.toBeInTheDocument();
    // comportement carte-lien étranger inchangé
    expect(container.querySelector('a[href]')).toBeInTheDocument();
  });

  it('entrée du club courant : ni liseré ni chip, sous-titre texte intact', () => {
    const { container } = render(
      <ThemeProvider>
        <MyAgendaListItem {...baseProps} localSlug="demo" item={tournamentItem as any} />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-club-stripe]')).not.toBeInTheDocument();
    expect(screen.getByText(/P500 · Messieurs · Demo/)).toBeInTheDocument();
  });

  it('plateforme (localSlug null) : marqueur présent', () => {
    const { container } = render(
      <ThemeProvider>
        <MyAgendaListItem {...baseProps} item={tintedItem() as any} />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-club-stripe]')).toBeInTheDocument();
  });

  it('accentColor absent du payload : liseré au fallback ACCENTS.blue', () => {
    const { container } = render(
      <ThemeProvider>
        <MyAgendaListItem {...foreignProps} item={tournamentItem as any} />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-club-stripe]')).toHaveStyle('background: #5e93da');
  });

  it('cours d\'un autre club : marqueur présent, lien /cours inchangé (pas de carte-lien)', () => {
    const lessonItem = {
      kind: 'lesson' as const,
      id: 'l1',
      start: '2030-01-01T10:00:00Z',
      past: false,
      enrollment: {
        enrollmentId: 'l1', status: 'CONFIRMED',
        lesson: {
          id: 'lesson-1', clubId: 'c2', lessonKind: 'COLLECTIVE', allowSelfEnroll: true, capacity: 4,
          confirmedCount: 1, waitlistCount: 0, seriesId: null,
          coach: { name: 'Coach X', photoUrl: null },
          reservation: { startTime: '2030-01-01T10:00:00Z', endTime: '2030-01-01T11:00:00Z', resource: { name: 'Court 2' } },
          club: { slug: 'club-cours', name: 'Bordeaux Pala', timezone: 'Europe/Paris', accentColor: '#bda6ff' },
        },
      },
    };
    const { container } = render(
      <ThemeProvider>
        <MyAgendaListItem {...foreignProps} item={lessonItem as any} />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-club-stripe]')).toHaveStyle('background: #bda6ff');
    expect(screen.getByText('Bordeaux Pala').tagName).toBe('SPAN');
    expect(container.querySelector('a[href="/cours/lesson-1"]')).toBeInTheDocument();
  });
});

describe('MyAgendaListItem — carte alignée sur Mes parties (padel, non-étranger)', () => {
  it('affiche le chip de places et transmet le clic Discuter via onOpenChat', () => {
    const onOpenChat = jest.fn();
    const item = {
      kind: 'reservation' as const,
      id: 'r1',
      start: '2030-01-01T10:00:00Z',
      past: false,
      r: {
        id: 'r1', startTime: '2030-01-01T10:00:00Z', endTime: '2030-01-01T11:00:00Z',
        status: 'CONFIRMED', totalPrice: '25', visibility: 'PUBLIC',
        resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Demo', slug: 'demo', timezone: 'Europe/Paris' } },
        capacity: 4,
        participants: [
          { id: 'p1', userId: 'u1', isOrganizer: true, firstName: 'Paul', lastName: 'B', avatarUrl: null, team: 1, slot: 0 },
        ],
      },
    };
    render(
      <ThemeProvider>
        <MyAgendaListItem {...baseProps} token="abc" item={item as any} onOpenChat={onOpenChat} />
      </ThemeProvider>,
    );
    expect(screen.getByText('3 places')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Discuter/ }));
    expect(onOpenChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });
});
