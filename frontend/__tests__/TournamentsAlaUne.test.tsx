import { render, screen } from '@testing-library/react';
import { TournamentsAlaUne } from '../components/clubhouse/TournamentsAlaUne';
import { ThemeProvider } from '../lib/ThemeProvider';
import { Tournament, ClubEvent } from '../lib/api';
import { AgendaItem } from '../lib/events';

const t = (over: Partial<Tournament>): Tournament => ({
  id: 't1', clubId: 'c1', clubSportId: 'cs1', name: 'P100 Messieurs', category: 'P100',
  gender: 'MEN', description: null, startTime: '2026-06-21T08:00:00.000Z', endTime: null,
  registrationDeadline: '2026-06-19T22:00:00.000Z', maxTeams: 16, entryFee: '30',
  status: 'PUBLISHED', confirmedCount: 13, waitlistCount: 0, ...over,
} as Tournament);

const e = (over: Partial<ClubEvent>): ClubEvent => ({
  id: 'e1', clubId: 'c1', name: 'Mêlée du vendredi', kind: 'MELEE', description: null,
  startTime: '2026-06-19T18:00:00.000Z', endTime: null, registrationDeadline: '2026-06-19T12:00:00.000Z',
  capacity: 12, price: null, memberOnly: true, status: 'PUBLISHED', confirmedCount: 4, waitlistCount: 0, ...over,
});

const items = (list: (Tournament | ClubEvent)[]): AgendaItem[] =>
  list.map((x) =>
    'kind' in x
      ? { source: 'event' as const, startTime: x.startTime, endTime: x.endTime, event: x }
      : { source: 'tournament' as const, startTime: x.startTime, endTime: x.endTime, tournament: x });

const wrap = (list: AgendaItem[], now: Date | null = null) =>
  render(<ThemeProvider><TournamentsAlaUne items={list} timezone="Europe/Paris" now={now} /></ThemeProvider>);

describe('TournamentsAlaUne', () => {
  it('ne rend rien sans events', () => {
    wrap([]);
    expect(screen.queryByText('Prochains events')).not.toBeInTheDocument();
  });

  it('affiche nom, urgence des places et lien vers la page du tournoi', () => {
    wrap(items([t({})]));
    expect(screen.getByText('Prochains events')).toBeInTheDocument();
    expect(screen.getByText('P100 Messieurs')).toBeInTheDocument();
    expect(screen.getByText('Plus que 3 places')).toBeInTheDocument();
    expect(screen.getByText('P100 Messieurs').closest('a')).toHaveAttribute('href', '/tournois/t1');
  });

  it('compte à rebours affiché seulement une fois `now` connu', () => {
    wrap(items([t({})]));
    expect(screen.queryByText(/J-/)).not.toBeInTheDocument();
    wrap(items([t({})]), new Date('2026-06-14T22:00:00Z'));
    expect(screen.getByText('J-5')).toBeInTheDocument();
  });

  it('affiche une animation avec son badge type et un lien /events/[id]', () => {
    wrap(items([e({})]));
    expect(screen.getByText('Mêlée du vendredi')).toBeInTheDocument();
    expect(screen.getByText(/Mêlée ·/)).toBeInTheDocument();
    expect(screen.getByText('8 places restantes')).toBeInTheDocument();
    expect(screen.getByText('Mêlée du vendredi').closest('a')).toHaveAttribute('href', '/events/e1');
  });

  it('affiche la plage horaire (début → fin) à côté de la date', () => {
    // 18:00Z → 20:00Z = 20h00 → 22h00 à Paris (UTC+2 en juin)
    wrap(items([e({ endTime: '2026-06-19T20:00:00.000Z' })]));
    expect(screen.getByText(/20h00 → 22h00/)).toBeInTheDocument();
  });

  it('affiche l’heure de début seule quand il n’y a pas de fin', () => {
    wrap(items([e({ endTime: null })])); // 18:00Z = 20h00 à Paris
    expect(screen.getByText(/· 20h00$/)).toBeInTheDocument();
  });

  it('rend les items dans une grille responsive (classe ta-grid)', () => {
    const { container } = wrap(items([t({}), t({ id: 't2', name: 'P200' })]));
    expect(container.querySelector('.ta-grid')).toBeInTheDocument();
  });
});
