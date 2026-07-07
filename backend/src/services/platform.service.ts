import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { slugify, RESERVED_SLUGS } from './club.service';
import { geocodeAddress } from './geo.service';
import { tierFor, tierPriceCents, BillingInterval } from './platformBilling/tiers';
import { billingState, BillingState, aggregateBilling } from './platformBilling/platformBilling.service';
import { lastMonths, bucketByMonth } from './platformStats.service';

export interface CreateClubByPlatformParams {
  club: { name: string; address?: string; city?: string; timezone?: string; sportKey?: string };
  owner: { firstName: string; lastName: string; email: string; password: string };
}

export interface PlatformStats {
  clubs: { total: number; active: number; suspended: number };
  users: number;
  reservations: number;
  tournaments: number;
  billing: { mrrCents: number; byTier: number[]; toRegularize: number; pastDue: number };
}

export class PlatformService {
  /** Statistiques globales de la plateforme. */
  async getStats(): Promise<PlatformStats> {
    // Compteurs indépendants (pas de transaction) : sous forte charge, active+suspended peut différer de total. Acceptable pour un tableau de bord.
    const [total, active, suspended, users, reservations, tournaments, billingClubs] = await Promise.all([
      prisma.club.count(),
      prisma.club.count({ where: { status: 'ACTIVE' } }),
      prisma.club.count({ where: { status: 'SUSPENDED' } }),
      prisma.user.count(),
      prisma.reservation.count(),
      prisma.tournament.count(),
      prisma.club.findMany({
        where: { status: 'ACTIVE' },
        select: {
          activeMemberCount: true, billingExempt: true,
          platformSubscription: { select: { status: true, tier: true, interval: true } },
        },
      }),
    ]);

    // MRR (abonnement annuel ramené au mois) + répartition par palier observé.
    const agg = aggregateBilling(billingClubs);
    return {
      clubs: { total, active, suspended }, users, reservations, tournaments,
      billing: {
        mrrCents: agg.mrrCents, byTier: agg.byTierObserved,
        toRegularize: agg.toRegularize, pastDue: agg.pastDue,
      },
    };
  }

