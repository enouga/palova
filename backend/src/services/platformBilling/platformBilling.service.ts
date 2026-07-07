import { DateTime } from 'luxon';
import { prisma } from '../../db/prisma';
import { tierFor } from './tiers';
import { changeSubscriptionTier, cancelAtPeriodEnd } from './stripeBilling';
import { buildOverFreeTierEmail, buildTierChangeEmail, sendToOwners } from './billingEmails';

/** Fenêtre glissante de la métrique « membre actif ». */
export const ACTIVE_WINDOW_DAYS = 90;

export type BillingState = 'EXEMPT' | 'FREE' | 'OK' | 'TO_REGULARIZE' | 'PAST_DUE';

/**
 * Statut consolidé de facturation d'un club — helper PUR, partagé par l'API admin,
 * le superadmin et l'évaluation mensuelle. `subscription` = la ligne PlatformSubscription
 * (null si jamais souscrit) ; un abonnement `canceled` compte comme absent.
 */
export function billingState(input: {
  billingExempt: boolean;
  observedTier: number;
  subscription: { status: string } | null;
}): BillingState {
  if (input.billingExempt) return 'EXEMPT';
  const live = input.subscription && input.subscription.status !== 'canceled' ? input.subscription : null;
  if (live && (live.status === 'past_due' || live.status === 'unpaid')) return 'PAST_DUE';
  if (live) return 'OK';
  return input.observedTier === 0 ? 'FREE' : 'TO_REGULARIZE';
}

export class PlatformBillingService {
  /**
   * Membres actifs = userIds DISTINCTS ayant participé sur les 90 derniers jours :
   * réservation CONFIRMED (organisateur + participants, résas futures incluses —
   * un joueur qui vient de réserver est actif), inscription tournoi/event/cours
   * non CANCELLED, achat carnet ou abonnement club. Les ClubMembership créées à
   * la volée (chat, visite unique) ne comptent PAS.
   */
  async countActiveMembers(clubId: string, now: Date): Promise<number> {
    const since = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [reservations, tournamentRegs, eventRegs, lessonRegs, packages, playerSubs] = await Promise.all([
      prisma.reservation.findMany({
        where: { resource: { clubId }, status: 'CONFIRMED', startTime: { gte: since } },
        select: { userId: true, participants: { select: { userId: true } } },
      }),
      prisma.tournamentRegistration.findMany({
        where: { tournament: { clubId }, status: { not: 'CANCELLED' }, createdAt: { gte: since } },
        select: { captainUserId: true, partnerUserId: true },
      }),
      prisma.eventRegistration.findMany({
        where: { event: { clubId }, status: { not: 'CANCELLED' }, createdAt: { gte: since } },
        select: { userId: true },
      }),
      prisma.lessonEnrollment.findMany({
        where: {
          status: { not: 'CANCELLED' },
          createdAt: { gte: since },
          OR: [{ lesson: { clubId } }, { series: { clubId } }],
        },
        select: { userId: true },
      }),
      prisma.memberPackage.findMany({
        where: { clubId, purchasedAt: { gte: since } },
        select: { userId: true },
      }),
      prisma.subscription.findMany({
        where: { clubId, createdAt: { gte: since } },
        select: { userId: true },
      }),
    ]);

    const users = new Set<string>();
    for (const r of reservations) {
      if (r.userId) users.add(r.userId);
      for (const p of r.participants) users.add(p.userId);
    }
    for (const t of tournamentRegs) { users.add(t.captainUserId); users.add(t.partnerUserId); }
    for (const e of eventRegs) users.add(e.userId);
    for (const l of lessonRegs) users.add(l.userId);
    for (const p of packages) users.add(p.userId);
    for (const s of playerSubs) users.add(s.userId);
    return users.size;
  }

  /** Recompte + persiste le snapshot vivant du club (jauge /admin/billing). */
  async refreshActiveMemberCount(clubId: string, now: Date): Promise<number> {
    const count = await this.countActiveMembers(clubId, now);
    await prisma.club.update({
      where: { id: clubId },
      data: { activeMemberCount: count, activeMemberCountAt: now },
    });
    return count;
  }

  /** Cron nocturne : recompte tous les clubs ACTIVE (les suspendus sont ignorés). */
  async refreshAllClubs(now: Date): Promise<void> {
    const clubs = await prisma.club.findMany({ where: { status: 'ACTIVE' }, select: { id: true, slug: true } });
    for (const club of clubs) {
      try { await this.refreshActiveMemberCount(club.id, now); }
      catch (err) { console.error(`[billing] refresh ${club.slug}:`, err); }
    }
  }

