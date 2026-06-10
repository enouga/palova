import { render, screen } from '@testing-library/react';
import { TournamentsAlaUne } from '../components/clubhouse/TournamentsAlaUne';
import { ThemeProvider } from '../lib/ThemeProvider';
import { Tournament } from '../lib/api';

const t = (over: Partial<Tournament>): Tournament => ({
  id: 't1', clubId: 'c1', clubSportId: 'cs1', name: 'P100 Messieurs', category: 'P100',
  gender: 'MEN', description: null, startTime: '2026-06-21T08:00:00.000Z', endTime: null,
  registrationDeadline: '2026-06-19T22:00:00.000Z', maxTeams: 16, entryFee: '30',
  status: 'PUBLISHED', confirmedCount: 13, waitlistCount: 0, ...over,
} as Tournament);
const wrap = (ts: Tournament[]) =>
  render(<ThemeProvider><TournamentsAlaUne tournaments={ts} timezone="Europe/Paris" /></ThemeProvider>);

describe('TournamentsAlaUne', () => {
  it('ne rend rien sans tournois', () => {
    wrap([]);
    expect(screen.queryByText('Prochains tournois')).not.toBeInTheDocument();
  });

  it('affiche nom, urgence des places et lien vers la page du tournoi', () => {
    wrap([t({})]);
    expect(screen.getByText('Prochains tournois')).toBeInTheDocument();
    expect(screen.getByText('P100 Messieurs')).toBeInTheDocument();
    expect(screen.getByText('Plus que 3 places')).toBeInTheDocument();
    expect(screen.getByText('P100 Messieurs').closest('a')).toHaveAttribute('href', '/tournois/t1');
  });
});
