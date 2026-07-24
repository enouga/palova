jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: (k: string) => (k === 'host' ? (globalThis as any).__host : null) })),
}));
jest.mock('../lib/api', () => ({ api: { getClubTournaments: jest.fn(), getClubEvents: jest.fn() } }));

import sitemap from '../app/sitemap';
import { api } from '../lib/api';

const getClubTournaments = api.getClubTournaments as jest.Mock;
const getClubEvents = api.getClubEvents as jest.Mock;

describe('sitemap route', () => {
  afterEach(() => jest.clearAllMocks());

  it('hôte plateforme → pages statiques seules, pas de fetch club', async () => {
    (globalThis as any).__host = 'palova.fr';
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toContain('https://palova.fr/');
    expect(getClubTournaments).not.toHaveBeenCalled();
  });

  it('hôte club, fetch OK → statique + dynamique combinés', async () => {
    // ROOT_DOMAINS vaut ['localhost'] sous jest par défaut (aucune env var posée) : le host
    // de test DOIT se terminer par ".localhost" pour que clubSlugFromHost y extraie un slug
    // (cf. lib/host.ts) — "demo.palova.fr" retomberait sur null (traité comme plateforme).
    (globalThis as any).__host = 'demo.localhost';
    getClubTournaments.mockResolvedValue([{ id: 't1', status: 'PUBLISHED' }]);
    getClubEvents.mockResolvedValue([{ id: 'e1', status: 'PUBLISHED' }]);
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls).toContain('https://demo.localhost/');
    expect(urls).toContain('https://demo.localhost/tournois/t1');
    expect(urls).toContain('https://demo.localhost/events/e1');
  });

  it("hôte club, fetch en échec → repli sur les pages statiques seules, pas d'exception", async () => {
    (globalThis as any).__host = 'demo.localhost';
    getClubTournaments.mockRejectedValue(new Error('boom'));
    getClubEvents.mockResolvedValue([]);
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toEqual([
      'https://demo.localhost/', 'https://demo.localhost/club', 'https://demo.localhost/events', 'https://demo.localhost/parties',
    ]);
  });
});
