import { ClubRole } from '@prisma/client';
import { prisma } from '../db/prisma';
import { dispatch } from '../services/notification/dispatcher';
import { absoluteAsset, clubAppUrl, formatDateRangeFr } from './links';
import { Brand, PALOVA_BRAND } from './templates/layout';
import {
  ActivityType,
  OrganizerKind,
  PlayerAction,
  buildOrganizerEmail,
  buildPlayerEmail,
  buildMatchJoinEmail,
  buildMatchInviteEmail,
  buildMatchRemovedEmail,
  buildMatchLeftEmail,
  buildRefundEmail,
  buildMatchConfirmEmail,
  buildMatchCommentEmail,
} from './templates/emails';
import { playerCount } from '../utils/courtType';

// Couche d'orchestration : charge les données (hors transaction), construit les emails
// et les envoie aux bons destinataires. Ces fonctions PEUVENT lever (DB/SMTP) ; les
// appelants (services) les enveloppent en best-effort pour ne jamais casser l'inscription.

interface ClubBrandFields {
  name: string;
  slug: string;
  logoUrl: string | null;
  accentColor: string;
  timezone: string;
}

function brandOf(club: ClubBrandFields): Brand {
  return {
    name: club.name || PALOVA_BRAND.name,
    logoUrl: absoluteAsset(club.logoUrl),
    accentColor: club.accentColor || PALOVA_BRAND.accentColor,
  };
}

/** Staff destinataire des notifications « organisateur » : propriétaires + admins du club. */
async function organizers(clubId: string): Promise<Array<{ id: string; email: string; firstName: string }>> {
  const members = await prisma.clubMember.findMany({
    where: { clubId, role: { in: [ClubRole.OWNER, ClubRole.ADMIN] } },
    select: { user: { select: { id: true, email: true, firstName: true } } },
  });
  return members
    .map((m) => m.user)
    .filter((u): u is { id: string; email: string; firstName: string } => !!u?.email);
}

async function notifyOrganizers(opts: {
  clubId: string;
  brand: Brand;
  slug: string;
  activityType: ActivityType;
  activityName: string;
  kind: OrganizerKind;
  playerNames: string;
  statusLabel: string;
  confirmedCount: number | null;
}): Promise<void> {
  const staff = await organizers(opts.clubId);
  if (staff.length === 0) return;
  const adminUrl = clubAppUrl(
    opts.slug,
    opts.activityType === 'tournament'
      ? '/admin/tournaments'
      : opts.activityType === 'lesson'
        ? '/admin/lessons'
        : '/admin/events',
  );
  for (const s of staff) {
    const mail = buildOrganizerEmail({
      staffFirstName: s.firstName,
      kind: opts.kind,
      activityType: opts.activityType,
      activityName: opts.activityName,
      playerNames: opts.playerNames,
      statusLabel: opts.statusLabel,
      confirmedCount: opts.confirmedCount,
      url: adminUrl,
      brand: opts.brand,
    });
    const notifType = opts.kind === 'registration' ? 'organizer.registration' : 'organizer.cancellation';
    const notifTitle = opts.kind === 'registration' ? 'Nouvelle inscription' : 'Désinscription';
    const notifBody =
      opts.kind === 'registration'
        ? `${opts.playerNames} — ${opts.activityName} (${opts.statusLabel}).`
        : `${opts.playerNames} s'est désinscrit de « ${opts.activityName} ».`;
    await dispatch({
      userId: s.id,
      clubId: opts.clubId,
      category: 'ORGANIZER',
      type: notifType,
      title: notifTitle,
      body: notifBody,
      url: adminUrl,
      email: { to: s.email, subject: mail.subject, html: mail.html, text: mail.text },
    });
  }
}

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

/** Retourne le titre et le corps de notif joueur selon l'action et le nom de l'activité. */
function playerNotifContent(
  action: PlayerAction,
  activityName: string,
): { title: string; body: string } {
  switch (action) {
    case 'confirmed':
      return { title: 'Inscription confirmée', body: `Ton inscription à « ${activityName} » est confirmée.` };
    case 'waitlisted':
      return {
        title: "Inscription en liste d'attente",
        body: `Tu es en liste d'attente pour « ${activityName} ».`,
      };
    case 'promoted':
      return {
        title: "Une place s'est libérée",
        body: `Tu passes de la liste d'attente à confirmé pour « ${activityName} ».`,
      };
    case 'cancelled':
      return { title: 'Inscription annulée', body: `Ton inscription à « ${activityName} » a été annulée.` };
  }
}

