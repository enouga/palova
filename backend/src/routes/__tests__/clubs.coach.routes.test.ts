import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// --- Scaffold : mocks des services à effets de bord au chargement de clubs.ts ---
// (copiés VERBATIM depuis clubs.match-alerts.routes.test.ts)
jest.mock('../../services/openMatch.service', () => ({
  OpenMatchService: jest.fn().mockImplementation(() => ({
    listOpenMatches:       jest.fn().mockResolvedValue([]),
    getOpenMatch:          jest.fn().mockResolvedValue({ id: 'match-1' }),
    joinOpenMatch:         jest.fn().mockResolvedValue({}),
    leaveOpenMatch:        jest.fn().mockResolvedValue({}),
    removeOpenMatchPlayer: jest.fn().mockResolvedValue({}),
    addOpenMatchPlayer:    jest.fn().mockResolvedValue({}),
    setTeams:              jest.fn().mockResolvedValue({ id: 'match-1' }),
  })),
}));

jest.mock('../../services/openMatchChat.service', () => ({
  OpenMatchChatService: jest.fn().mockImplementation(() => ({
    assertChatAccessPublic: jest.fn().mockResolvedValue(undefined),
    listMessages:           jest.fn().mockResolvedValue([]),
    postMessage:            jest.fn().mockResolvedValue({}),
    deleteMessage:          jest.fn().mockResolvedValue({}),
    markRead:               jest.fn().mockResolvedValue({ count: 0 }),
    unreadCount:            jest.fn().mockResolvedValue({ count: 0 }),
  })),
}));

jest.mock('../../services/moderation.service', () => ({
  ModerationService: jest.fn().mockImplementation(() => ({
    reportOpenMatchMessage: jest.fn().mockResolvedValue({ id: 'rep-1' }),
  })),
}));

// --- Mock ciblé : lessonService (singleton importé par clubs.ts) ---
const resolveCoach = jest.fn(), listCoachLessons = jest.fn(), coachEnrollStudent = jest.fn(), coachRemoveStudent = jest.fn();
jest.mock('../../services/lesson.service', () => ({
  lessonService: { resolveCoach, listCoachLessons, coachEnrollStudent, coachRemoveStudent,
    listPublicByClubSlug: jest.fn().mockResolvedValue([]) },
}));

// --- Mock ciblé : ensureActiveMembership (résout le club + adhésion) ---
jest.mock('../../services/membership', () => ({
  ensureActiveMembership: jest.fn().mockResolvedValue({ id: 'club-1' }),
}));

import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'u-coach', email: 'c@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token}` };
const base = '/api/clubs/demo/me/coach';

beforeEach(() => { jest.clearAllMocks(); });

// Le signal de facette a migré vers GET /:slug/me/facets (cf. clubs.referee.routes.test.ts) :
// /me/coach n'existe plus. Les routes /me/coach/lessons*, elles, sont inchangées.
describe('Routes espace coach', () => {
  it('GET /me/coach/lessons → 403 NOT_A_COACH pour un non-coach', async () => {
    resolveCoach.mockResolvedValue(null);
    const res = await request(app).get(`${base}/lessons?scope=upcoming`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COACH');
  });

  it('GET /me/coach/lessons → 200 + liste pour un coach', async () => {
    resolveCoach.mockResolvedValue({ id: 'coach-1' });
    listCoachLessons.mockResolvedValue([{ id: 'les-1' }]);
    const res = await request(app).get(`${base}/lessons?scope=past`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'les-1' }]);
    expect(listCoachLessons).toHaveBeenCalledWith('club-1', 'coach-1', 'past');
  });

  it('POST students → 201 (délègue coachEnrollStudent)', async () => {
    resolveCoach.mockResolvedValue({ id: 'coach-1' });
    coachEnrollStudent.mockResolvedValue({ id: 'enr-1', status: 'CONFIRMED' });
    const res = await request(app).post(`${base}/lessons/les-1/students`).set(auth).send({ userId: 'u-9' });
    expect(res.status).toBe(201);
    expect(coachEnrollStudent).toHaveBeenCalledWith('club-1', 'coach-1', 'les-1', 'u-9');
  });

  it('POST students → 403 LESSON_NOT_YOURS remonté', async () => {
    resolveCoach.mockResolvedValue({ id: 'coach-1' });
    coachEnrollStudent.mockRejectedValue(new Error('LESSON_NOT_YOURS'));
    const res = await request(app).post(`${base}/lessons/les-1/students`).set(auth).send({ userId: 'u-9' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('LESSON_NOT_YOURS');
  });

  it('DELETE students → 200 (délègue coachRemoveStudent)', async () => {
    resolveCoach.mockResolvedValue({ id: 'coach-1' });
    coachRemoveStudent.mockResolvedValue({ cancelledEnrollmentId: 'enr-1', promotedEnrollmentId: null });
    const res = await request(app).delete(`${base}/lessons/les-1/students/enr-1`).set(auth);
    expect(res.status).toBe(200);
    expect(coachRemoveStudent).toHaveBeenCalledWith('club-1', 'coach-1', 'les-1', 'enr-1');
  });

  it('sans token → 401', async () => {
    const res = await request(app).get(`${base}/lessons`);
    expect(res.status).toBe(401);
  });
});
