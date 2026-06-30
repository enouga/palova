import { render, screen } from '@testing-library/react';
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
};

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
