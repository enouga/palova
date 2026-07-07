import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuperAdminClubs from '../app/superadmin/clubs/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const platformClubs = jest.fn();
jest.mock('../lib/api', () => ({
  api: {
    platformClubs: (...a: unknown[]) => platformClubs(...a),
    platformSetClubStatus: jest.fn(),
    platformSetBillingExempt: jest.fn(),
    platformChangeClubSlug: jest.fn(),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok' }) }));

const mkClub = (over: Record<string, unknown>) => ({
  id: 'club-1', slug: 'arena', name: 'Arena Paris', city: 'Paris',
  status: 'ACTIVE', createdAt: '2026-01-01', aliases: [],
  owners: [{ id: 'u1', email: 'owner@arena.fr', firstName: 'O', lastName: 'M' }],
  counts: { adherents: 10, resources: 4 },
  billing: { activeMembers: 10, observedTier: 0, state: 'FREE', exempt: false, subscribedTier: null, subscription: null },
  ...over,
});

function renderPage() {
  return render(<ThemeProvider><SuperAdminClubs /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  platformClubs.mockResolvedValue([
    mkClub({ id: 'club-1', name: 'Arena Paris', slug: 'arena', city: 'Paris' }),
    mkClub({ id: 'club-2', name: 'Lyon Padel', slug: 'lyon', city: 'Lyon' }),
  ]);
});

it('le nom du club est un lien vers la fiche', async () => {
  renderPage();
  const link = await screen.findByRole('link', { name: 'Arena Paris' });
  expect(link).toHaveAttribute('href', '/superadmin/clubs/club-1');
});

it('la recherche filtre par nom/ville', async () => {
  renderPage();
  await screen.findByText('Arena Paris');
  expect(screen.getByText('Lyon Padel')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/Rechercher un club/i), { target: { value: 'lyon' } });
  await waitFor(() => expect(screen.queryByText('Arena Paris')).not.toBeInTheDocument());
  expect(screen.getByText('Lyon Padel')).toBeInTheDocument();
});
