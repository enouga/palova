jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-club-slug' ? (globalThis as any).__slug : null) })),
}));
jest.mock('../app/club/ClubPresentationClient', () => ({ ClubPresentationClient: () => null }));
jest.mock('../lib/api', () => ({ api: { getClub: jest.fn(), getClubPresentation: jest.fn() }, API_BASE_URL: 'http://localhost:3001' }));

import { generateMetadata } from '../app/club/page';
import { api } from '../lib/api';

const getClub = api.getClub as jest.Mock;
const getClubPresentation = api.getClubPresentation as jest.Mock;

describe('generateMetadata /club', () => {
  afterEach(() => jest.clearAllMocks());

  it('titre "Le club · {nom}", description = extrait de présentation', async () => {
    (globalThis as any).__slug = 'demo';
    getClub.mockResolvedValue({ name: 'Padel Arena Paris', city: 'Paris', description: null });
    getClubPresentation.mockResolvedValue({ presentationText: 'Un club familial au cœur de Paris depuis 2015.' });
    const meta = await generateMetadata();
    expect(meta.title).toBe('Le club · Padel Arena Paris');
    expect(meta.description).toBe('Un club familial au cœur de Paris depuis 2015.');
    expect((meta.alternates as any).canonical).toBe('https://demo.localhost/club');
  });

  it('pas de présentation → repli sur club.description, puis phrase générique', async () => {
    (globalThis as any).__slug = 'demo';
    getClub.mockResolvedValue({ name: 'Padel Arena Paris', city: 'Paris', description: 'Un club sympa.' });
    getClubPresentation.mockResolvedValue({ presentationText: null });
    const meta = await generateMetadata();
    expect(meta.description).toBe('Un club sympa.');
  });

  it('échec du fetch → repli neutre', async () => {
    (globalThis as any).__slug = 'demo';
    getClub.mockRejectedValue(new Error('boom'));
    const meta = await generateMetadata();
    expect(meta.title).toBe('Le club · Palova');
  });
});
