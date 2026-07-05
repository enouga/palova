import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { bySortOrder } from './resource.service';
import { OffPeakHours } from './pricing';
import { normalizeBookingQuotas } from './quotas';
import { RatingService } from './rating.service';
import { namedTier, MIN_RANKED_MATCHES } from './rating/level';
import { computeResultStats, ResultStats } from './rating/resultStats';
import { resolvePreferredSportKey } from './rating/preferredSport';
import { geocodeAddress, haversineKm } from './geo.service';

/** Valide/normalise les plages d'heures creuses (plusieurs par jour). null → efface (tout en pleines). */
function normalizeOffPeakHours(input: OffPeakHours | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (input === null || input === undefined) return Prisma.DbNull;
  if (typeof input !== 'object') throw new Error('VALIDATION_ERROR');
  const out: OffPeakHours = {};
  for (const [k, v] of Object.entries(input)) {
    const day = Number(k);
    if (!Number.isInteger(day) || day < 1 || day > 7 || !Array.isArray(v)) throw new Error('VALIDATION_ERROR');
    const ranges = v.map((r) => {
      const start = Number(r?.start), end = Number(r?.end);
      const startMin = r?.startMin != null ? Number(r.startMin) : 0;
      const endMin   = r?.endMin   != null ? Number(r.endMin)   : 0;
      const isIntInRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
      if (!isIntInRange(start, 0, 24) || !isIntInRange(end, 0, 24) ||
          !isIntInRange(startMin, 0, 59) || !isIntInRange(endMin, 0, 59)) throw new Error('VALIDATION_ERROR');
      const s = start * 60 + startMin, e = end * 60 + endMin;
      if (s < 0 || e > 24 * 60 || s >= e) throw new Error('VALIDATION_ERROR');
      return { start, startMin, end, endMin, s, e };
    }).sort((a, b) => a.s - b.s);
    // Les plages d'un même jour ne doivent pas se chevaucher.
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].s < ranges[i - 1].e) throw new Error('VALIDATION_ERROR');
    }
    if (ranges.length) out[day] = ranges.map(({ start, startMin, end, endMin }) => ({ start, startMin, end, endMin }));
  }
  if (Object.keys(out).length === 0) return Prisma.DbNull;
  return out as unknown as Prisma.InputJsonValue;
}

/** Moyens d'encaissement rapides autorisés comme boutons 1 clic (sous-ensemble de PaymentMethod). */
const QUICK_PAYMENT_METHODS = ['CASH', 'CARD', 'VOUCHER', 'TRANSFER', 'MEMBER'] as const;

/** Valide/normalise la liste des moyens rapides : sous-ensemble autorisé, dédoublonné, ordre conservé. */
export function normalizeQuickPaymentMethods(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(QUICK_PAYMENT_METHODS);
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === 'string' && allowed.has(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Clés de sections du Club-house configurables par le club (ordre + visibilité). */
const CLUB_HOUSE_SECTION_KEYS = ['matches', 'agenda', 'posters', 'top', 'offers', 'clubCard', 'announcements', 'sponsors'] as const;

/** Valide/normalise la config des sections du Club-house. null/invalide → DbNull (= ordre
 *  adaptatif par défaut). Clé inconnue rejetée, doublon ignoré (1re occurrence gagne),
 *  clés connues manquantes complétées en fin (visibles) → la config stockée est toujours
 *  complète. Miroir lecture : frontend/lib/clubhouse.ts (resolveSections). */
export function normalizeClubHouseSections(input: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!Array.isArray(input)) return Prisma.DbNull;
  const allowed = new Set<string>(CLUB_HOUSE_SECTION_KEYS);
  const seen = new Set<string>();
  const out: { key: string; visible: boolean }[] = [];
  for (const e of input) {
    const key = (e as { key?: unknown } | null)?.key;
    if (typeof key !== 'string' || !allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, visible: (e as { visible?: unknown }).visible !== false });
  }
  if (out.length === 0) return Prisma.DbNull;
  for (const key of CLUB_HOUSE_SECTION_KEYS) if (!seen.has(key)) out.push({ key, visible: true });
  return out as unknown as Prisma.InputJsonValue;
}

/** Transforme un nom en slug URL (minuscules, tirets, sans accents). Miroir : frontend/lib/slug.ts — garder les deux synchronisés. */
export function slugify(input: string): string {
  return input
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
}

