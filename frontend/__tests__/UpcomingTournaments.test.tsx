import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { UpcomingTournaments } from '../components/calendar/UpcomingTournaments';
import type { NationalTournament } from '../lib/api';

const NAT: NationalTournament[] = [
  { id: 'a', clubId: 'c', clubSportId: 'cs', name: 'GP Paris', category: 'P500', gender: 'MEN', openToWomen: true,
    description: null, contactInfo: null, startTime: '2026-07-02T12:00:00Z', endTime: null, registrationDeadline: '2026-07-01T12:00:00Z',
    maxTeams: 16, entryFee: null, status: 'PUBLISHED', confirmedCount: 0, waitlistCount: 0,
    club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', department: 'Paris', departmentCode: '75', timezone: 'Europe/Paris', accentColor: '#000', logoUrl: null, latitude: 48.85, longitude: 2.35 } },
];

it("le lien « Voir tout le calendrier » pointe vers /decouvrir?tab=tournois", () => {
  render(<ThemeProvider><UpcomingTournaments items={NAT} hideTitle /></ThemeProvider>);
  const link = screen.getByRole('link', { name: /Voir tout le calendrier/ });
  expect(link.getAttribute('href')).toContain('/decouvrir?tab=tournois');
});

it('rend une carte par tournoi et masque le titre interne (hideTitle)', () => {
  render(<ThemeProvider><UpcomingTournaments items={NAT} hideTitle /></ThemeProvider>);
  expect(screen.getByText('GP Paris')).toBeInTheDocument();
  expect(screen.queryByText(/Prochains tournois/)).not.toBeInTheDocument();
});

it('liste vide → rien rendu', () => {
  const { container } = render(<ThemeProvider><UpcomingTournaments items={[]} hideTitle /></ThemeProvider>);
  expect(container).toBeEmptyDOMElement();
});
