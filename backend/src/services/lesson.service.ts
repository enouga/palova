import { Prisma, EnrollmentMode } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  notifyLessonEnrollment,
  notifyLessonCancellation,
  notifyLessonPromotion,
} from '../email/notifications';
import { coachDisplay } from './coach.service';

// ──────────────────────────────────────────────────────────────────────────────
// Types de sortie supplémentaires (Lot 3 — côté joueur)
// ──────────────────────────────────────────────────────────────────────────────

export interface PublicLessonRow {
  id: string;
  clubId: string;
  lessonKind: string;
  seriesId: string | null;
  coach: { name: string; photoUrl: string | null };
  reservation: {
    startTime: Date;
    endTime: Date;
    resource: { name: string };
  };
  sport: { key: string; name: string } | null;
  series: { enrollmentMode: EnrollmentMode | null; title: string | null } | null;
  club: { slug: string; name: string; timezone: string };
  confirmedCount: number;
  waitlistCount: number;
  capacity: number;
  allowSelfEnroll: boolean;
}

export interface UserEnrollmentRow {
  enrollmentId: string;
  status: string;
  lesson: PublicLessonRow;
}

export interface CancelEnrollmentResult {
  cancelledEnrollmentId: string;
  promotedEnrollmentId: string | null;
}

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

export interface CoachStudentRow extends StudentRow {
  phone: string | null;
}

export interface CoachLessonRow {
  id: string;
  lessonKind: string;
  seriesId: string | null;
  reservation: { startTime: Date; endTime: Date; resource: { name: string } };
  sport: { key: string; name: string } | null;
  series: { title: string | null; enrollmentMode: EnrollmentMode | null } | null;
  capacity: number;
  confirmedCount: number;
  waitlistCount: number;
  students: CoachStudentRow[];
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