  /** Tous les clubs (tous statuts), avec gérants OWNER, compteurs et statut billing. */
  async listClubs() {
    const clubs = await prisma.club.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        members: {
          where: { role: 'OWNER' },
          include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
        },
        _count: { select: { clubMemberships: true, resources: true } },
        slugAliases: { select: { slug: true }, orderBy: { createdAt: 'asc' } },
        platformSubscription: {
          select: { status: true, tier: true, interval: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
        },
      },
    });
    return clubs.map((c) => {
      const observedTier = tierFor(c.activeMemberCount);
      const liveSub = c.platformSubscription && c.platformSubscription.status !== 'canceled'
        ? c.platformSubscription : null;
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        city: c.city,
        status: c.status,
        createdAt: c.createdAt,
        owners: c.members.map((m) => m.user),
        counts: { adherents: c._count.clubMemberships, resources: c._count.resources },
        aliases: c.slugAliases.map((a) => a.slug),
        billing: {
          activeMembers: c.activeMemberCount,
          observedTier,
          state: billingState({
            billingExempt: c.billingExempt, observedTier, subscription: c.platformSubscription,
          }) as BillingState,
          exempt: c.billingExempt,
          subscribedTier: liveSub ? liveSub.tier : null,
          subscription: liveSub
            ? {
                status: liveSub.status, tier: liveSub.tier, interval: liveSub.interval as BillingInterval,
                currentPeriodEnd: liveSub.currentPeriodEnd, cancelAtPeriodEnd: liveSub.cancelAtPeriodEnd,
              }
            : null,
        },
      };
    });
  }

  /** Fiche club détaillée pour le drill-down superadmin (/superadmin/clubs/[id]). */
  async getClubDetail(id: string) {
    const now = new Date();
    const club = await prisma.club.findUnique({
      where: { id },
      include: {
        members: {
          where: { role: 'OWNER' },
          include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
        },
        slugAliases: { select: { slug: true }, orderBy: { createdAt: 'asc' } },
        platformSubscription: {
          select: { status: true, tier: true, interval: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
        },
        _count: { select: { clubMemberships: true, resources: true, tournaments: true, clubEvents: true } },
      },
    });
    if (!club) throw new Error('CLUB_NOT_FOUND');

    const months = lastMonths(12, now);
    const since = new Date(`${months[0]}-01T00:00:00Z`);
    const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [snapshots, invoices, reservations, reservations30d, lastReservation] = await Promise.all([
      prisma.clubMemberSnapshot.findMany({
        where: { clubId: id }, orderBy: { month: 'desc' }, take: 12,
        select: { month: true, activeMembers: true, observedTier: true },
      }),
      prisma.platformInvoice.findMany({
        where: { clubId: id }, orderBy: { createdAt: 'desc' }, take: 24,
      }),
      prisma.reservation.findMany({
        where: { resource: { clubId: id }, status: 'CONFIRMED', createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.reservation.count({
        where: { resource: { clubId: id }, status: 'CONFIRMED', createdAt: { gte: since30 } },
      }),
      prisma.reservation.findFirst({
        where: { resource: { clubId: id }, status: 'CONFIRMED' },
        orderBy: { createdAt: 'desc' }, select: { createdAt: true },
      }),
    ]);

    const observedTier = tierFor(club.activeMemberCount);
    const liveSub = club.platformSubscription && club.platformSubscription.status !== 'canceled'
      ? club.platformSubscription : null;
    const counts = bucketByMonth(reservations.map((r) => r.createdAt), months);

    return {
      id: club.id,
      slug: club.slug,
      name: club.name,
      city: club.city,
      address: club.address,
      timezone: club.timezone,
      status: club.status,
      createdAt: club.createdAt,
      aliases: club.slugAliases.map((a) => a.slug),
      owners: club.members.map((m) => m.user),
      counts: {
        adherents: club._count.clubMemberships,
        resources: club._count.resources,
        tournaments: club._count.tournaments,
        events: club._count.clubEvents,
      },
      billing: {
        exempt: club.billingExempt,
        activeMembers: club.activeMemberCount,
        countedAt: club.activeMemberCountAt,
        observedTier,
        state: billingState({
          billingExempt: club.billingExempt, observedTier, subscription: club.platformSubscription,
        }) as BillingState,
        subscription: liveSub
          ? {
              status: liveSub.status,
              tier: liveSub.tier,
              interval: liveSub.interval as BillingInterval,
              priceCents: tierPriceCents(liveSub.tier, liveSub.interval as BillingInterval),
              currentPeriodEnd: liveSub.currentPeriodEnd,
              cancelAtPeriodEnd: liveSub.cancelAtPeriodEnd,
            }
          : null,
        snapshots: snapshots.map((s) => ({ month: s.month, activeMembers: s.activeMembers, tier: s.observedTier })),
        invoices: invoices.map((inv) => ({
          id: inv.id,
          stripeInvoiceId: inv.stripeInvoiceId,
          amountCents: inv.amountCents,
          currency: inv.currency,
          status: inv.status,
          tier: inv.tier,
          interval: inv.interval,
          periodStart: inv.periodStart,
          periodEnd: inv.periodEnd,
          paidAt: inv.paidAt,
          hostedInvoiceUrl: inv.hostedInvoiceUrl,
          createdAt: inv.createdAt,
        })),
      },
      activity: {
        reservationsByMonth: months.map((month, i) => ({ month, count: counts[i] })),
        reservations30d,
        lastReservationAt: lastReservation?.createdAt ?? null,
      },
    };
  }

  /** Exonère (ou rétablit) la facturation d'un club — clubs partenaires/pilotes. */
  async setBillingExempt(id: string, exempt: unknown) {
    if (typeof exempt !== 'boolean') throw new Error('VALIDATION_ERROR');
    try {
      return await prisma.club.update({
        where: { id }, data: { billingExempt: exempt },
        select: { id: true, billingExempt: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new Error('CLUB_NOT_FOUND');
      }
      throw err;
    }
  }

  /** Bascule le statut d'un club (ACTIVE/SUSPENDED). */
  async setClubStatus(id: string, status: 'ACTIVE' | 'SUSPENDED') {
    // Le routeur passe le body JSON brut : on revalide le statut à l'exécution.
    if (status !== 'ACTIVE' && status !== 'SUSPENDED') throw new Error('VALIDATION_ERROR');
    try {
      return await prisma.club.update({ where: { id }, data: { status } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new Error('CLUB_NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Change le slug (sous-domaine) d'un club — réservé au super-admin plateforme.
   * L'ancien slug devient un alias permanent (redirection 308 côté front) réservé à vie.
   * Le club peut reprendre un de SES anciens alias (swap-back : la ligne d'alias est supprimée).
   */
  async changeClubSlug(clubId: string, rawSlug: unknown) {
    const slug = slugify(typeof rawSlug === 'string' ? rawSlug : '');
    if (!slug) throw new Error('SLUG_INVALID');
    if (RESERVED_SLUGS.has(slug)) throw new Error('SLUG_RESERVED');

    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true, slug: true, name: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');
    if (club.slug === slug) return { id: club.id, slug: club.slug, name: club.name }; // no-op

    try {
      // Isolation Serializable : sans contrainte DB entre clubs.slug et club_slug_aliases,
      // un ReadCommitted laisserait un createClub concurrent interposer un slug que
      // ce changeClubSlug lirait comme absent. Serializable détecte la dépendance de lecture.
      return await prisma.$transaction(async (tx) => {
        const current = await tx.club.findUnique({ where: { slug }, select: { id: true } });
        if (current) throw new Error('SLUG_TAKEN'); // slug actuel d'un autre club
        const alias = await tx.clubSlugAlias.findUnique({ where: { slug }, select: { clubId: true } });
        if (alias && alias.clubId !== clubId) throw new Error('SLUG_TAKEN'); // alias réservé par un autre club
        if (alias) await tx.clubSlugAlias.delete({ where: { slug } }); // swap-back : le club reprend son ancien alias
        await tx.clubSlugAlias.create({ data: { slug: club.slug, clubId } }); // l'ancien slug devient alias permanent
        return tx.club.update({ where: { id: clubId }, data: { slug }, select: { id: true, slug: true, name: true } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      // Course concurrente : violation d'unicité (slug pris entre-temps, ou DEUX changements
      // simultanés du même club — le second échoue sur la PK alias). SLUG_TAKEN dans les deux cas.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new Error('SLUG_TAKEN');
      throw err;
    }
  }

  /** Crée un club ET son gérant OWNER (le super-admin n'est pas le gérant). */
  async createClubWithOwner(params: CreateClubByPlatformParams) {
    const name = (params.club?.name ?? '').trim();
    const email = (params.owner?.email ?? '').trim();
    const password = params.owner?.password ?? '';
    const firstName = (params.owner?.firstName ?? '').trim();
    const lastName = (params.owner?.lastName ?? '').trim();
    if (!name || !email || !firstName || !lastName) throw new Error('VALIDATION_ERROR');
    if (typeof password !== 'string' || password.length < 8) throw new Error('VALIDATION_ERROR');

    const slug = slugify(name);
    if (!slug) throw new Error('VALIDATION_ERROR');
    if (RESERVED_SLUGS.has(slug)) throw new Error('SLUG_RESERVED');

    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) throw new Error('EMAIL_TAKEN');

    const hashed = await bcrypt.hash(password, 10);
    const geo = await geocodeAddress({ address: params.club.address, city: params.club.city });

    try {
      // Isolation Serializable : sans contrainte DB entre clubs.slug et club_slug_aliases,
      // un ReadCommitted laisserait un changeClubSlug concurrent interposer un alias que
      // ce createClubWithOwner lirait comme absent. Serializable détecte la dépendance de lecture.
      return await prisma.$transaction(async (tx) => {
        // Un ancien alias d'un club reste réservé à vie : aucun nouveau club ne peut le revendiquer.
        // Vérification DANS la transaction pour éviter la race TOCTOU avec changeClubSlug.
        const reservedAlias = await tx.clubSlugAlias.findUnique({ where: { slug }, select: { slug: true } });
        if (reservedAlias) throw new Error('SLUG_TAKEN');

        const owner = await tx.user.create({
          data: { email, password: hashed, firstName, lastName },
        });
        const club = await tx.club.create({
          data: {
            slug, name,
            address: params.club.address?.trim() || '',
            city: params.club.city?.trim() || null,
            timezone: params.club.timezone || 'Europe/Paris',
            status: 'ACTIVE',
            ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, department: geo.department, departmentCode: geo.departmentCode, postalCode: geo.postalCode } : {}),
          },
        });
        await tx.clubMember.create({ data: { userId: owner.id, clubId: club.id, role: 'OWNER' } });
        if (params.club.sportKey) {
          const sport = await tx.sport.findUnique({ where: { key: params.club.sportKey } });
          if (sport) await tx.clubSport.create({ data: { clubId: club.id, sportId: sport.id } });
        }
        return {
          club,
          owner: { id: owner.id, email: owner.email, firstName: owner.firstName, lastName: owner.lastName },
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = (err.meta?.target as string[] | undefined) ?? [];
        if (target.includes('email')) throw new Error('EMAIL_TAKEN');
        throw new Error('SLUG_TAKEN');
      }
      throw err;
    }
  }
}