  /**
   * Évaluation mensuelle d'un club (appelée le 1er du mois) : snapshot du mois écoulé
   * + règles de palier. Montée = 2 mois consécutifs au-dessus ; descente = dès 1 mois ;
   * descente à 0 = annulation à échéance ; sans abonnement et palier ≥ 1 = relance.
   * Renvoie l'action décidée (pour les tests et les logs).
   */
  async evaluateClub(
    club: { id: string; name: string; slug: string; billingExempt: boolean },
    now: Date,
  ): Promise<'none' | 'remind' | 'pending_upgrade' | 'upgrade' | 'downgrade' | 'cancel'> {
    const paris = DateTime.fromJSDate(now, { zone: 'Europe/Paris' });
    const month = paris.minus({ months: 1 }).toFormat('yyyy-LL');     // mois écoulé
    const prevMonth = paris.minus({ months: 2 }).toFormat('yyyy-LL');

    const activeMembers = await this.countActiveMembers(club.id, now);
    const observedTier = tierFor(activeMembers);
    await prisma.clubMemberSnapshot.upsert({
      where: { clubId_month: { clubId: club.id, month } },
      update: { activeMembers, observedTier },
      create: { clubId: club.id, month, activeMembers, observedTier },
    });
    // Rafraîchit aussi la jauge vivante (le nocturne le fait déjà, mais autant être exact).
    await prisma.club.update({
      where: { id: club.id },
      data: { activeMemberCount: activeMembers, activeMemberCountAt: now },
    });

    if (club.billingExempt) return 'none';

    const sub = await prisma.platformSubscription.findUnique({ where: { clubId: club.id } });
    const live = sub && sub.status !== 'canceled' ? sub : null;

    if (!live) {
      if (observedTier === 0) return 'none';
      await sendToOwners(club.id, buildOverFreeTierEmail({
        clubName: club.name, slug: club.slug, activeMembers, observedTier,
      }));
      return 'remind';
    }

    if (observedTier === live.tier) return 'none';
    const interval = live.interval as 'month' | 'year';

    if (observedTier < live.tier) {
      if (observedTier === 0) {
        await cancelAtPeriodEnd(live.stripeSubscriptionId);
        await prisma.platformSubscription.update({
          where: { clubId: club.id }, data: { cancelAtPeriodEnd: true },
        });
        await sendToOwners(club.id, buildTierChangeEmail({
          clubName: club.name, slug: club.slug, fromTier: live.tier, toTier: 0, interval,
        }));
        return 'cancel';
      }
      await changeSubscriptionTier(live.stripeSubscriptionId, observedTier);
      await prisma.platformSubscription.update({
        where: { clubId: club.id }, data: { tier: observedTier },
      });
      await sendToOwners(club.id, buildTierChangeEmail({
        clubName: club.name, slug: club.slug, fromTier: live.tier, toTier: observedTier, interval,
      }));
      return 'downgrade';
    }

    // Montée : exige que le mois PRÉCÉDENT ait déjà été au-dessus du palier souscrit.
    const prev = await prisma.clubMemberSnapshot.findUnique({
      where: { clubId_month: { clubId: club.id, month: prevMonth } },
    });
    if (!prev || prev.observedTier <= live.tier) return 'pending_upgrade';

    await changeSubscriptionTier(live.stripeSubscriptionId, observedTier);
    await prisma.platformSubscription.update({
      where: { clubId: club.id }, data: { tier: observedTier },
    });
    await sendToOwners(club.id, buildTierChangeEmail({
      clubName: club.name, slug: club.slug, fromTier: live.tier, toTier: observedTier, interval,
    }));
    return 'upgrade';
  }

  /** Cron mensuel : évalue tous les clubs ACTIVE (un échec n'arrête pas la boucle). */
  async runMonthlyEvaluation(now: Date): Promise<void> {
    const clubs = await prisma.club.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, slug: true, billingExempt: true },
    });
    for (const club of clubs) {
      try {
        const action = await this.evaluateClub(club, now);
        if (action !== 'none') console.log(`[billing] ${club.slug}: ${action}`);
      } catch (err) {
        console.error(`[billing] evaluation ${club.slug}:`, err);
      }
    }
  }
}
