jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-club-slug' ? (globalThis as any).__slug : null) })),
}));
jest.mock('../app/events/EventsClient', () => ({ EventsClient: () => null }));
jest.mock('../lib/api', () => ({ api: { getClub: jest.fn() }, API_BASE_URL: 'http://localhost:3001' }));

import { generateMetadata } from '../app/events/page';
import { api } from '../lib/api';

const getClub = api.getClub as jest.Mock;

describe('generateMetadata /events', () => {
  afterEach(() => jest.clearAllMocks());

  it('hôte club → titre "Tournois & animations · {nom}"', async () => {
    (globalThis as any).__slug = 'demo';
    getClub.mockResolvedValue({ name: 'Padel Arena Paris' });
    const meta = await generateMetadata();
    expect(meta.title).toBe('Tournois & animations · Padel Arena Paris');
    expect(meta.description).toContain('Padel Arena Paris');
  });

  it('hôte plateforme → titre générique', async () => {
    (globalThis as any).__slug = undefined;
    const meta = await generateMetadata();
    expect(meta.title).toBe('Tournois & animations · Palova');
  });

  it('échec du fetch → repli neutre', async () => {
    (globalThis as any).__slug = 'demo';
    getClub.mockRejectedValue(new Error('boom'));
    const meta = await generateMetadata();
    expect(meta.title).toBe('Tournois & animations · Palova');
  });
});
