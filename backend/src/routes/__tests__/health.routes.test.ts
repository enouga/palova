import '../../__mocks__/prisma';
import '../../__mocks__/redis';
import { prismaMock } from '../../__mocks__/prisma';
import { redisMock } from '../../__mocks__/redis';
import request from 'supertest';
import app from '../../app';

describe('GET /health', () => {
  it('200 { ok } quand Postgres ET Redis répondent', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1 }] as any);
    redisMock.ping.mockResolvedValue('PONG');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('503 degraded si Postgres est injoignable', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('db down'));
    redisMock.ping.mockResolvedValue('PONG');
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
  });

  it('503 degraded si Redis est injoignable', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1 }] as any);
    redisMock.ping.mockRejectedValue(new Error('redis down'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
  });
});