/** Libellés de sous-domaine interdits comme slug de club (hôtes plateforme / techniques). */
export const RESERVED_SLUGS = new Set(['www', 'app', 'api', 'superadmin']);

interface CreateClubParams {
  ownerId: string;
  name: string;
  slug?: string;
  address?: string;
  city?: string;
  timezone?: string;
}

export class ClubService {
  private ratingService = new RatingService();

  /** Crée un club et rattache l'auteur comme OWNER (transaction). */
  async createClub(params: CreateClubParams) {
    const name = (params.name ?? '').trim();
    if (!name) throw new Error('VALIDATION_ERROR');

    const slug = slugify(params.slug?.trim() || name);
    if (!slug) throw new Error('VALIDATION_ERROR');
    if (RESERVED_SLUGS.has(slug)) throw new Error('SLUG_RESERVED');

    // Géocodage HORS transaction (réseau) ; null si indisponible.
    const geo = await geocodeAddress({ address: params.address, city: params.city });

    try {
      // Isolation Serializable : sans contrainte DB entre clubs.slug et club_slug_aliases,
      // un ReadCommitted laisserait un changeClubSlug concurrent interposer un alias que
      // ce createClub lirait comme absent. Serializable détecte la dépendance de lecture.
      return await prisma.$transaction(async (tx) => {
        // Un ancien alias d'un club reste réservé à vie : aucun nouveau club ne peut le revendiquer.
        // Vérification DANS la transaction pour éviter la race TOCTOU avec changeClubSlug.
        const reserved = await tx.clubSlugAlias.findUnique({ where: { slug }, select: { slug: true } });
        if (reserved) throw new Error('SLUG_TAKEN');

        const club = await tx.club.create({
          data: {
            slug,
            name,
            address: params.address?.trim() || '',
            city: params.city?.trim() || null,
            timezone: params.timezone || 'Europe/Paris',
            ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, department: geo.department, departmentCode: geo.departmentCode, postalCode: geo.postalCode } : {}),
          },
        });
        await tx.clubMember.create({ data: { userId: params.ownerId, clubId: club.id, role: 'OWNER' } });
        return club;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new Error('SLUG_TAKEN');
      }
      throw err;
    }
  }

  /** Annuaire public : clubs actifs. `city` matche ville OU région ; `lat`/`lng` trient par distance. */
  async listClubs(filters: { sport?: string; city?: string; q?: string; region?: string; lat?: number; lng?: number }) {
    const where: Prisma.ClubWhereInput = { status: 'ACTIVE', listedInDirectory: true };
    if (filters.q)    where.name = { contains: filters.q, mode: 'insensitive' };
    if (filters.city) where.OR = [
      { city:   { contains: filters.city, mode: 'insensitive' } },
      { region: { contains: filters.city, mode: 'insensitive' } },
    ];
    if (filters.region) where.region = { equals: filters.region, mode: 'insensitive' };
    if (filters.sport)  where.clubSports = { some: { sport: { key: filters.sport } } };

    const clubs = await prisma.club.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true, slug: true, name: true, city: true, region: true, latitude: true, longitude: true,
        description: true, accentColor: true, logoUrl: true, coverImageUrl: true,
        clubSports: { select: { sport: { select: { key: true, name: true, icon: true } } } },
        _count: { select: { resources: true } },
      },
    });

    let mapped = clubs.map((c) => ({
      id: c.id, slug: c.slug, name: c.name, city: c.city, region: c.region,
      latitude: c.latitude, longitude: c.longitude,
      description: c.description, accentColor: c.accentColor, logoUrl: c.logoUrl, coverImageUrl: c.coverImageUrl,
      sports: c.clubSports.map((cs) => cs.sport),
      resourceCount: c._count.resources,
    }));

    // Tri par distance (clubs sans coordonnées repoussés en fin de liste).
    if (typeof filters.lat === 'number' && typeof filters.lng === 'number') {
      const origin = { lat: filters.lat, lng: filters.lng };
      mapped = mapped
        .map((c) => ({ c, d: c.latitude != null && c.longitude != null ? haversineKm(origin, { lat: c.latitude, lng: c.longitude }) : Infinity }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.c);
    }
    return mapped;
  }

  /** Résout un libellé de sous-domaine : slug actuel → moved:false ; alias historique → slug actuel + moved:true. */
  async resolveSlug(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { slug: true } });
    if (club) return { slug: club.slug, moved: false };
    const alias = await prisma.clubSlugAlias.findUnique({
      where: { slug },
      select: { club: { select: { slug: true } } },
    });
    if (alias) return { slug: alias.club.slug, moved: true };
    throw new Error('CLUB_NOT_FOUND');
  }

  /** Détail public d'un club : sports activés + ressources actives. */
  async getClubBySlug(slug: string) {
    const club = await prisma.club.findUnique({
      where: { slug },
      select: {
        id: true, slug: true, name: true, address: true, city: true, country: true,
        description: true, timezone: true, logoUrl: true, coverImageUrl: true, accentColor: true, defaultThemeMode: true, status: true,
        publicBookingDays: true, memberBookingDays: true,
        bookingReleaseMode: true, publicReleaseHour: true, memberReleaseHour: true,
        showOtherClubsReservations: true,
        requireOnlinePayment: true,
        requireCardFingerprint: true,
        stripeAccountStatus: true,
        levelSystemEnabled: true,
        cancellationCutoffHours: true,
        refundOnCancelWithinCutoff: true,
        clubHouseSections: true,
        clubSports: {
          select: {
            id: true, slotStepMin: true, durationsMin: true,
            sport: { select: { id: true, key: true, name: true, resourceNoun: true, defaultSlotStepMin: true, defaultDurationsMin: true, icon: true, surfaces: true, hasLighting: true } },
            resources: {
              where: { isActive: true },
              orderBy: { name: 'asc' },
              select: { id: true, name: true, attributes: true, price: true, openHour: true, closeHour: true },
            },
          },
        },
      },
    });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    for (const cs of club.clubSports) cs.resources.sort(bySortOrder); // ordre manuel
    return club;
  }

  /** Top 3 du mois : joueurs du club par victoires sur matchs CONFIRMED du mois calendaire
   *  courant (fuseau club). Vide si moins de 3 joueurs ont au moins 1 victoire. */
  async clubTopOfMonth(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true, timezone: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const monthStart = DateTime.now().setZone(club.timezone).startOf('month');
    const rows = await prisma.matchPlayer.findMany({
      where: {
        match: {
          clubId: club.id, status: 'CONFIRMED', winningTeam: { not: null },
          playedAt: { gte: monthStart.toJSDate(), lt: monthStart.plus({ months: 1 }).toJSDate() },
        },
      },
      select: {
        userId: true, team: true,
        match: { select: { winningTeam: true } },
        user: { select: { firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    const byUser = new Map<string, { userId: string; firstName: string; lastName: string; avatarUrl: string | null; wins: number }>();
    for (const r of rows) {
      if (r.match.winningTeam !== r.team) continue;
      const cur = byUser.get(r.userId) ?? { userId: r.userId, firstName: r.user.firstName, lastName: r.user.lastName, avatarUrl: r.user.avatarUrl, wins: 0 };
      cur.wins += 1;
      byUser.set(r.userId, cur);
    }
    const top = [...byUser.values()].sort((a, b) => b.wins - a.wins).slice(0, 3);
    return top.length >= 3 ? top : [];
  }

  /** Détail d'un club pour le back-office (préremplissage des réglages). */
  async getClubForAdmin(clubId: string) {
    return prisma.club.findUniqueOrThrow({
      where: { id: clubId },
      select: {
        id: true, slug: true, name: true, description: true, address: true, city: true, country: true,
        timezone: true, logoUrl: true, coverImageUrl: true, accentColor: true, defaultThemeMode: true, status: true,
        listedInDirectory: true, listTournamentsNationally: true, showOffersPublicly: true, publicBookingDays: true, memberBookingDays: true, offPeakHours: true,
        bookingReleaseMode: true, publicReleaseHour: true, memberReleaseHour: true,
        bookingQuotas: true,
        playerChangeCutoffHours: true, cancellationCutoffHours: true,
        showOtherClubsReservations: true,
        refundOnCancelWithinCutoff: true,
        levelSystemEnabled: true,
        stripeAccountId: true,
        stripeAccountStatus: true,
        requireOnlinePayment: true,
        requireCardFingerprint: true,
        quickPaymentMethods: true,
        clubHouseSections: true,
        legalEntityName: true, legalForm: true, siret: true, vatNumber: true,
        legalRepresentative: true, legalEmail: true, legalPhone: true,
      },
    });
  }

  /** Met à jour profil/branding/fenêtres d'un club (déjà scopé par requireClubMember). */
  async updateClub(clubId: string, params: {
    name?: string; description?: string; address?: string; city?: string;
    timezone?: string; logoUrl?: string; coverImageUrl?: string | null; accentColor?: string; defaultThemeMode?: string;
    listedInDirectory?: boolean; listTournamentsNationally?: boolean; showOffersPublicly?: boolean; publicBookingDays?: number; memberBookingDays?: number;
    bookingReleaseMode?: 'DAY_AT_HOUR' | 'ROLLING_SLOT' | 'WINDOW_SHIFT';
    publicReleaseHour?: number;
    memberReleaseHour?: number;
    offPeakHours?: OffPeakHours | null;
    bookingQuotas?: unknown;
    playerChangeCutoffHours?: number;
    cancellationCutoffHours?: number;
    showOtherClubsReservations?: boolean;
    refundOnCancelWithinCutoff?: boolean;
    levelSystemEnabled?: boolean;
    requireOnlinePayment?: boolean;
    requireCardFingerprint?: boolean;
    quickPaymentMethods?: string[];
    clubHouseSections?: unknown;
    legalEntityName?: string;
    legalForm?: string;
    siret?: string;
    vatNumber?: string;
    legalRepresentative?: string;
    legalEmail?: string;
    legalPhone?: string;
  }) {
    // Re-géocode uniquement si l'adresse ou la ville change (BAN gratuit mais on évite le bruit).
    let geoData: Record<string, unknown> = {};
    if (params.address !== undefined || params.city !== undefined) {
      const current = await prisma.club.findUnique({ where: { id: clubId }, select: { address: true, city: true } });
      const newAddress = params.address !== undefined ? params.address : current?.address ?? '';
      const newCity = params.city !== undefined ? params.city : current?.city ?? null;
      const changed = (newAddress ?? '') !== (current?.address ?? '') || (newCity ?? '') !== (current?.city ?? '');
      if (changed) {
        const geo = await geocodeAddress({ address: newAddress, city: newCity });
        geoData = geo
          ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, department: geo.department, departmentCode: geo.departmentCode, postalCode: geo.postalCode }
          : { latitude: null, longitude: null, region: null, department: null, departmentCode: null, postalCode: null };
      }
    }

    const clamp = (n: number) => Math.max(0, Math.min(365, Math.trunc(n)));
    const clampHour = (n: number) => Math.max(0, Math.min(23, Math.trunc(n)));
    const VALID_RELEASE_MODES = new Set(['DAY_AT_HOUR', 'ROLLING_SLOT', 'WINDOW_SHIFT']);
    // Champ d'identité légale : on trim, et une chaîne vide efface le champ (null).
    const legal = (v: string | undefined) => (v === undefined ? undefined : (v.trim() || null));
    return prisma.club.update({
      where: { id: clubId },
      data: {
        ...geoData,
        ...(params.offPeakHours !== undefined ? { offPeakHours: normalizeOffPeakHours(params.offPeakHours) } : {}),
        ...(params.bookingQuotas !== undefined ? { bookingQuotas: normalizeBookingQuotas(params.bookingQuotas) } : {}),
        ...(params.name !== undefined ? { name: params.name.trim() } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(params.address !== undefined ? { address: params.address } : {}),
        ...(params.city !== undefined ? { city: params.city } : {}),
        ...(params.timezone !== undefined ? { timezone: params.timezone } : {}),
        ...(params.logoUrl !== undefined ? { logoUrl: params.logoUrl } : {}),
        ...(params.coverImageUrl !== undefined ? { coverImageUrl: params.coverImageUrl || null } : {}),
        ...(params.accentColor !== undefined ? { accentColor: params.accentColor } : {}),
        ...(params.defaultThemeMode !== undefined ? { defaultThemeMode: params.defaultThemeMode } : {}),
        ...(typeof params.listedInDirectory === 'boolean' ? { listedInDirectory: params.listedInDirectory } : {}),
        ...(typeof params.listTournamentsNationally === 'boolean' ? { listTournamentsNationally: params.listTournamentsNationally } : {}),
        ...(typeof params.showOffersPublicly === 'boolean' ? { showOffersPublicly: params.showOffersPublicly } : {}),
        ...(typeof params.publicBookingDays === 'number' ? { publicBookingDays: clamp(params.publicBookingDays) } : {}),
        ...(typeof params.memberBookingDays === 'number' ? { memberBookingDays: clamp(params.memberBookingDays) } : {}),
        ...(params.bookingReleaseMode !== undefined && VALID_RELEASE_MODES.has(params.bookingReleaseMode) ? { bookingReleaseMode: params.bookingReleaseMode } : {}),
        ...(typeof params.publicReleaseHour === 'number' ? { publicReleaseHour: clampHour(params.publicReleaseHour) } : {}),
        ...(typeof params.memberReleaseHour === 'number' ? { memberReleaseHour: clampHour(params.memberReleaseHour) } : {}),
        ...(typeof params.playerChangeCutoffHours === 'number' ? { playerChangeCutoffHours: clamp(params.playerChangeCutoffHours) } : {}),
        ...(typeof params.cancellationCutoffHours === 'number' ? { cancellationCutoffHours: clamp(params.cancellationCutoffHours) } : {}),
        ...(typeof params.showOtherClubsReservations === 'boolean' ? { showOtherClubsReservations: params.showOtherClubsReservations } : {}),
        ...(typeof params.refundOnCancelWithinCutoff === 'boolean' ? { refundOnCancelWithinCutoff: params.refundOnCancelWithinCutoff } : {}),
        ...(typeof params.levelSystemEnabled === 'boolean' ? { levelSystemEnabled: params.levelSystemEnabled } : {}),
        ...(typeof params.requireOnlinePayment === 'boolean' ? { requireOnlinePayment: params.requireOnlinePayment } : {}),
        ...(typeof params.requireCardFingerprint === 'boolean' ? { requireCardFingerprint: params.requireCardFingerprint } : {}),
        ...(Array.isArray(params.quickPaymentMethods) ? { quickPaymentMethods: normalizeQuickPaymentMethods(params.quickPaymentMethods) } : {}),
        ...(params.clubHouseSections !== undefined ? { clubHouseSections: normalizeClubHouseSections(params.clubHouseSections) } : {}),
        ...(params.legalEntityName !== undefined ? { legalEntityName: legal(params.legalEntityName) } : {}),
        ...(params.legalForm !== undefined ? { legalForm: legal(params.legalForm) } : {}),
        ...(params.siret !== undefined ? { siret: legal(params.siret) } : {}),
        ...(params.vatNumber !== undefined ? { vatNumber: legal(params.vatNumber) } : {}),
        ...(params.legalRepresentative !== undefined ? { legalRepresentative: legal(params.legalRepresentative) } : {}),
        ...(params.legalEmail !== undefined ? { legalEmail: legal(params.legalEmail) } : {}),
        ...(params.legalPhone !== undefined ? { legalPhone: legal(params.legalPhone) } : {}),
      },
    });
  }

  // --- Membres (fichier-membres du club ; être membre non bloqué = pouvoir réserver) ---

  async listMembers(clubId: string) {
    const members = await prisma.clubMembership.findMany({
      where: { clubId },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      select: {
        id: true, isSubscriber: true, membershipNo: true, status: true, note: true, watch: true, createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      },
    });
    return members.map((m) => ({
      id: m.id, userId: m.user.id,
      firstName: m.user.firstName, lastName: m.user.lastName, email: m.user.email, phone: m.user.phone,
      isSubscriber: m.isSubscriber, membershipNo: m.membershipNo, status: m.status, note: m.note, watch: m.watch, since: m.createdAt,
    }));
  }

  /** Drapeau « à surveiller » d'un membre (clé userId+clubId, depuis la fiche). */
  async setMemberWatch(clubId: string, userId: string, watch: boolean) {
    const res = await prisma.clubMembership.updateMany({ where: { clubId, userId }, data: { watch } });
    if (res.count === 0) throw new Error('MEMBER_NOT_FOUND');
    return { userId, watch };
  }

  /** Adhésion idempotente d'un user à un club (ACTIVE si absente ; garde le statut existant, BLOCKED inclus). */
  async ensureMembership(userId: string, clubId: string) {
    const existing = await prisma.clubMembership.findUnique({ where: { userId_clubId: { userId, clubId } } });
    if (existing) return existing;
    return prisma.clubMembership.create({ data: { userId, clubId } });
  }

  /** Ajoute un membre par email (le compte joueur doit déjà exister). */
  async addMemberByEmail(clubId: string, email: string) {
    const user = await prisma.user.findFirst({ where: { email: { equals: (email || '').trim(), mode: 'insensitive' } } });
    if (!user) throw new Error('USER_NOT_FOUND');
    await prisma.clubMembership.upsert({
      where: { userId_clubId: { userId: user.id, clubId } },
      update: { status: 'ACTIVE' },
      create: { userId: user.id, clubId },
    });
    return { ok: true };
  }

  /**
   * Crée un membre directement (compte + adhésion). Pas d'emailing : renvoie un
   * mot de passe temporaire à transmettre au joueur (durcir plus tard via invitation).
   */
  async createMember(clubId: string, params: { firstName: string; lastName: string; email: string; phone?: string; membershipNo?: string }) {
    const firstName = (params.firstName || '').trim();
    const lastName  = (params.lastName || '').trim();
    const email     = (params.email || '').trim();
    if (!firstName || !lastName || !email) throw new Error('VALIDATION_ERROR');
    const membershipNo = params.membershipNo?.trim() || null;

    const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (existing) {
      await prisma.clubMembership.upsert({
        where: { userId_clubId: { userId: existing.id, clubId } },
        update: { status: 'ACTIVE', membershipNo },
        create: { userId: existing.id, clubId, membershipNo },
      });
      return { tempPassword: null as string | null, existed: true };
    }

    const tempPassword = Math.random().toString(36).slice(2, 10);
    const hashed = await bcrypt.hash(tempPassword, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, firstName, lastName, phone: params.phone?.trim() || null },
    });
    await prisma.clubMembership.create({ data: { userId: user.id, clubId, membershipNo } });
    return { tempPassword, existed: false };
  }

  async updateMembership(
    clubId: string, membershipId: string,
    params: { isSubscriber?: boolean; membershipNo?: string | null; status?: 'ACTIVE' | 'BLOCKED'; note?: string | null; phone?: string | null },
  ) {
    const m = await prisma.clubMembership.findUnique({ where: { id: membershipId }, select: { clubId: true, userId: true } });
    if (!m || m.clubId !== clubId) throw new Error('MEMBER_NOT_FOUND');
    if (params.phone !== undefined) {
      await prisma.user.update({ where: { id: m.userId }, data: { phone: params.phone?.toString().trim() || null } });
    }
    return prisma.clubMembership.update({
      where: { id: membershipId },
      data: {
        ...(params.isSubscriber !== undefined ? { isSubscriber: params.isSubscriber } : {}),
        ...(params.membershipNo !== undefined ? { membershipNo: params.membershipNo?.toString().trim() || null } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.note !== undefined ? { note: params.note?.toString().trim() || null } : {}),
      },
    });
  }

  async setMemberBlocked(clubId: string, membershipId: string, blocked: boolean) {
    const m = await prisma.clubMembership.findUnique({ where: { id: membershipId }, select: { clubId: true } });
    if (!m || m.clubId !== clubId) throw new Error('MEMBER_NOT_FOUND');
    return prisma.clubMembership.update({ where: { id: membershipId }, data: { status: blocked ? 'BLOCKED' : 'ACTIVE' } });
  }

  async removeMember(clubId: string, membershipId: string) {
    const m = await prisma.clubMembership.findUnique({ where: { id: membershipId }, select: { clubId: true } });
    if (!m || m.clubId !== clubId) throw new Error('MEMBER_NOT_FOUND');
    await prisma.clubMembership.delete({ where: { id: membershipId } });
  }

  /** Recherche de membres actifs par nom/prénom (pour choisir un coéquipier) ; requête vide = liste de parcours (≤20). Réservé aux membres actifs du club. */
  async searchMembers(slug: string, callerUserId: string, q: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const caller = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: callerUserId, clubId: club.id } },
      select: { status: true },
    });
    if (!caller || caller.status !== 'ACTIVE') throw new Error('MEMBERSHIP_REQUIRED');

    const query = (q ?? '').trim();
    const members = await prisma.clubMembership.findMany({
      where: {
        clubId: club.id,
        status: 'ACTIVE',
        userId: { not: callerUserId },
        ...(query
          ? { user: { OR: [{ firstName: { contains: query, mode: 'insensitive' } }, { lastName: { contains: query, mode: 'insensitive' } }] } }
          : {}),
      },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      take: 20,
      select: { user: { select: { id: true, firstName: true, lastName: true, acceptsFriendRequests: true } } },
    });
    const userIds = members.map((m) => m.user.id);
    const sportKey = await resolvePreferredSportKey(callerUserId);
    const levels = await this.ratingService.getLevelsForUsers(userIds, sportKey);
    // Annoter le lien de suivi avec le caller (1 requête sur les ids retournés, sens A↔B).
    const links = await prisma.follow.findMany({
      where: {
        OR: [
          { followerId: callerUserId, followingId: { in: userIds } },
          { followerId: { in: userIds }, followingId: callerUserId },
        ],
      },
      select: { followerId: true, followingId: true },
    });
    const iFollowSet = new Set(links.filter((l) => l.followerId === callerUserId).map((l) => l.followingId));
    const followsMe  = new Set(links.filter((l) => l.followingId === callerUserId).map((l) => l.followerId));

    // Annoter la relation d'amitié (paire canonique) en une requête sur les ids retournés.
    const fr = await prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: callerUserId, userBId: { in: userIds } },
          { userBId: callerUserId, userAId: { in: userIds } },
        ],
      },
      select: { userAId: true, userBId: true, status: true, requestedById: true },
    });
    const frByOther = new Map<string, { status: string; requestedById: string }>();
    for (const f of fr) {
      const other = f.userAId === callerUserId ? f.userBId : f.userAId;
      frByOther.set(other, { status: f.status, requestedById: f.requestedById });
    }

    return members.map((m) => {
      const rel = frByOther.get(m.user.id);
      const friend: { status: 'none' | 'pending_out' | 'pending_in' | 'friends'; requestable: boolean } = !rel
        ? { status: 'none', requestable: !!m.user.acceptsFriendRequests }
        : rel.status === 'ACCEPTED'
          ? { status: 'friends', requestable: false }
          : { status: rel.requestedById === callerUserId ? 'pending_out' : 'pending_in', requestable: false };
      return {
        id: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        level: levels[m.user.id] ?? null,
        iFollow: iFollowSet.has(m.user.id),
        mutual: iFollowSet.has(m.user.id) && followsMe.has(m.user.id),
        friend,
      };
    });
  }

  /** Classement du club pour un sport : membres ACTIFS opt-in avec >= MIN_RANKED_MATCHES, triés par niveau. */
  async clubLeaderboard(slug: string, callerUserId: string, sportKey = 'padel') {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true, levelSystemEnabled: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const caller = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: callerUserId, clubId: club.id } },
      select: { status: true },
    });
    if (!caller || caller.status !== 'ACTIVE') throw new Error('MEMBERSHIP_REQUIRED');
    if (!club.levelSystemEnabled) throw new Error('LEVEL_SYSTEM_DISABLED');

    const sport = await prisma.sport.findUnique({ where: { key: sportKey }, select: { id: true } });
    if (!sport) throw new Error('SPORT_NOT_FOUND');

    const rows = await prisma.clubMembership.findMany({
      where: {
        clubId: club.id,
        status: 'ACTIVE',
        user: {
          showInLeaderboard: true,
          playerRatings: { some: { sportId: sport.id, matchesPlayed: { gte: MIN_RANKED_MATCHES } } },
        },
      },
      select: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true,
            playerRatings: { where: { sportId: sport.id }, select: { displayLevel: true, rating: true, matchesPlayed: true } },
          },
        },
      },
    });

    const entries = rows
      .map((m) => ({ u: m.user, r: m.user.playerRatings[0] }))
      .filter((x) => x.r)
      .sort((a, b) => b.r.displayLevel - a.r.displayLevel || b.r.rating - a.r.rating)
      .map((x, i) => ({
        rank: i + 1,
        userId: x.u.id,
        firstName: x.u.firstName,
        lastName: x.u.lastName,
        avatarUrl: x.u.avatarUrl,
        level: x.r.displayLevel,
        tier: namedTier(x.r.displayLevel),
        matchesPlayed: x.r.matchesPlayed,
      }));

    // meUser (niveau/opt-in) et le bilan V/D du club sont indépendants → en parallèle.
    const [meUser, stats] = await Promise.all([
      prisma.user.findUnique({
        where: { id: callerUserId },
        select: { showInLeaderboard: true, playerRatings: { where: { sportId: sport.id }, select: { displayLevel: true, matchesPlayed: true } } },
      }),
      this.computeClubMatchStats(club.id, callerUserId, sport.id),
    ]);
    const myRating = meUser?.playerRatings[0] ?? null;
    const matchesPlayed = myRating?.matchesPlayed ?? 0;
    const myRank = entries.find((e) => e.userId === callerUserId)?.rank ?? null;

    // matchesPlayed = compteur GLOBAL (seuil de classement) ; wins+losses = CE club, CE sport,
    // matchs CONFIRMED uniquement — périmètres volontairement distincts (ils peuvent diverger).
    const me = {
      optedIn: meUser?.showInLeaderboard ?? false,
      ranked: myRank !== null,
      rank: myRank,
      level: myRating?.displayLevel ?? null,
      matchesPlayed,
      matchesToGo: Math.max(0, MIN_RANKED_MATCHES - matchesPlayed),
      wins: stats.wins,
      losses: stats.losses,
      streak: stats.streak,
    };

    return { sport: sportKey, entries, me };
  }

  /** Bilan V/D + série d'un joueur pour un club + sport donnés (matchs CONFIRMED). Partagé classement/profil. */
  private async computeClubMatchStats(clubId: string, userId: string, sportId: string): Promise<ResultStats> {
    const rows = await prisma.matchPlayer.findMany({
      where: { userId, match: { clubId, status: 'CONFIRMED', sportId } },
      orderBy: { match: { playedAt: 'desc' } },
      select: { team: true, match: { select: { winningTeam: true, playedAt: true } } },
    });
    return computeResultStats(rows.map((mp) => ({ team: mp.team, winningTeam: mp.match.winningTeam, playedAt: mp.match.playedAt })));
  }

  /** Bilan V/D + série du joueur connecté, scopé à ce club + sport (défaut padel) — pour le profil. */
  async myClubMatchStats(slug: string, userId: string, sportKey = 'padel'): Promise<ResultStats> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { status: true },
    });
    if (!m || m.status !== 'ACTIVE') throw new Error('MEMBERSHIP_REQUIRED');
    const sport = await prisma.sport.findUnique({ where: { key: sportKey }, select: { id: true } });
    if (!sport) throw new Error('SPORT_NOT_FOUND');
    return this.computeClubMatchStats(club.id, userId, sport.id);
  }

  /** Adhésion du joueur connecté à ce club (licence / statut). */
  async getMyMembership(slug: string, userId: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { membershipNo: true, status: true, isSubscriber: true },
    });
    if (!m) throw new Error('MEMBERSHIP_REQUIRED');
    return m;
  }

  /** Le club a-t-il déjà une carte enregistrée (empreinte no-show) pour ce joueur ? */
  async getMyCardStatus(slug: string, userId: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const sc = await prisma.clubStripeCustomer.findUnique({
      where: { clubId_userId: { clubId: club.id, userId } },
      select: { defaultPaymentMethodId: true },
    });
    return { hasCardOnFile: !!sc?.defaultPaymentMethodId };
  }

  /** Le joueur renseigne / corrige sa propre licence (n° adhérent) pour ce club. */
  async setMyMembership(slug: string, userId: string, membershipNo: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { id: true, status: true },
    });
    if (!m) throw new Error('MEMBERSHIP_REQUIRED');
    if (m.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
    const value = (membershipNo ?? '').trim();
    if (!value) throw new Error('VALIDATION_ERROR');
    return prisma.clubMembership.update({
      where: { id: m.id },
      data: { membershipNo: value },
      select: { membershipNo: true, status: true, isSubscriber: true },
    });
  }

  /** Sports activés par un club (avec leurs ressources, y compris inactives). */
  async listClubSports(clubId: string) {
    return prisma.clubSport.findMany({
      where: { clubId },
      select: {
        id: true, slotStepMin: true, durationsMin: true,
        sport: { select: { id: true, key: true, name: true, resourceNoun: true, defaultDurationsMin: true, surfaces: true, hasLighting: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Met à jour les durées proposées pour un sport du club (ex. padel: 1h30 par défaut). */
  async updateClubSport(clubSportId: string, clubId: string, durationsMin: number[]) {
    const cs = await prisma.clubSport.findUnique({ where: { id: clubSportId }, select: { clubId: true } });
    if (!cs || cs.clubId !== clubId) throw new Error('CLUB_SPORT_NOT_FOUND');

    const valid = Array.from(new Set(durationsMin))
      .filter((d) => Number.isInteger(d) && d >= 15 && d <= 240 && d % 15 === 0)
      .sort((a, b) => a - b);
    if (valid.length === 0) throw new Error('VALIDATION_ERROR');

    return prisma.clubSport.update({ where: { id: clubSportId }, data: { durationsMin: valid } });
  }

  /** Active un sport pour un club (idempotent). */
  async addClubSport(clubId: string, sportId: string) {
    const sport = await prisma.sport.findUnique({ where: { id: sportId }, select: { id: true, published: true } });
    if (!sport || !sport.published) throw new Error('SPORT_NOT_FOUND');
    return prisma.clubSport.upsert({
      where: { clubId_sportId: { clubId, sportId } },
      update: {},
      create: { clubId, sportId },
    });
  }
}
