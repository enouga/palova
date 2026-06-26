import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { TournamentFinder } from '../components/calendar/TournamentFinder';

const NAT = [
  { id: 'a', clubId: 'c', clubSportId: 'cs', name: 'GP Paris', category: 'P500', gender: 'MEN', openToWomen: true,
    description: null, contactInfo: null, startTime: '2026-07-02T12:00:00Z', endTime: null, registrationDeadline: '2026-07-01T12:00:00Z',
    maxTeams: 16, entryFee: null, status: 'PUBLISHED', confirmedCount: 0, waitlistCount: 0,
    club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', department: 'Paris', departmentCode: '75', timezone: 'Europe/Paris', accentColor: '#000', logoUrl: null, latitude: 48.85, longitude: 2.35 } },
  { id: 'b', clubId: 'c2', clubSportId: 'cs', name: 'Open Lyon', category: 'P1000', gender: 'WOMEN', openToWomen: true,
    description: null, contactInfo: null, startTime: '2026-07-20T12:00:00Z', endTime: null, registrationDeadline: '2026-07-19T12:00:00Z',
    maxTeams: 16, entryFee: null, status: 'PUBLISHED', confirmedCount: 0, waitlistCount: 0,
    club: { slug: 'lyon', name: 'Lyon Padel', city: 'Lyon', department: 'Rhône', departmentCode: '69', timezone: 'Europe/Paris', accentColor: '#000', logoUrl: null, latitude: 45.76, longitude: 4.83 } },
];

jest.mock('@/lib/api', () => ({
  api: { listNationalTournaments: jest.fn(() => Promise.resolve(NAT)) },
  assetUrl: (p: string | null) => p,
}));

describe('TournamentFinder', () => {
  // window.location persists across tests in jsdom. The URL-sync effect in TournamentFinder
  // writes filter params (e.g. ?dept=75 after test 2 clicks a chip). Without a reset,
  // test 3 mounts with ?dept=75 already in the URL, which filters out Open Lyon and
  // breaks the "Autour de moi" sorting assertion.
  beforeEach(() => { window.history.replaceState(null, '', '/'); });
  it('charge et liste les tournois nationaux', async () => {
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    expect(await screen.findByText('GP Paris')).toBeInTheDocument();
    expect(screen.getByText('Open Lyon')).toBeInTheDocument();
  });

  it('filtrer par département 75 ne garde que Paris', async () => {
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    await screen.findByText('GP Paris');
    fireEvent.click(screen.getByText(/Paris 1/)); // chip « Paris 1 » (compteur)
    await waitFor(() => expect(screen.queryByText('Open Lyon')).not.toBeInTheDocument());
    expect(screen.getByText('GP Paris')).toBeInTheDocument();
  });

  it('« Autour de moi » via géoloc trie par distance (Lyon en premier)', async () => {
    (navigator.geolocation.getCurrentPosition as any) = (ok: PositionCallback) =>
      ok({ coords: { latitude: 45.76, longitude: 4.83 } } as GeolocationPosition);
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    await screen.findByText('GP Paris');
    fireEvent.click(screen.getByRole('button', { name: /Autour de moi/i }));
    await waitFor(() => {
      const titles = screen.getAllByText(/GP Paris|Open Lyon/).map((n) => n.textContent);
      expect(titles[0]).toBe('Open Lyon');
    });
  });
});
