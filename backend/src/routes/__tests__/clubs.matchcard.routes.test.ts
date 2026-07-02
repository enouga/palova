import '../../__mocks__/prisma';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// PNG 1×1 réel : on teste la plomberie HTTP (statut, en-têtes), pas le rendu.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'palova-card-'));
const PNG_PATH = path.join(TMP, 'card.png');
fs.writeFileSync(PNG_PATH, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
));

jest.mock('../../services/matchCard.service', () => {
  const getMatchCardPath = jest.fn();
  return {
    MatchCardService: jest.fn(),
    matchCardService: { getMatchCardPath },
    fallbackCardPath: jest.fn(),
  };
});

import app from '../../app';
import { matchCardService } from '../../services/matchCard.service';

const getMatchCardPath = matchCardService.getMatchCardPath as jest.Mock;

describe('GET /api/clubs/:slug/open-matches/:id/card.png', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMatchCardPath.mockResolvedValue(PNG_PATH);
  });

  it('200 image/png public (sans token), Cache-Control court', async () => {
    const res = await request(app).get('/api/clubs/demo/open-matches/m1/card.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(getMatchCardPath).toHaveBeenCalledWith('demo', 'm1');
  });

  it('accepte le paramètre de cache-busting ?v= (ignoré)', async () => {
    const res = await request(app).get('/api/clubs/demo/open-matches/m1/card.png?v=abc123def456');
    expect(res.status).toBe(200);
    expect(getMatchCardPath).toHaveBeenCalledWith('demo', 'm1');
  });

  it('le service renvoie le repli (id inconnu) → toujours 200 PNG', async () => {
    // getMatchCardPath ne throw jamais : il renvoie déjà le chemin du repli.
    const res = await request(app).get('/api/clubs/demo/open-matches/inconnu/card.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });
});
