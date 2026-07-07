import { render, screen } from '@testing-library/react';
import SuperAdminStats from '../app/superadmin/stats/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const platformUsageStats = jest.fn();
jest.mock('../lib/api', () => ({
  api: { platformUsageStats: (...a: unknown[]) => platformUsageStats(...a) },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok' }) }));

const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
const usage = {
  months,
  growth: {
    newClubs: months.map((_, i) => (i === 11 ? 2 : 0)),
    newUsers: months.map(() => 1),
    reservations: months.map((_, i) => i * 5),
  },
  activity: [
    { clubId: 'club-1', name: 'Arena', slug: 'arena', status: 'ACTIVE', activeMembers: 200, reservations30d: 30, lastReservationAt: '2026-07-05T00:00:00Z' },
    { clubId: 'club-2', name: 'Lyon', slug: 'lyon', status: 'SUSPENDED', activeMembers: 50, reservations30d: 0, lastReservationAt: null },
  ],
};

function renderPage() {
  return render(<ThemeProvider><SuperAdminStats /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  platformUsageStats.mockResolvedValue(usage);
});

it('affiche les 3 cartes de croissance', async () => {
  renderPage();
  expect(await screen.findByText('Nouveaux clubs / mois')).toBeInTheDocument();
  expect(screen.getByText('Nouveaux joueurs / mois')).toBeInTheDocument();
  expect(screen.getByText('Réservations / mois')).toBeInTheDocument();
});

it('classe les clubs par activité avec lien vers la fiche', async () => {
  renderPage();
  const arena = await screen.findByRole('link', { name: 'Arena' });
  expect(arena).toHaveAttribute('href', '/superadmin/clubs/club-1');
  // Club sans réservation → « Jamais ».
  expect(screen.getByText('Jamais')).toBeInTheDocument();
});
