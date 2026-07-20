jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-club-slug' ? (globalThis as any).__slug : null) })),
}));
jest.mock('../app/HomeClient', () => ({ HomeClient: () => null }));
jest.mock('../lib/api', () => ({ api: { getClub: jest.fn() }, API_BASE_URL: 'http://localhost:3001' }));

import { generateMetadata } from '../app/page';
import { api } from '../lib/api';

const getClub = api.getClub as jest.Mock;

describe('generateMetadata /', () => {
  afterEach(() => jest.clearAllMocks());

  it('hôte plateforme → titre/description Palova génériques', async () => {
    (globalThis as any).__slug = undefined;
    const meta = await generateMetadata();
    expect(meta.title).toBe('Palova — Réservez votre terrain de padel en ligne');
    expect((meta.openGraph as any).images[0].url).toBe('/og-default.png');
  });

  it('hôte club, description club renseignée → utilisée telle quelle', async () => {
    (globalThis as any).__slug = 'demo';
    getClub.mockResolvedValue({ name: 'Padel Arena Paris', city: 'Paris', description: '  Le meilleur club de padel du 15e.  ' });
    const meta = await generateMetadata();
    expect(meta.title).toBe('Padel Arena Paris — Réservez un terrain de padel');
    expect(meta.description).toBe('Le meilleur club de padel du 15e.');
    expect((meta.openGraph as any).images[0].url).toBe('http://localhost:3001/api/clubs/demo/icon/og.png');
    expect((meta.alternates as any).canonical).toBe('https://demo.localhost/');
  });

  it('hôte club, pas de description club → repli générique avec la ville', async () => {
    (globalThis as any).__slug = 'demo';
    getClub.mockResolvedValue({ name: 'Padel Arena Paris', city: 'Paris', description: null });
    const meta = await generateMetadata();
    expect(meta.description).toBe('Réservez vos créneaux de padel en ligne au Padel Arena Paris, Paris.');
  });

  it('échec du fetch → repli neutre sans throw', async () => {
    (globalThis as any).__slug = 'demo';
    getClub.mockRejectedValue(new Error('boom'));
    const meta = await generateMetadata();
    expect(meta.title).toBe('Palova');
  });
});
