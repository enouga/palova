import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { lessonService } from '../lesson.service';

beforeEach(() => {
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.$queryRaw.mockResolvedValue([] as any);
});

const lessonPerSession = { id: 'l1', clubId: 'club-demo', capacity: 2, seriesId: null, series: null };

describe('LessonService.adminEnrollStudent', () => {
  it("CONFIRMED tant que la capacité (lesson) n'est pas atteinte", async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonPerSession as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e1', status: 'CONFIRMED' } as any);
    const r = await lessonService.adminEnrollStudent('l1', 'u1', 'club-demo');
    expect(r.status).toBe('CONFIRMED');
    expect(prismaMock.lessonEnrollment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lessonId: 'l1', seriesId: null, userId: 'u1', status: 'CONFIRMED' }),
    }));
  });

  it('WAITLISTED quand la capacité est atteinte', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonPerSession as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(2);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e3', status: 'WAITLISTED' } as any);
    const r = await lessonService.adminEnrollStudent('l1', 'u3', 'club-demo');
    expect(r.status).toBe('WAITLISTED');
  });

  it('mode SERIES : conteneur = série (capacity série, where seriesId)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 99, seriesId: 's1', series: { id: 's1', capacity: 1, enrollmentMode: 'SERIES' } } as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e4', status: 'CONFIRMED' } as any);
    await lessonService.adminEnrollStudent('l1', 'u4', 'club-demo');
    expect(prismaMock.lessonEnrollment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lessonId: null, seriesId: 's1' }),
    }));
    expect(prismaMock.lessonEnrollment.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ seriesId: 's1', status: 'CONFIRMED' }),
    }));
  });

  it('club étranger → CLUB_MISMATCH', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ ...lessonPerSession, clubId: 'autre' } as any);
    await expect(lessonService.adminEnrollStudent('l1', 'u1', 'club-demo')).rejects.toThrow('CLUB_MISMATCH');
  });

  it('lesson absente → LESSON_NOT_FOUND', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    await expect(lessonService.adminEnrollStudent('x', 'u1', 'club-demo')).rejects.toThrow('LESSON_NOT_FOUND');
  });

  it('membre BLOQUÉ → MEMBERSHIP_BLOCKED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonPerSession as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue({ status: 'BLOCKED' } as any);
    await expect(lessonService.adminEnrollStudent('l1', 'u1', 'club-demo')).rejects.toThrow('MEMBERSHIP_BLOCKED');
  });

  it('ALREADY_ENROLLED si une inscription active existe déjà', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonPerSession as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue({ id: 'e1', status: 'CONFIRMED' } as any);
    await expect(lessonService.adminEnrollStudent('l1', 'u1', 'club-demo')).rejects.toThrow('ALREADY_ENROLLED');
  });

  it('série en PER_SESSION : conteneur = lesson (capacity lesson, where lessonId)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 3, seriesId: 's1', series: { id: 's1', capacity: 1, enrollmentMode: 'PER_SESSION' } } as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e5', status: 'CONFIRMED' } as any);
    await lessonService.adminEnrollStudent('l1', 'u5', 'club-demo');
    expect(prismaMock.lessonEnrollment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lessonId: 'l1', seriesId: null }),
    }));
    expect(prismaMock.lessonEnrollment.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ lessonId: 'l1', status: 'CONFIRMED' }),
    }));
  });
});

describe('LessonService.adminRemoveStudent — promotion auto', () => {
  it("promeut le 1er WAITLISTED à l'annulation d'un CONFIRMED", async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonPerSession as any);
    prismaMock.lessonEnrollment.findFirst
      .mockResolvedValueOnce({ id: 'e1', status: 'CONFIRMED', lessonId: 'l1', seriesId: null } as any)
      .mockResolvedValueOnce({ id: 'e2', status: 'WAITLISTED' } as any);
    prismaMock.lessonEnrollment.update.mockResolvedValue({} as any);
    const r = await lessonService.adminRemoveStudent('l1', 'e1', 'club-demo');
    expect(r.promotedEnrollmentId).toBe('e2');
  });
});

describe('LessonService.listStudents', () => {
  it('renvoie le roster sans userId, avec waitlistPosition', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonPerSession as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([
      { id: 'e1', status: 'CONFIRMED', createdAt: new Date(1), userId: 'u1', user: { firstName: 'A', lastName: 'B', avatarUrl: null } },
      { id: 'e2', status: 'WAITLISTED', createdAt: new Date(2), userId: 'u2', user: { firstName: 'C', lastName: 'D', avatarUrl: null } },
    ] as any);
    const list = await lessonService.listStudents('l1', 'club-demo');
    expect(list[0]).toEqual(expect.objectContaining({ id: 'e1', status: 'CONFIRMED', firstName: 'A', lastName: 'B' }));
    expect((list[0] as any).userId).toBeUndefined();
    expect(list[1].waitlistPosition).toBe(1);
  });
});

// ─────────────────────────────────────────────── méthodes joueur (Lot 3)

describe('LessonService.enroll (joueur)', () => {
  it('refuse si allowSelfEnroll=false → SELF_ENROLL_DISABLED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, allowSelfEnroll: false, seriesId: null, series: null, reservation: { startTime: new Date(Date.now() + 86400000) } } as any);
    await expect(lessonService.enroll('l1', 'u1')).rejects.toThrow('SELF_ENROLL_DISABLED');
  });
  it('inscrit CONFIRMED si ouvert et place libre', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, allowSelfEnroll: true, seriesId: null, series: null, reservation: { startTime: new Date(Date.now() + 86400000) } } as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e1', status: 'CONFIRMED' } as any);
    const r = await lessonService.enroll('l1', 'u1');
    expect(r.status).toBe('CONFIRMED');
  });
});

describe('LessonService.cancelEnrollment (joueur)', () => {
  it('refuse si la séance est passée → ENROLLMENT_LOCKED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, allowSelfEnroll: true, seriesId: null, series: null, reservation: { startTime: new Date(Date.now() - 86400000) } } as any);
    await expect(lessonService.cancelEnrollment('l1', 'u1')).rejects.toThrow('ENROLLMENT_LOCKED');
  });
});

describe('LessonService.listParticipants (public)', () => {
  it('renvoie le roster sans userId', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, allowSelfEnroll: true, seriesId: null, series: null, reservation: { startTime: new Date() } } as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([{ id: 'e1', status: 'CONFIRMED', createdAt: new Date(1), userId: 'u1', user: { firstName: 'A', lastName: 'B', avatarUrl: null } }] as any);
    const list = await lessonService.listParticipants('l1');
    expect((list[0] as any).userId).toBeUndefined();
    expect(list[0].firstName).toBe('A');
  });
});