// ----------------------------------------------------------------- Tournois

const tournamentInclude = {
  tournament: {
    include: { club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } },
  },
  captain: { select: { id: true, email: true, firstName: true, lastName: true } },
  partner: { select: { id: true, email: true, firstName: true, lastName: true } },
} as const;

async function loadTournamentRegistration(registrationId: string) {
  return prisma.tournamentRegistration.findUnique({ where: { id: registrationId }, include: tournamentInclude });
}

async function sendTournamentPlayerEmails(
  reg: NonNullable<Awaited<ReturnType<typeof loadTournamentRegistration>>>,
  action: PlayerAction,
): Promise<void> {
  const t = reg.tournament;
  const brand = brandOf(t.club);
  const dateLabel = formatDateRangeFr(t.startTime, t.endTime, t.club.timezone);
  const url = clubAppUrl(t.club.slug, `/tournois/${t.id}`);
  const recipients = [
    { user: reg.captain, partner: reg.partner },
    { user: reg.partner, partner: reg.captain },
  ];
  for (const { user, partner } of recipients) {
    if (!user.email) continue;
    const mail = buildPlayerEmail({
      firstName: user.firstName,
      action,
      activityType: 'tournament',
      activityName: t.name,
      clubName: t.club.name,
      dateLabel,
      url,
      brand,
      partnerName: fullName(partner),
    });
    const notifType =
      action === 'confirmed'
        ? 'registration.confirmed'
        : action === 'waitlisted'
          ? 'registration.waitlisted'
          : action === 'promoted'
            ? 'registration.promoted'
            : 'registration.cancelled';
    const { title, body } = playerNotifContent(action, t.name);
    await dispatch({
      userId: user.id,
      clubId: t.club.id,
      category: 'MY_REGISTRATIONS',
      type: notifType,
      title,
      body,
      url,
      email: { to: user.email, subject: mail.subject, html: mail.html, text: mail.text },
    });
  }
}

export async function notifyTournamentRegistration(registrationId: string): Promise<void> {
  const reg = await loadTournamentRegistration(registrationId);
  if (!reg) return;
  const action: PlayerAction = reg.status === 'WAITLISTED' ? 'waitlisted' : 'confirmed';
  await sendTournamentPlayerEmails(reg, action);
  const confirmedCount = await prisma.tournamentRegistration.count({
    where: { tournamentId: reg.tournamentId, status: 'CONFIRMED' },
  });
  await notifyOrganizers({
    clubId: reg.tournament.clubId,
    brand: brandOf(reg.tournament.club),
    slug: reg.tournament.club.slug,
    activityType: 'tournament',
    activityName: reg.tournament.name,
    kind: 'registration',
    playerNames: `${fullName(reg.captain)} & ${fullName(reg.partner)}`,
    statusLabel: action === 'waitlisted' ? "en liste d'attente" : 'confirmée',
    confirmedCount,
  });
}

export async function notifyTournamentCancellation(registrationId: string): Promise<void> {
  const reg = await loadTournamentRegistration(registrationId);
  if (!reg) return;
  await sendTournamentPlayerEmails(reg, 'cancelled');
  await notifyOrganizers({
    clubId: reg.tournament.clubId,
    brand: brandOf(reg.tournament.club),
    slug: reg.tournament.club.slug,
    activityType: 'tournament',
    activityName: reg.tournament.name,
    kind: 'cancellation',
    playerNames: `${fullName(reg.captain)} & ${fullName(reg.partner)}`,
    statusLabel: '',
    confirmedCount: null,
  });
}

export async function notifyTournamentPromotion(registrationId: string): Promise<void> {
  const reg = await loadTournamentRegistration(registrationId);
  if (!reg) return;
  await sendTournamentPlayerEmails(reg, 'promoted');
}

// ------------------------------------------------------------------ Events

const eventInclude = {
  event: {
    include: { club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } },
  },
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
} as const;

async function loadEventRegistration(registrationId: string) {
  return prisma.eventRegistration.findUnique({ where: { id: registrationId }, include: eventInclude });
}

