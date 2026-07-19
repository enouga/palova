import request from 'supertest';
import app from '../../app';

jest.mock('../../db/prisma', () => ({
  __esModule: true,
  prisma: { club: { findUnique: jest.fn() } },
}));
import { prisma } from '../../db/prisma';

// addClubClient garde la réponse ouverte à vie (SSE) : le mock la termine
// immédiatement pour que supertest rende la main.
const mockAddClubClient = jest.fn((_clubId: string, res: { end: () => void }) => { res.end(); });
jest.mock('../../services/sse.service', () => ({
  SSEService: { getInstance: jest.fn(() => ({ addClubClient: mockAddClubClient })) },
}));

describe('routes clubs — GET /api/clubs/:slug/availability/stream', () => {
  beforeEach(() => {
    mockAddClubClient.mockClear();
    (prisma.club.findUnique as jest.Mock).mockReset();
  });

  it('abonne le client au canal du club (public, sans auth)', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ id: 'club-1', status: 'ACTIVE' });

    const res = await request(app).get('/api/clubs/padel-arena/availability/stream');

    expect(res.status).toBe(200);
    expect(mockAddClubClient).toHaveBeenCalledWith('club-1', expect.anything());
  });

  it('404 pour un slug inconnu', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get('/api/clubs/inconnu/availability/stream');
    expect(res.status).toBe(404);
    expect(mockAddClubClient).not.toHaveBeenCalled();
  });

  it('404 pour un club suspendu', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ id: 'club-1', status: 'SUSPENDED' });
    const res = await request(app).get('/api/clubs/suspendu/availability/stream');
    expect(res.status).toBe(404);
    expect(mockAddClubClient).not.toHaveBeenCalled();
  });
});
