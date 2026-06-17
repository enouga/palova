import { Prisma, EnrollmentMode } from '@prisma/client';
import { prisma } from '../db/prisma';

// ──────────────────────────────────────────────────────────────────────────────
// Types de sortie publics
// ──────────────────────────────────────────────────────────────────────────────

export interface StudentRow {
  id: string;
  status: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  waitlistPosition: number | null;
}

export interface RemoveResult {
  cancelledEnrollmentId: string;
  promotedEnrollmentId: string | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Résolution du conteneur (SERIES vs LESSON)
// ──────────────────────────────────────────────────────────────────────────────

interface Container {
  /** Mode : 'series' si l'inscription porte sur la série, 'lesson' sinon. */
  mode: 'series' | 'lesson';
  /** Capacité retenue (null = illimitée). */
  capacity: number | null;
  /** WHERE clause de filtrage des inscriptions actives dans ce conteneur. */
  whereActive: { seriesId: string; lessonId?: undefined } | { lessonId: string; seriesId?: undefined };
  /** Champ positionné sur la nouvelle inscription. */
  enrollKey: { lessonId: string | null; seriesId: string | null };
  /** Nom de la table verrouillée en FOR UPDATE. */
  lockTable: 'reservation_series' | 'lessons';
  /** ID de la ligne verrouillée. */
  lockId: string;
}

function resolveContainer(lesson: {
  id: string;
  capacity: number;
  seriesId: string | null;
  series: { id: string; capacity: number | null; enrollmentMode: EnrollmentMode | null } | null;
}): Container {
  const useSeries =
    lesson.seriesId != null &&
    lesson.series != null &&
    lesson.series.enrollmentMode === 'SERIES';

  if (useSeries) {
    const series = lesson.series!;
    return {
      mode: 'series',
      capacity: series.capacity,
      whereActive: { seriesId: series.id },
      enrollKey: { lessonId: null, seriesId: series.id },
      lockTable: 'reservation_series',
      lockId: series.id,
    };
  }

  return {
    mode: 'lesson',
    capacity: lesson.capacity,
    whereActive: { lessonId: lesson.id },
    enrollKey: { lessonId: lesson.id, seriesId: null },
    lockTable: 'lessons',
    lockId: lesson.id,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// LessonService
// ──────────────────────────────────────────────────────────────────────────────

class LessonService {
  /**
   * SELECT ... FOR UPDATE sur le conteneur (tagged-template = PrismaPg-safe).
   */
  private async lockContainer(tx: Prisma.TransactionClient, c: Container) {
    if (c.lockTable === 'reservation_series') {
      await tx.$queryRaw`SELECT id FROM reservation_series WHERE id = ${c.lockId} FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${c.lockId} FOR UPDATE`;
    }
  }

  /**
   * Charge la lesson + sa série et vérifie que le club correspond.
   */
  private async loadLesson(lessonId: string, clubId: string) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        series: { select: { id: true, capacity: true, enrollmentMode: true } },
      },
    });
    if (!lesson) throw new Error('LESSON_NOT_FOUND');
    if (lesson.clubId !== clubId) throw new Error('CLUB_MISMATCH');
    return lesson;
  }

  // ─────────────────────────────────────────────────────────── adminEnrollStudent

  /**
   * Inscription d'un élève (admin). CONFIRMED si places libres, sinon WAITLISTED.
   * Réutilise une ligne CANCELLED existante.
   * Lève : LESSON_NOT_FOUND | CLUB_MISMATCH | MEMBERSHIP_BLOCKED | ALREADY_ENROLLED
   */
  async adminEnrollStudent(lessonId: string, userId: string, clubId: string) {
    const lesson = await this.loadLesson(lessonId, clubId);

    // Vérification adhésion (hors transaction, lecture seule)
    const membership = await prisma.clubMembership.findFirst({
      where: { userId, clubId },
      select: { status: true },
    });
    if (membership?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');

    const container = resolveContainer(lesson);

    return prisma.$transaction(
      async (tx) => {
        await this.lockContainer(tx, container);

        // Unicité : pas de double inscription active
        const uniqueWhere =
          container.mode === 'series'
            ? { seriesId_userId: { seriesId: container.enrollKey.seriesId!, userId } }
            : { lessonId_userId: { lessonId: container.enrollKey.lessonId!, userId } };

        const existing = await tx.lessonEnrollment.findUnique({
          where: uniqueWhere,
          select: { id: true, status: true },
        });
        if (existing && existing.status !== 'CANCELLED') throw new Error('ALREADY_ENROLLED');

        // Comptage des places confirmées dans le conteneur
        const confirmedCount = await tx.lessonEnrollment.count({
          where: { ...container.whereActive, status: 'CONFIRMED' },
        });
        const status =
          container.capacity == null || confirmedCount < container.capacity
            ? 'CONFIRMED'
            : 'WAITLISTED';

        if (existing) {
          // Réutilise la ligne CANCELLED : remet createdAt à maintenant
          return tx.lessonEnrollment.update({
            where: { id: existing.id },
            data: {
              status,
              cancelledAt: null,
              createdAt: new Date(),
            },
          });
        }

        return tx.lessonEnrollment.create({
          data: {
            userId,
            status,
            ...container.enrollKey,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 },
    );
  }

  // ─────────────────────────────────────────────────────────── adminRemoveStudent

  /**
   * Annulation par l'admin. Promeut automatiquement le 1er WAITLISTED si CONFIRMED.
   * Lève : LESSON_NOT_FOUND | CLUB_MISMATCH | ENROLLMENT_NOT_FOUND
   */
  async adminRemoveStudent(lessonId: string, enrollId: string, clubId: string): Promise<RemoveResult> {
    const lesson = await this.loadLesson(lessonId, clubId);
    const container = resolveContainer(lesson);

    const { cancelledId, promotedId } = await prisma.$transaction(
      async (tx) => {
        await this.lockContainer(tx, container);

        // Vérifie que l'inscription appartient bien au conteneur
        const enrollment = await tx.lessonEnrollment.findFirst({
          where: { id: enrollId, ...container.whereActive },
          select: { id: true, status: true },
        });
        if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');

        const wasConfirmed = enrollment.status === 'CONFIRMED';

        await tx.lessonEnrollment.update({
          where: { id: enrollId },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });

        let promotedId: string | null = null;
        if (wasConfirmed) {
          const next = await tx.lessonEnrollment.findFirst({
            where: { ...container.whereActive, status: 'WAITLISTED' },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          if (next) {
            await tx.lessonEnrollment.update({
              where: { id: next.id },
              data: { status: 'CONFIRMED' },
            });
            promotedId = next.id;
          }
        }

        return { cancelledId: enrollId, promotedId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 },
    );

    return { cancelledEnrollmentId: cancelledId, promotedEnrollmentId: promotedId };
  }

  // ─────────────────────────────────────────────────────────── adminPromoteStudent

  /**
   * Promotion manuelle : passe une inscription WAITLISTED en CONFIRMED.
   * Lève : LESSON_NOT_FOUND | CLUB_MISMATCH | ENROLLMENT_NOT_FOUND | VALIDATION_ERROR
   */
  async adminPromoteStudent(lessonId: string, enrollId: string, clubId: string) {
    const lesson = await this.loadLesson(lessonId, clubId);
    const container = resolveContainer(lesson);

    const enrollment = await prisma.lessonEnrollment.findFirst({
      where: { id: enrollId, ...container.whereActive },
      select: { id: true, status: true },
    });
    if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
    if (enrollment.status !== 'WAITLISTED') throw new Error('VALIDATION_ERROR');

    return prisma.lessonEnrollment.update({
      where: { id: enrollId },
      data: { status: 'CONFIRMED' },
    });
  }

  // ─────────────────────────────────────────────────────────── listStudents

  /**
   * Liste des inscrits non-annulés, triés par createdAt asc.
   * userId n'est PAS exposé. waitlistPosition = index 1-based parmi les WAITLISTED, null si CONFIRMED.
   * Lève : LESSON_NOT_FOUND | CLUB_MISMATCH
   */
  async listStudents(lessonId: string, clubId: string): Promise<StudentRow[]> {
    const lesson = await this.loadLesson(lessonId, clubId);
    const container = resolveContainer(lesson);

    const enrollments = await prisma.lessonEnrollment.findMany({
      where: { ...container.whereActive, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        userId: true,
        user: { select: { firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    let waitlistIdx = 0;
    return enrollments.map(({ userId: _userId, user, ...row }) => ({
      id: row.id,
      status: row.status,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      waitlistPosition: row.status === 'WAITLISTED' ? ++waitlistIdx : null,
    }));
  }
}

export const lessonService = new LessonService();
