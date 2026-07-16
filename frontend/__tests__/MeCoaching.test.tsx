import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MeCoachingPage from '../app/me/coaching/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }), logout: jest.fn() }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: 'demo', club: { id: 'c1', name: 'Club', timezone: 'Europe/Paris' } }) }));
// ClubNav/ProfileMenu montés par la page : mocker leurs appels ou les composants.
jest.mock('../components/ClubNav', () => ({ ClubNav: () => null }));
jest.mock('../components/ProfileMenu', () => ({ ProfileMenu: () => null }));
jest.mock('../lib/api', () => ({
  api: {
    getCoachLessons: jest.fn(),
    coachEnrollStudent: jest.fn(),
    coachRemoveStudent: jest.fn(),
    searchClubMembers: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const lesson = {
  id: 'les-1', lessonKind: 'GROUP', seriesId: null,
  reservation: { startTime: '2099-01-01T10:00:00Z', endTime: '2099-01-01T11:00:00Z', resource: { name: 'Court 1' } },
  sport: { key: 'padel', name: 'Padel' }, series: null, capacity: 4, confirmedCount: 1, waitlistCount: 0,
  students: [{ id: 'enr-1', status: 'CONFIRMED', firstName: 'Ana', lastName: 'B', avatarUrl: null, phone: '0611', waitlistPosition: null }],
};

const mount = () => render(<ThemeProvider><MeCoachingPage /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  (api.getCoachLessons as jest.Mock).mockResolvedValue([lesson]);
});

it('charge et affiche les cours à venir du coach', async () => {
  mount();
  await screen.findByText('Court 1');
  expect(api.getCoachLessons).toHaveBeenCalledWith('demo', 'upcoming', 'tok');
  expect(screen.getByText(/Ana B/)).toBeInTheDocument();
});

it('bascule sur « Passés » recharge en scope past', async () => {
  mount();
  await screen.findByText('Court 1');
  fireEvent.click(screen.getByRole('button', { name: /Passés/i }));
  await waitFor(() => expect(api.getCoachLessons).toHaveBeenCalledWith('demo', 'past', 'tok'));
});

it('403 NOT_A_COACH → message réservé aux coachs', async () => {
  (api.getCoachLessons as jest.Mock).mockRejectedValue(new Error('NOT_A_COACH'));
  mount();
  await screen.findByText(/réservé aux coachs/i);
});

it('retirer un élève appelle coachRemoveStudent puis recharge', async () => {
  (api.coachRemoveStudent as jest.Mock).mockResolvedValue({ cancelledEnrollmentId: 'enr-1', promotedEnrollmentId: null });
  mount();
  await screen.findByText('Court 1');
  fireEvent.click(screen.getByRole('button', { name: 'Retirer Ana B' })); // croix de la carte (aria-label exact)
  // Le ConfirmDialog s'ouvre : son bouton de confirmation a le nom exact « Retirer » (confirmLabel).
  fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
  await waitFor(() => expect(api.coachRemoveStudent).toHaveBeenCalledWith('demo', 'les-1', 'enr-1', 'tok'));
});