async function sendEventPlayerEmail(
  reg: NonNullable<Awaited<ReturnType<typeof loadEventRegistration>>>,
  action: PlayerAction,
): Promise<void> {
  const e = reg.event;
  if (!reg.user.email) return;
  const url = clubAppUrl(e.club.slug, `/events/${e.id}`);
  const mail = buildPlayerEmail({
    firstName: reg.user.firstName,
    action,
    activityType: 'event',
    activityName: e.name,
    clubName: e.club.name,
    dateLabel: formatDateRangeFr(e.startTime, e.endTime, e.club.timezone),
    url,
    brand: brandOf(e.club),
  });
  const notifType =
    action === 'confirmed'
      ? 'registration.confirmed'
      : action === 'waitlisted'
        ? 'registration.waitlisted'
        : action === 'promoted'
          ? 'registration.promoted'
          : 'registration.cancelled';
  const { title, body } = playerNotifContent(action, e.name);
  await dispatch({
    userId: reg.user.id,
    clubId: e.club.id,
    category: 'MY_REGISTRATIONS',
    type: notifType,
    title,
    body,
    url,
    email: { to: reg.user.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}

export async function notifyEventRegistration(registrationId: string): Promise<void> {
  const reg = await loadEventRegistration(registrationId);
  if (!reg) return;
  const action: PlayerAction = reg.status === 'WAITLISTED' ? 'waitlisted' : 'confirmed';
  await sendEventPlayerEmail(reg, action);
  const confirmedCount = await prisma.eventRegistration.count({
    where: { eventId: reg.eventId, status: 'CONFIRMED' },
  });
  await notifyOrganizers({
    clubId: reg.event.clubId,
    brand: brandOf(reg.event.club),
    slug: reg.event.club.slug,
    activityType: 'event',
    activityName: reg.event.name,
    kind: 'registration',
    playerNames: fullName(reg.user),
    statusLabel: action === 'waitlisted' ? "en liste d'attente" : 'confirmée',
    confirmedCount,
  });
}

export async function notifyEventCancellation(registrationId: string): Promise<void> {
  const reg = await loadEventRegistration(registrationId);
  if (!reg) return;
  await sendEventPlayerEmail(reg, 'cancelled');
  await notifyOrganizers({
    clubId: reg.event.clubId,
    brand: brandOf(reg.event.club),
    slug: reg.event.club.slug,
    activityType: 'event',
    activityName: reg.event.name,
    kind: 'cancellation',
    playerNames: fullName(reg.user),
    statusLabel: '',
    confirmedCount: null,
  });
}

export async function notifyEventPromotion(registrationId: string): Promise<void> {
  const reg = await loadEventRegistration(registrationId);
  if (!reg) return;
  await sendEventPlayerEmail(reg, 'promoted');
}

// ------------------------------------------------------ Parties ouvertes

/** Prévient l'organisateur (propriétaire de la résa) qu'un joueur a rejoint sa partie ouverte. */
export async function notifyOpenMatchJoin(reservationId: string, joinerUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: {
        select: {
          name: true, attributes: true,
          club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
        },
      },
      participants: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!resa) return;

  const organizerP = resa.participants.find((p) => p.isOrganizer);
  const organizer = organizerP?.user;
  const joiner = resa.participants.find((p) => p.userId === joinerUserId)?.user;
  if (!organizerP || !organizer?.email || !joiner) return;

  const club = resa.resource.club;
  const maxPlayers = playerCount((resa.resource.attributes as { format?: string } | null)?.format);
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/parties');
  const mail = buildMatchJoinEmail({
    organizerFirstName: organizer.firstName,
    joinerName: fullName(joiner),
    resourceName: resa.resource.name,
    dateLabel,
    clubName: club.name,
    spotsLeft: Math.max(0, maxPlayers - resa.participants.length),
    url,
    brand: brandOf(club),
  });
  await dispatch({
    userId: organizerP.userId, clubId: club.id, category: 'MY_GAMES', type: 'open_match.joined',
    title: 'Nouveau joueur dans ta partie', body: `${fullName(joiner)} a rejoint ta partie du ${dateLabel}.`,
    url, email: { to: organizer.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}

/** Prévient chaque partenaire (non-organisateur) qu'il a été ajouté à une partie. */
export async function notifyMatchPartnersInvited(reservationId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
      participants: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!resa) return;
  const organizer = resa.participants.find((p) => p.isOrganizer)?.user;
  const byName = organizer ? fullName(organizer) : null;
  const club = resa.resource.club;
  const brand = brandOf(club);
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/me/reservations');

  for (const p of resa.participants) {
    if (p.isOrganizer || !p.user.email) continue;
    const mail = buildMatchInviteEmail({
      recipientFirstName: p.user.firstName, byName,
      resourceName: resa.resource.name, dateLabel, clubName: club.name, url, brand,
    });
    await dispatch({
      userId: p.userId, clubId: club.id, category: 'MY_GAMES', type: 'match.partners_invited',
      title: 'Tu as été ajouté à une partie',
      body: `${byName ? byName + " t'a ajouté à" : "Tu as été ajouté à"} une partie le ${dateLabel}.`,
      url, email: { to: p.user.email, subject: mail.subject, html: mail.html, text: mail.text },
    });
  }
}

/** Prévient un joueur que l'organisateur l'a retiré d'une partie ouverte. */
export async function notifyOpenMatchRemoved(reservationId: string, removedUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { resource: { select: { name: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } } },
  });
  if (!resa) return;
  const member = await prisma.user.findUnique({ where: { id: removedUserId }, select: { firstName: true, email: true } });
  if (!member?.email) return;
  const club = resa.resource.club;
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/parties');
  const mail = buildMatchRemovedEmail({
    recipientFirstName: member.firstName, resourceName: resa.resource.name,
    dateLabel, clubName: club.name, url, brand: brandOf(club),
  });
  await dispatch({
    userId: removedUserId, clubId: club.id, category: 'MY_GAMES', type: 'open_match.removed',
    title: "Tu as été retiré d'une partie", body: `Tu as été retiré de la partie du ${dateLabel}.`,
    url, email: { to: member.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}

/** Prévient un joueur que l'organisateur l'a ajouté à une partie ouverte. */
export async function notifyOpenMatchAdded(reservationId: string, addedUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
      participants: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!resa) return;
  const organizer = resa.participants.find((p) => p.isOrganizer)?.user;
  const added = resa.participants.find((p) => p.userId === addedUserId)?.user;
  if (!added?.email) return;
  const club = resa.resource.club;
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/parties');
  const mail = buildMatchInviteEmail({
    recipientFirstName: added.firstName,
    byName: organizer ? fullName(organizer) : null,
    resourceName: resa.resource.name,
    dateLabel, clubName: club.name, url, brand: brandOf(club),
  });
  await dispatch({
    userId: addedUserId, clubId: club.id, category: 'MY_GAMES', type: 'open_match.added',
    title: 'Tu as été ajouté à une partie', body: `Tu as été ajouté à la partie du ${dateLabel}.`,
    url, email: { to: added.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}

/** Prévient l'organisateur qu'un joueur a quitté sa partie ouverte. */
export async function notifyOpenMatchLeft(reservationId: string, leaverUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, attributes: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
      participants: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!resa) return;
  const organizerP = resa.participants.find((p) => p.isOrganizer);
  if (!organizerP?.user?.email) return;
  const leaver = await prisma.user.findUnique({ where: { id: leaverUserId }, select: { firstName: true, lastName: true } });
  if (!leaver) return;
  const club = resa.resource.club;
  const maxPlayers = playerCount((resa.resource.attributes as { format?: string } | null)?.format);
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/parties');
  const mail = buildMatchLeftEmail({
    organizerFirstName: organizerP.user.firstName,
    leaverName: fullName(leaver),
    resourceName: resa.resource.name,
    dateLabel, clubName: club.name,
    spotsLeft: Math.max(0, maxPlayers - resa.participants.length),
    url, brand: brandOf(club),
  });
  await dispatch({
    userId: organizerP.userId, clubId: club.id, category: 'MY_GAMES', type: 'open_match.left',
    title: 'Un joueur a quitté ta partie', body: `${fullName(leaver)} a quitté ta partie du ${dateLabel}.`,
    url, email: { to: organizerP.user.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}

/** Prévient un membre qu'un gestionnaire vient de le rattacher à une réservation. */
export async function notifyReservationMemberAssigned(reservationId: string, memberUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { resource: { select: { name: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } } },
  });
  if (!resa) return;
  const member = await prisma.user.findUnique({ where: { id: memberUserId }, select: { firstName: true, email: true } });
  if (!member?.email) return;

  const club = resa.resource.club;
  const url = clubAppUrl(club.slug, '/me/reservations');
  const mail = buildMatchInviteEmail({
    recipientFirstName: member.firstName, byName: null,
    resourceName: resa.resource.name,
    dateLabel: formatDateRangeFr(resa.startTime, resa.endTime, club.timezone),
    clubName: club.name, url, brand: brandOf(club),
  });
  await dispatch({
    userId: memberUserId,
    clubId: club.id,
    category: 'MY_GAMES',
    type: 'reservation.member_assigned',
    title: "Ajout à une réservation",
    body: "Tu as été ajouté à une réservation par le club.",
    url,
    email: { to: member.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}

/** Prévient le joueur (propriétaire de la résa) du remboursement automatique à l'annulation. */
export async function notifyReservationRefunded(
  reservationId: string,
  refunds: Array<{ amount: string; method: string }>,
): Promise<void> {
  if (refunds.length === 0) return;
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      user: { select: { id: true, firstName: true, email: true } },
      resource: { select: { name: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
    },
  });
  if (!resa?.user?.email) return;
  const totalCents = refunds.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
  const amountLabel = (totalCents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €';
  const prepaid = refunds.some((r) => r.method === 'PACK_CREDIT' || r.method === 'WALLET');
  const club = resa.resource.club;
  const url = clubAppUrl(club.slug, '/me/reservations');
  const mail = buildRefundEmail({
    recipientFirstName: resa.user.firstName,
    resourceName: resa.resource.name,
    dateLabel: formatDateRangeFr(resa.startTime, resa.endTime, club.timezone),
    clubName: club.name, amountLabel, prepaid,
    url, brand: brandOf(club),
  });
  await dispatch({
    userId: resa.user.id,
    clubId: club.id,
    category: 'PAYMENTS',
    type: 'payment.refunded',
    title: "Remboursement",
    body: `Tu as été remboursé de ${amountLabel} pour ta réservation.`,
    url,
    email: { to: resa.user.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}

// ------------------------------------------------------------------- Cours (Lesson)

/**
 * Charge un LessonEnrollment avec tout le contexte nécessaire pour les emails.
 * Un enrollment peut être sur une lesson individuelle (lessonId) OU sur une série (seriesId).
 * Les deux cas sont gérés : on déduit club/coach/date depuis la source disponible.
 */
async function loadLessonEnrollment(enrollmentId: string) {
  return prisma.lessonEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      lesson: {
        include: {
          coach: { select: { name: true } },
          reservation: { select: { startTime: true, endTime: true } },
          club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
        },
      },
      series: {
        include: {
          coach: { select: { name: true } },
          club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
        },
      },
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });
}

type LessonEnrollmentLoaded = NonNullable<Awaited<ReturnType<typeof loadLessonEnrollment>>>;

/**
 * Construit le contexte commun (club, brand, dateLabel, url, activityName) à partir
 * d'un enrollment chargé — gère le cas lesson ET le cas series-only.
 */
function lessonEmailContext(enr: LessonEnrollmentLoaded) {
  const club = enr.lesson?.club ?? enr.series?.club;
  if (!club) return null;

  const brand = brandOf(club);
  const coachName = enr.lesson?.coach?.name ?? enr.series?.coach?.name ?? null;
  const activityName = coachName ? `Cours — ${coachName}` : 'Cours';

  let dateLabel: string;
  let url: string;

  if (enr.lesson) {
    const res = enr.lesson.reservation;
    dateLabel = formatDateRangeFr(res.startTime, res.endTime, club.timezone);
    url = clubAppUrl(club.slug, `/cours/${enr.lessonId}`);
  } else {
    // Inscription sur série uniquement — pas de séance unique de référence.
    dateLabel = ''; // la date précise n'est pas connue sans occurrence
    url = clubAppUrl(club.slug, '/events');
  }

  return { club, brand, activityName, dateLabel, url };
}

async function sendLessonPlayerEmail(enr: LessonEnrollmentLoaded, action: PlayerAction): Promise<void> {
  if (!enr.user.email) return;
  const ctx = lessonEmailContext(enr);
  if (!ctx) return;

  const mail = buildPlayerEmail({
    firstName: enr.user.firstName,
    action,
    activityType: 'lesson',
    activityName: ctx.activityName,
    clubName: ctx.club.name,
    dateLabel: ctx.dateLabel,
    url: ctx.url,
    brand: ctx.brand,
  });
  const notifType =
    action === 'confirmed'
      ? 'registration.confirmed'
      : action === 'waitlisted'
        ? 'registration.waitlisted'
        : action === 'promoted'
          ? 'registration.promoted'
          : 'registration.cancelled';
  const { title, body } = playerNotifContent(action, ctx.activityName);
  await dispatch({
    userId: enr.user.id,
    clubId: ctx.club.id,
    category: 'MY_REGISTRATIONS',
    type: notifType,
    title,
    body,
    url: ctx.url,
    email: { to: enr.user.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}

export async function notifyLessonEnrollment(enrollmentId: string): Promise<void> {
  const enr = await loadLessonEnrollment(enrollmentId);
  if (!enr) return;
  const action: PlayerAction = enr.status === 'WAITLISTED' ? 'waitlisted' : 'confirmed';
  await sendLessonPlayerEmail(enr, action);
  const ctx = lessonEmailContext(enr);
  if (!ctx) return;

  // Comptage des CONFIRMED dans le conteneur (lesson ou series)
  const confirmedCount = enr.lessonId
    ? await prisma.lessonEnrollment.count({ where: { lessonId: enr.lessonId, status: 'CONFIRMED' } })
    : enr.seriesId
      ? await prisma.lessonEnrollment.count({ where: { seriesId: enr.seriesId, status: 'CONFIRMED' } })
      : null;

  await notifyOrganizers({
    clubId: ctx.club.id,
    brand: ctx.brand,
    slug: ctx.club.slug,
    activityType: 'lesson',
    activityName: ctx.activityName,
    kind: 'registration',
    playerNames: fullName(enr.user),
    statusLabel: action === 'waitlisted' ? "en liste d'attente" : 'confirmée',
    confirmedCount,
  });
}

export async function notifyLessonCancellation(enrollmentId: string): Promise<void> {
  const enr = await loadLessonEnrollment(enrollmentId);
  if (!enr) return;
  await sendLessonPlayerEmail(enr, 'cancelled');
  const ctx = lessonEmailContext(enr);
  if (!ctx) return;

  await notifyOrganizers({
    clubId: ctx.club.id,
    brand: ctx.brand,
    slug: ctx.club.slug,
    activityType: 'lesson',
    activityName: ctx.activityName,
    kind: 'cancellation',
    playerNames: fullName(enr.user),
    statusLabel: '',
    confirmedCount: null,
  });
}

export async function notifyLessonPromotion(enrollmentId: string): Promise<void> {
  const enr = await loadLessonEnrollment(enrollmentId);
  if (!enr) return;
  await sendLessonPlayerEmail(enr, 'promoted');
}

// ---------------------------------------------------------- Commentaires de litige

/**
 * Prévient les autres participants d'un litige (4 joueurs + staff OWNER/ADMIN/STAFF − l'auteur)
 * qu'un nouveau message a été posté. Peut lever ; l'appelant enveloppe en best-effort.
 */
export async function notifyNewMatchComment(
  matchId: string, authorUserId: string, opts: { isFirst: boolean },
): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
      players: { include: { user: { select: { id: true, email: true, firstName: true } } } },
    },
  });
  if (!match) return;

  const last = await prisma.matchComment.findFirst({
    where: { matchId, userId: authorUserId },
    orderBy: { createdAt: 'desc' },
    select: { body: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (!last) return;

  const authorName = fullName(last.user);
  const excerpt = last.body.length > 280 ? last.body.slice(0, 277) + '…' : last.body;
  const scoreLine = setsToScoreLine(match.sets);
  const brand = brandOf(match.club);
  const matchUrl = clubAppUrl(match.club.slug, '/me/reservations');

  const staff = await prisma.clubMember.findMany({
    where: { clubId: match.club.id, role: { in: [ClubRole.OWNER, ClubRole.ADMIN, ClubRole.STAFF] } },
    select: { userId: true, user: { select: { email: true, firstName: true } } },
  });

  // Destinataires dédupliqués par email, l'auteur exclu.
  const recipients = new Map<string, { userId: string; email: string; firstName: string }>();
  for (const mp of match.players) {
    const u = mp.user;
    if (u.id !== authorUserId && u.email) recipients.set(u.email, { userId: u.id, email: u.email, firstName: u.firstName });
  }
  for (const s of staff) {
    if (s.userId !== authorUserId && s.user?.email) {
      recipients.set(s.user.email, { userId: s.userId, email: s.user.email, firstName: s.user.firstName });
    }
  }

  for (const r of recipients.values()) {
    const mail = buildMatchCommentEmail({
      recipientFirstName: r.firstName, authorName, isFirst: opts.isFirst,
      scoreLine, excerpt, matchUrl, brand,
    });
    await dispatch({
      userId: r.userId,
      clubId: match.club.id,
      category: 'MY_MATCHES',
      type: 'match.comment',
      title: "Nouveau message sur un litige",
      body: `${authorName} a écrit sur le litige (${scoreLine}).`,
      url: matchUrl,
      email: { to: r.email, subject: mail.subject, html: mail.html, text: mail.text },
    });
  }
}

// ---------------------------------------------------------- Confirmation match

/** Transforme [[6,4],[6,3]] → "6-4 / 6-3". */
function setsToScoreLine(sets: unknown): string {
  if (!Array.isArray(sets)) return '';
  return (sets as [number, number][])
    .map(([a, b]) => `${a}-${b}`)
    .join(' / ');
}

/**
 * Envoie aux 3 joueurs NON-auteurs un email leur demandant de confirmer (ou contester) le résultat.
 * Peut lever (DB/SMTP) ; l'appelant (match.service) enveloppe en best-effort.
 */
export async function notifyMatchPendingConfirmation(matchId: string): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
      creator: { select: { firstName: true, lastName: true } },
      players: { select: { userId: true, user: { select: { email: true, firstName: true } } } },
    },
  });
  if (!match) return;

  const scoreLine = setsToScoreLine(match.sets);
  const brand = brandOf(match.club);
  const matchUrl = clubAppUrl(match.club.slug, '/me/reservations');
  const authorName = fullName(match.creator);

  for (const mp of match.players) {
    if (mp.userId === match.createdByUserId) continue;
    if (!mp.user.email) continue;
    const mail = buildMatchConfirmEmail({
      brand,
      recipientFirstName: mp.user.firstName,
      scoreLine,
      matchUrl,
      authorName,
    });
    await dispatch({
      userId: mp.userId,
      clubId: match.club.id,
      category: 'MY_MATCHES',
      type: 'match.pending_confirmation',
      title: "Confirme le résultat",
      body: `${authorName} a saisi un score (${scoreLine}) — confirme ou conteste.`,
      url: matchUrl,
      email: { to: mp.user.email, subject: mail.subject, html: mail.html, text: mail.text },
    });
  }
}

export async function notifyReservationCancelled(reservationId: string, actorUserId?: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: {
        select: { name: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } },
      },
      participants: { include: { user: { select: { id: true, firstName: true } } } },
    },
  });
  if (!resa) return;
  const club = resa.resource.club;
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/me/reservations');
  for (const p of resa.participants) {
    if (p.userId === actorUserId) continue;
    await dispatch({
      userId: p.userId,
      clubId: club.id,
      category: 'MY_GAMES',
      type: 'reservation.cancelled',
      title: "Réservation annulée",
      body: `Ta réservation du ${dateLabel} a été annulée.`,
      url,
    });
  }
}

export async function notifyReservationRescheduled(reservationId: string, actorUserId?: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: {
        select: { name: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } },
      },
      participants: { include: { user: { select: { id: true, firstName: true } } } },
    },
  });
  if (!resa) return;
  const club = resa.resource.club;
  const newDateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/me/reservations');
  for (const p of resa.participants) {
    if (p.userId === actorUserId) continue;
    await dispatch({
      userId: p.userId,
      clubId: club.id,
      category: 'MY_GAMES',
      type: 'reservation.rescheduled',
      title: "Réservation déplacée",
      body: `Ta réservation a été déplacée au ${newDateLabel}.`,
      url,
    });
  }
}

export async function notifyActivityCancelledByClub(
  kind: 'tournament' | 'event' | 'lesson',
  activityId: string,
): Promise<void> {
  if (kind === 'tournament') {
    const tournament = await prisma.tournament.findUnique({
      where: { id: activityId },
      include: {
        club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
        registrations: {
          where: { status: { in: ['CONFIRMED', 'WAITLISTED'] } },
          include: {
            captain: { select: { id: true, email: true, firstName: true } },
            partner: { select: { id: true, email: true, firstName: true } },
          },
        },
      },
    });
    if (!tournament) return;
    const club = tournament.club;
    const brand = brandOf(club);
    const dateLabel = tournament.startTime ? formatDateRangeFr(tournament.startTime, tournament.endTime, club.timezone) : '';
    const url = clubAppUrl(club.slug, `/tournois/${tournament.id}`);
    const seen = new Set<string>();
    for (const reg of tournament.registrations) {
      for (const user of [reg.captain, reg.partner]) {
        if (!user || seen.has(user.id)) continue;
        seen.add(user.id);
        const mail = buildPlayerEmail({
          firstName: user.firstName,
          action: 'cancelled',
          activityType: 'tournament',
          activityName: tournament.name,
          clubName: club.name,
          dateLabel,
          url,
          brand,
        });
        await dispatch({
          userId: user.id,
          clubId: club.id,
          category: 'MY_REGISTRATIONS',
          type: 'activity.cancelled_by_club',
          title: "Annulé par le club",
          body: `« ${tournament.name} » a été annulé par le club.`,
          url,
          email: user.email ? { to: user.email, subject: mail.subject, html: mail.html, text: mail.text } : undefined,
        });
      }
    }
  } else if (kind === 'event') {
    const event = await prisma.clubEvent.findUnique({
      where: { id: activityId },
      include: {
        club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
        registrations: {
          where: { status: { in: ['CONFIRMED', 'WAITLISTED'] } },
          include: { user: { select: { id: true, email: true, firstName: true } } },
        },
      },
    });
    if (!event) return;
    const club = event.club;
    const brand = brandOf(club);
    const dateLabel = formatDateRangeFr(event.startTime, event.endTime ?? event.startTime, club.timezone);
    const url = clubAppUrl(club.slug, `/events/${event.id}`);
    for (const reg of event.registrations) {
      const user = reg.user;
      const mail = buildPlayerEmail({
        firstName: user.firstName,
        action: 'cancelled',
        activityType: 'event',
        activityName: event.name,
        clubName: club.name,
        dateLabel,
        url,
        brand,
      });
      await dispatch({
        userId: user.id,
        clubId: club.id,
        category: 'MY_REGISTRATIONS',
        type: 'activity.cancelled_by_club',
        title: "Annulé par le club",
        body: `« ${event.name} » a été annulé par le club.`,
        url,
        email: user.email ? { to: user.email, subject: mail.subject, html: mail.html, text: mail.text } : undefined,
      });
    }
  } else {
    // kind === 'lesson'
    const lesson = await prisma.lesson.findUnique({
      where: { id: activityId },
      include: {
        club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
        coach: { select: { name: true } },
        reservation: { select: { startTime: true, endTime: true } },
        enrollments: {
          where: { status: { in: ['CONFIRMED', 'WAITLISTED'] } },
          include: { user: { select: { id: true, email: true, firstName: true } } },
        },
      },
    });
    if (!lesson) return;
    const club = lesson.club;
    const brand = brandOf(club);
    const activityName = lesson.coach?.name ? `Cours — ${lesson.coach.name}` : 'Cours';
    const dateLabel = formatDateRangeFr(lesson.reservation.startTime, lesson.reservation.endTime, club.timezone);
    const url = clubAppUrl(club.slug, `/cours/${lesson.id}`);
    for (const enr of lesson.enrollments) {
      const user = enr.user;
      const mail = buildPlayerEmail({
        firstName: user.firstName,
        action: 'cancelled',
        activityType: 'lesson',
        activityName,
        clubName: club.name,
        dateLabel,
        url,
        brand,
      });
      await dispatch({
        userId: user.id,
        clubId: club.id,
        category: 'MY_REGISTRATIONS',
        type: 'activity.cancelled_by_club',
        title: "Annulé par le club",
        body: `« ${activityName} » a été annulé par le club.`,
        url,
        email: user.email ? { to: user.email, subject: mail.subject, html: mail.html, text: mail.text } : undefined,
      });
    }
  }
}
