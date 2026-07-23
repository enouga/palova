import { render, screen, waitFor } from '@testing-library/react';
import { HomeMatchesRail } from '../components/platform/home/HomeMatchesRail';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: { listNationalOpenMatches: jest.fn() },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const match = (id: string, slug: string) => ({
  id, resourceName: 'T1', sport: { key: 'padel', name: 'Padel' },
  startTime: '2026-07-23T18:00:00.000Z', endTime: '2026-07-23T19:30:00.000Z',
  maxPlayers: 4, spotsLeft: 2, full: false, targetLevelMin: null, targetLevelMax: null,
  players: [], club: { slug, name: slug, city: null, timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: null, longitude: null, department: null, departmentCode: null },
});

describe('HomeMatchesRail', () => {
  it('affiche le rail (mes clubs d\'abord) + lien « Toutes »', async () => {
    mocked.listNationalOpenMatches.mockResolvedValue([match('m1', 'autre'), match('m2', 'mien')] as never);
    render(<ThemeProvider><HomeMatchesRail myClubSlugs={new Set(['mien'])} /></ThemeProvider>);
    await waitFor(() => expect(screen.getByRole('link', { name: /Toutes/ })).toHaveAttribute('href', '/decouvrir#parties'));
    // tri : la carte de MON club sort en premier dans le DOM
    const links = Array.from(document.querySelectorAll('a[href*="/parties/"]')).map((a) => a.getAttribute('href'));
    expect(links[0]).toContain('/parties/m2');
  });

  it('flux vide → rien du tout (pas d\'en-tête orphelin)', async () => {
    mocked.listNationalOpenMatches.mockResolvedValue([] as never);
    const { container } = render(<ThemeProvider><HomeMatchesRail myClubSlugs={new Set()} /></ThemeProvider>);
    await waitFor(() => expect(mocked.listNationalOpenMatches).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('fetch en échec → rien (jamais d\'erreur qui casse la page)', async () => {
    mocked.listNationalOpenMatches.mockRejectedValue(new Error('boom'));
    const { container } = render(<ThemeProvider><HomeMatchesRail myClubSlugs={new Set()} /></ThemeProvider>);
    await waitFor(() => expect(mocked.listNationalOpenMatches).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
