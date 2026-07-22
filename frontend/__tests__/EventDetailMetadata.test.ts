jest.mock('../app/events/[id]/EventDetailClient', () => ({ EventDetailClient: () => null }));
jest.mock('../lib/api', () => ({ api: { getEvent: jest.fn() }, API_BASE_URL: 'http://localhost:3001' }));

import { generateMetadata } from '../app/events/[id]/page';
import { api } from '../lib/api';

const getEvent = api.getEvent as jest.Mock;

const eventStub = {
  id: 'ev1', name: 'Mêlée du samedi', kind: 'MELEE' as const,
  startTime: '2026-08-01T08:00:00.000Z', endTime: '2026-08-01T10:00:00.000Z',
  confirmedCount: 6, capacity: 16,
  club: { slug: 'demo', name: 'Padel Arena Paris', timezone: 'Europe/Paris' },
};

describe('generateMetadata /events/[id]', () => {
  afterEach(() => jest.clearAllMocks());

  it('titre "{nom event} · {club}", description composée', async () => {
    getEvent.mockResolvedValue(eventStub);
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'ev1' }) });
    expect(meta.title).toBe('Mêlée du samedi · Padel Arena Paris');
    expect(meta.description).toContain('Padel Arena Paris');
    expect((meta.alternates as any).canonical).toBe('https://demo.localhost/events/ev1');
    expect((meta.openGraph as any).images[0].url).toBe('http://localhost:3001/api/clubs/demo/icon/og.png');
  });

  it('échec du fetch → repli neutre', async () => {
    getEvent.mockRejectedValue(new Error('boom'));
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'ev1' }) });
    expect(meta.title).toBe('Event · Palova');
  });
});
