jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-club-slug' ? (globalThis as any).__slug : null) })),
}));
jest.mock('@/components/content/ContentShell', () => ({ ContentShell: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/content/FaqView', () => ({ FaqView: () => null }));
jest.mock('../lib/api', () => ({ api: { getClub: jest.fn() } }));

import { generateMetadata } from '../app/faq/page';
import { api } from '../lib/api';

const getClub = api.getClub as jest.Mock;

describe('generateMetadata /faq', () => {
  afterEach(() => jest.clearAllMocks());

  it('hôte club → "FAQ · {nom du club}"', async () => {
    (globalThis as any).__slug = 'demo';
    getClub.mockResolvedValue({ name: 'Padel Arena Paris' });
    const meta = await generateMetadata();
    expect(meta.title).toBe('FAQ · Padel Arena Paris');
  });

  it('hôte plateforme → "FAQ | Palova"', async () => {
    (globalThis as any).__slug = undefined;
    const meta = await generateMetadata();
    expect(meta.title).toBe('FAQ | Palova');
  });

  it('échec du fetch → repli plateforme', async () => {
    (globalThis as any).__slug = 'demo';
    getClub.mockRejectedValue(new Error('boom'));
    const meta = await generateMetadata();
    expect(meta.title).toBe('FAQ | Palova');
  });
});
