jest.mock('../app/tournois/[id]/TournamentDetailClient', () => ({ TournamentDetailClient: () => null }));
jest.mock('../lib/api', () => ({ api: { getTournament: jest.fn() }, API_BASE_URL: 'http://localhost:3001' }));

import { generateMetadata } from '../app/tournois/[id]/page';
import { api } from '../lib/api';

const getTournament = api.getTournament as jest.Mock;

const tournamentStub = {
  id: 't1', name: 'Open P100', category: 'P100', gender: 'MEN' as const,
  startTime: '2026-09-05T08:00:00.000Z', endTime: '2026-09-05T18:00:00.000Z',
  confirmedCount: 6, maxTeams: 16,
  club: { slug: 'demo', name: 'Padel Arena Paris', timezone: 'Europe/Paris' },
};

describe('generateMetadata /tournois/[id]', () => {
  afterEach(() => jest.clearAllMocks());

  it('titre "{nom tournoi} · {club}", description composée avec catégorie/genre', async () => {
    getTournament.mockResolvedValue(tournamentStub);
    const meta = await generateMetadata({ params: Promise.resolve({ id: 't1' }) });
    expect(meta.title).toBe('Open P100 · Padel Arena Paris');
    expect(meta.description).toContain('P100 · Messieurs');
    expect((meta.alternates as any).canonical).toBe('https://demo.localhost/tournois/t1');
  });

  it('échec du fetch → repli neutre', async () => {
    getTournament.mockRejectedValue(new Error('boom'));
    const meta = await generateMetadata({ params: Promise.resolve({ id: 't1' }) });
    expect(meta.title).toBe('Tournoi · Palova');
  });
});
