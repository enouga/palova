/** Teste generateMetadata (composant serveur) en isolant next/headers et l'enfant client. */

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-club-slug' ? 'demo' : null) })),
}));
jest.mock('../components/openmatch/OpenMatchDetail', () => ({ OpenMatchDetail: () => null }));
jest.mock('../lib/api', () => ({
  api: { getClub: jest.fn(), getOpenMatch: jest.fn() },
  assetUrl: (u: string) => u,
}));

import { generateMetadata } from '../app/parties/[id]/page';
import { api } from '../lib/api';

const getClub = api.getClub as jest.Mock;
const getOpenMatch = api.getOpenMatch as jest.Mock;

const matchStub = {
  id: 'm1', resourceName: 'Court 2',
  startTime: '2026-07-04T16:00:00.000Z', endTime: '2026-07-04T17:30:00.000Z',
  maxPlayers: 4, spotsLeft: 2, full: false, players: [],
  viewerIsParticipant: false, viewerIsOrganizer: false,
  targetLevelMin: 6, targetLevelMax: 7, lastMessageAt: null, unreadCount: 0,
  cardVersion: 'abc123def456',
};

describe('generateMetadata /parties/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getClub.mockResolvedValue({ name: 'Padel Arena', timezone: 'Europe/Paris' });
    getOpenMatch.mockResolvedValue(matchStub);
  });

  it('og:image = carte dynamique versionnée, format summary_large_image', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'm1' }) });
    const img = (meta.openGraph?.images as Array<{ url: string; width?: number; height?: number }>)[0];
    expect(img.url).toContain('/api/clubs/demo/open-matches/m1/card.png?v=abc123def456');
    expect(img.width).toBe(1200);
    expect(img.height).toBe(630);
    expect((meta.twitter as { card?: string }).card).toBe('summary_large_image');
  });

  it('échec du fetch → repli neutre sans throw', async () => {
    getOpenMatch.mockRejectedValue(new Error('boom'));
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'm1' }) });
    expect(meta.title).toBe('Partie ouverte · Palova');
  });

  it('noindex dans les deux branches (contenu éphémère, mais reste crawlable pour l\'unfurling social)', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'm1' }) });
    expect(meta.robots).toEqual({ index: false, follow: true });

    getOpenMatch.mockRejectedValue(new Error('boom'));
    const metaFallback = await generateMetadata({ params: Promise.resolve({ id: 'm1' }) });
    expect(metaFallback.robots).toEqual({ index: false, follow: true });
  });
});