  /** Exécute un envoi d'email en best-effort : un échec est loggé, jamais propagé. */
  private async safeNotify(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.error('[notifications] envoi email échoué (cours) :', err);
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

    const result = await prisma.$transaction(
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

    await this.safeNotify(() => notifyLessonEnrollment(result.id));
    return result;
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

    await this.safeNotify(() => notifyLessonCancellation(cancelledId));
    if (promotedId) await this.safeNotify(() => notifyLessonPromotion(promotedId));

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

    return this.mapRoster(enrollments);
  }

  // ─────────────────────────────────────────────────────────── Private helpers (Lot 3)

  /**
   * Charge la lesson pour usage public (pas de vérif clubId).
   * Inclut series + reservation.startTime pour pouvoir appeler resolveContainer.
   */
  private async loadLessonPublic(lessonId: string) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        series: { select: { id: true, capacity: true, enrollmentMode: true, title: true } },
        reservation: { select: { startTime: true } },
      },
    });
    if (!lesson) throw new Error('LESSON_NOT_FOUND');
    return lesson;
  }

  /**
   * Construit un `PublicLessonRow` depuis une lesson déjà hydratée (coach, reservation, series, club)
   * et les compteurs issus de `withCounts`. Unique source de vérité pour la forme publique.
   */
  private mapToPublicRow(
    lesson: {
      id: string;
      clubId: string;
      lessonKind: string;
      seriesId: string | null;
      capacity: number;
      allowSelfEnroll: boolean;
      coach: { name: string; photoUrl: string | null; user?: { firstName: string; lastName: string; avatarUrl: string | null } | null };
      reservation: { startTime: Date; endTime: Date; resource: { name: string; clubSport: { sport: { key: string; name: string } } | null } };
      series: { id: string; capacity: number | null; enrollmentMode: EnrollmentMode | null; title: string | null } | null;
      club: { slug: string; name: string; timezone: string };
    },
    confirmedCount: number,
    waitlistCount: number,
  ): PublicLessonRow {
    return {
      id: lesson.id,
      clubId: lesson.clubId,
      lessonKind: lesson.lessonKind,
      seriesId: lesson.seriesId,
      coach: coachDisplay(lesson.coach),
      reservation: {
        startTime: lesson.reservation.startTime,
        endTime: lesson.reservation.endTime,
        resource: { name: lesson.reservation.resource.name },
      },
      sport: lesson.reservation.resource.clubSport?.sport ?? null,
      series: lesson.series
        ? { enrollmentMode: lesson.series.enrollmentMode, title: lesson.series.title }
        : null,
      club: lesson.club,
      confirmedCount,
      waitlistCount,
      capacity: lesson.capacity,
      allowSelfEnroll: lesson.allowSelfEnroll,
    };
  }

  /**
   * Extrait un mapping roster (même logique que listStudents) depuis un tableau d'enrollments.
   * userId n'est PAS exposé.
   */
  private mapRoster(
    enrollments: Array<{
      id: string;
      status: string;
      userId: string;
      user: { firstName: string; lastName: string; avatarUrl: string | null };
    }>,
  ): StudentRow[] {
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

  /**
   * Compte les inscriptions CONFIRMED et WAITLISTED dans le conteneur de la lesson.
   * Nécessite que `lesson` expose `series` avec `id`, `capacity`, `enrollmentMode`.
   */
  private async withCounts(lesson: {
    id: string;
    capacity: number;
    seriesId: string | null;
    series: { id: string; capacity: number | null; enrollmentMode: EnrollmentMode | null } | null;
  }): Promise<{ confirmedCount: number; waitlistCount: number }> {
    const container = resolveContainer(lesson);
    const groups = await prisma.lessonEnrollment.groupBy({
      by: ['status'],
      where: container.whereActive,
      _count: true,
    });
    const confirmedCount = groups.find((g) => g.status === 'CONFIRMED')?._count ?? 0;
    const waitlistCount = groups.find((g) => g.status === 'WAITLISTED')?._count ?? 0;
    return { confirmedCount, waitlistCount };
  }

  // ─────────────────────────────────────────────────────────── enroll (joueur)

  /**
   * Auto-inscription d'un joueur.
   * Lève : LESSON_NOT_FOUND | SELF_ENROLL_DISABLED | MEMBERSHIP_BLOCKED | ALREADY_ENROLLED
   */
  async enroll(lessonId: string, userId: string) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        series: { select: { id: true, capacity: true, enrollmentMode: true } },
        reservation: { select: { startTime: true } },
      },
    });
    if (!lesson) throw new Error('LESSON_NOT_FOUND');
    if (!lesson.allowSelfEnroll) throw new Error('SELF_ENROLL_DISABLED');

    // Vérification adhésion (lecture seule, hors transaction)
    const membership = await prisma.clubMembership.findFirst({
      where: { userId, clubId: lesson.clubId },
      select: { status: true },
    });
    if (membership?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');

    const container = resolveContainer(lesson);

    const result = await prisma.$transaction(
      async (tx) => {
        await this.lockContainer(tx, container);

        const uniqueWhere =
          container.mode === 'series'
            ? { seriesId_userId: { seriesId: container.enrollKey.seriesId!, userId } }
            : { lessonId_userId: { lessonId: container.enrollKey.lessonId!, userId } };

        const existing = await tx.lessonEnrollment.findUnique({
          where: uniqueWhere,
          select: { id: true, status: true },
        });
        if (existing && existing.status !== 'CANCELLED') throw new Error('ALREADY_ENROLLED');

        const confirmedCount = await tx.lessonEnrollment.count({
          where: { ...container.whereActive, status: 'CONFIRMED' },
        });
        const status =
          container.capacity == null || confirmedCount < container.capacity
            ? 'CONFIRMED'
            : 'WAITLISTED';

        if (existing) {
          return tx.lessonEnrollment.update({
            where: { id: existing.id },
            data: { status, cancelledAt: null, createdAt: new Date() },
          });
        }

        return tx.lessonEnrollment.create({
          data: { userId, status, ...container.enrollKey },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 },
    );

    await this.safeNotify(() => notifyLessonEnrollment(result.id));
    return { id: result.id, status: result.status, lessonId: result.lessonId, seriesId: result.seriesId };
  }

  // ─────────────────────────────────────────────────────────── cancelEnrollment (joueur)

  /**
   * Annulation par le joueur lui-même.
   * Lève : LESSON_NOT_FOUND | ENROLLMENT_LOCKED | ENROLLMENT_NOT_FOUND
   */
  async cancelEnrollment(lessonId: string, userId: string): Promise<CancelEnrollmentResult> {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        series: { select: { id: true, capacity: true, enrollmentMode: true } },
        reservation: { select: { startTime: true } },
      },
    });
    if (!lesson) throw new Error('LESSON_NOT_FOUND');
    if (lesson.reservation.startTime <= new Date()) throw new Error('ENROLLMENT_LOCKED');

    const container = resolveContainer(lesson);

    const { cancelledId, promotedId } = await prisma.$transaction(
      async (tx) => {
        await this.lockContainer(tx, container);

        // Trouver l'inscription active de cet utilisateur dans ce conteneur
        const enrollment = await tx.lessonEnrollment.findFirst({
          where: {
            userId,
            ...container.whereActive,
            status: { not: 'CANCELLED' },
          },
          select: { id: true, status: true },
        });
        if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');

        const wasConfirmed = enrollment.status === 'CONFIRMED';

        await tx.lessonEnrollment.update({
          where: { id: enrollment.id },
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

        return { cancelledId: enrollment.id, promotedId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 },
    );

    await this.safeNotify(() => notifyLessonCancellation(cancelledId));
    if (promotedId) await this.safeNotify(() => notifyLessonPromotion(promotedId));

    return { cancelledEnrollmentId: cancelledId, promotedEnrollmentId: promotedId };
  }

  // ─────────────────────────────────────────────────────────── listParticipants (public)

  /**
   * Roster public d'une séance (userId non exposé, waitlistPosition calculé).
   * Lève : LESSON_NOT_FOUND
   */
  async listParticipants(lessonId: string): Promise<StudentRow[]> {
    const lesson = await this.loadLessonPublic(lessonId);
    const container = resolveContainer(lesson);

    const enrollments = await prisma.lessonEnrollment.findMany({
      where: { ...container.whereActive, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        userId: true,
        user: { select: { firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    return this.mapRoster(enrollments);
  }

  // ─────────────────────────────────────────────────────────── getPublicLesson

  /**
   * Détail public d'une séance (coach, ressource, série, club, compteurs).
   * Lève : LESSON_NOT_FOUND
   */
  async getPublicLesson(lessonId: string): Promise<PublicLessonRow> {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        coach: { select: { name: true, photoUrl: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
        reservation: {
          select: {
            startTime: true,
            endTime: true,
            resource: { select: { name: true, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
          },
        },
        series: { select: { id: true, capacity: true, enrollmentMode: true, title: true } },
        club: { select: { slug: true, name: true, timezone: true } },
      },
    });
    if (!lesson) throw new Error('LESSON_NOT_FOUND');

    const { confirmedCount, waitlistCount } = await this.withCounts(lesson);

    return this.mapToPublicRow(lesson, confirmedCount, waitlistCount);
  }

  // ─────────────────────────────────────────────────────────── listPublicByClubSlug

  /**
   * Liste publique des séances à venir d'un club (allowSelfEnroll=true, non annulées, futures).
   * Lève : CLUB_NOT_FOUND si le club est inexistant ou suspendu.
   */
  async listPublicByClubSlug(slug: string): Promise<PublicLessonRow[]> {
    const club = await prisma.club.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');

    const now = new Date();
    const lessons = await prisma.lesson.findMany({
      where: {
        clubId: club.id,
        allowSelfEnroll: true,
        reservation: {
          status: { not: 'CANCELLED' },
          startTime: { gt: now },
        },
      },
      include: {
        coach: { select: { name: true, photoUrl: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
        reservation: {
          select: {
            startTime: true,
            endTime: true,
            resource: { select: { name: true, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
          },
        },
        series: { select: { id: true, capacity: true, enrollmentMode: true, title: true } },
        club: { select: { slug: true, name: true, timezone: true } },
      },
      orderBy: { reservation: { startTime: 'asc' } },
    });

    return Promise.all(
      lessons.map(async (lesson) => {
        const { confirmedCount, waitlistCount } = await this.withCounts(lesson);
        return this.mapToPublicRow(lesson, confirmedCount, waitlistCount);
      }),
    );
  }

  // ─────────────────────────────────────────────────────────── listUserEnrollments

  /**
   * Inscriptions non-annulées d'un joueur, avec détail de la séance.
   * - Inscription sur lesson → 1 entrée
   * - Inscription sur series → 1 entrée par occurrence FUTURE non annulée de la série
   */
  async listUserEnrollments(userId: string): Promise<UserEnrollmentRow[]> {
    const enrollments = await prisma.lessonEnrollment.findMany({
      where: { userId, status: { not: 'CANCELLED' } },
      select: {
        id: true,
        status: true,
        lessonId: true,
        seriesId: true,
      },
    });

    const now = new Date();
    const results: UserEnrollmentRow[] = [];

    for (const enrollment of enrollments) {
      if (enrollment.lessonId) {
        // Inscription à une séance unique
        try {
          const lesson = await this.getPublicLesson(enrollment.lessonId);
          results.push({ enrollmentId: enrollment.id, status: enrollment.status, lesson });
        } catch {
          // Séance supprimée, on ignore
        }
      } else if (enrollment.seriesId) {
        // Inscription à une série → toutes les occurrences futures non annulées
        const futureLessons = await prisma.lesson.findMany({
          where: {
            seriesId: enrollment.seriesId,
            reservation: {
              status: { not: 'CANCELLED' },
              startTime: { gt: now },
            },
          },
          include: {
            coach: { select: { name: true, photoUrl: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
            reservation: {
              select: {
                startTime: true,
                endTime: true,
                resource: { select: { name: true, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
              },
            },
            series: { select: { id: true, capacity: true, enrollmentMode: true, title: true } },
            club: { select: { slug: true, name: true, timezone: true } },
          },
          orderBy: { reservation: { startTime: 'asc' } },
        });

        // TODO(Lot 3 follow-up) : N+1 withCounts par occurrence d'une série — batcher en un groupBy si volumétrie élevée (faible cardinalité par joueur en pratique).
        for (const lesson of futureLessons) {
          const { confirmedCount, waitlistCount } = await this.withCounts(lesson);
          results.push({
            enrollmentId: enrollment.id,
            status: enrollment.status,
            lesson: this.mapToPublicRow(lesson, confirmedCount, waitlistCount),
          });
        }
      }
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────── Espace coach

  /** Le coach actif lié à ce user dans ce club (null si aucun). Gate de l'espace coach. */
  async resolveCoach(clubId: string, userId: string): Promise<{ id: string } | null> {
    return prisma.coach.findFirst({ where: { clubId, userId, isActive: true }, select: { id: true } });
  }

  /** Mapping roster côté coach : ajoute le téléphone (userId jamais exposé). */
  private mapRosterForCoach(
    enrollments: Array<{
      id: string; status: string; userId: string;
      user: { firstName: string; lastName: string; avatarUrl: string | null; phone: string | null };
    }>,
  ): CoachStudentRow[] {
    let waitlistIdx = 0;
    return enrollments.map(({ userId: _userId, user, ...row }) => ({
      id: row.id,
      status: row.status,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      phone: user.phone,
      waitlistPosition: row.status === 'WAITLISTED' ? ++waitlistIdx : null,
    }));
  }

  /** Cours du coach (à venir = startTime>now asc ; passés = endTime<now desc, cap 30) + rosters. */
  async listCoachLessons(clubId: string, coachId: string, scope: 'upcoming' | 'past'): Promise<CoachLessonRow[]> {
    const now = new Date();
    const lessons = await prisma.lesson.findMany({
      where: {
        clubId,
        coachId,
        reservation: {
          status: { not: 'CANCELLED' },
          ...(scope === 'upcoming' ? { startTime: { gt: now } } : { endTime: { lt: now } }),
        },
      },
      include: {
        reservation: {
          select: {
            startTime: true,
            endTime: true,
            resource: { select: { name: true, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
          },
        },
        series: { select: { id: true, capacity: true, enrollmentMode: true, title: true } },
      },
      orderBy: { reservation: { startTime: scope === 'upcoming' ? 'asc' : 'desc' } },
      ...(scope === 'past' ? { take: 30 } : {}),
    });

    return Promise.all(
      lessons.map(async (lesson) => {
        const container = resolveContainer(lesson);
        const enrollments = await prisma.lessonEnrollment.findMany({
          where: { ...container.whereActive, status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            userId: true,
            user: { select: { firstName: true, lastName: true, avatarUrl: true, phone: true } },
          },
        });
        const { confirmedCount, waitlistCount } = await this.withCounts(lesson);
        return {
          id: lesson.id,
          lessonKind: lesson.lessonKind,
          seriesId: lesson.seriesId,
          reservation: {
            startTime: lesson.reservation.startTime,
            endTime: lesson.reservation.endTime,
            resource: { name: lesson.reservation.resource.name },
          },
          sport: lesson.reservation.resource.clubSport?.sport ?? null,
          series: lesson.series ? { title: lesson.series.title, enrollmentMode: lesson.series.enrollmentMode } : null,
          capacity: lesson.capacity,
          confirmedCount,
          waitlistCount,
          students: this.mapRosterForCoach(enrollments),
        };
      }),
    );
  }

  /** Vérifie que le cours appartient bien au coach (et au club). LESSON_NOT_FOUND | LESSON_NOT_YOURS. */
  private async assertCoachOwnsLesson(lessonId: string, clubId: string, coachId: string) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { clubId: true, coachId: true, reservation: { select: { startTime: true } } },
    });
    if (!lesson || lesson.clubId !== clubId) throw new Error('LESSON_NOT_FOUND');
    if (lesson.coachId !== coachId) throw new Error('LESSON_NOT_YOURS');
    return lesson;
  }

  /** Inscription d'un élève par le coach (sur SON cours, non passé). Délègue au cœur admin. */
  async coachEnrollStudent(clubId: string, coachId: string, lessonId: string, targetUserId: string) {
    const lesson = await this.assertCoachOwnsLesson(lessonId, clubId, coachId);
    if (lesson.reservation.startTime <= new Date()) throw new Error('ENROLLMENT_LOCKED');
    return this.adminEnrollStudent(lessonId, targetUserId, clubId);
  }

  /** Retrait d'un élève par le coach (sur SON cours, non passé). Délègue au cœur admin. */
  async coachRemoveStudent(clubId: string, coachId: string, lessonId: string, enrollId: string) {
    const lesson = await this.assertCoachOwnsLesson(lessonId, clubId, coachId);
    if (lesson.reservation.startTime <= new Date()) throw new Error('ENROLLMENT_LOCKED');
    return this.adminRemoveStudent(lessonId, enrollId, clubId);
  }
}

export const lessonService = new LessonService();
