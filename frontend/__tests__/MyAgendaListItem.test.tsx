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
  it('préfixe le sport au sous-titre quand showSport', () => {
    render(
      <ThemeProvider>
        <MyAgendaListItem {...baseProps} item={tournamentItem as any} showSport />
      </ThemeProvider>,
    );
    expect(screen.getByText(/Tennis · P500 · Messieurs · Demo/)).toBeInTheDocument();
  });

  it('sans showSport, pas de préfixe sport', () => {
    render(
      <ThemeProvider>
        <MyAgendaListItem {...baseProps} item={tournamentItem as any} showSport={false} />
      </ThemeProvider>,
    );
    expect(screen.getByText(/P500 · Messieurs · Demo/)).toBeInTheDocument();
    expect(screen.queryByText(/Tennis · P500/)).not.toBeInTheDocument();
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
