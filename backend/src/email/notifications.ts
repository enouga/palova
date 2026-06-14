import { ClubRole } from '@prisma/client';
import { prisma } from '../db/prisma';
import { sendMail } from './mailer';
import { absoluteAsset, clubAppUrl, formatDateRangeFr } from './links';
import { Brand, PALOVA_BRAND } from './templates/layout';
import {
  ActivityType,
  OrganizerKind,
  PlayerAction,
  buildOrganizerEmail,
  buildPlayerEmail,
} from './templates/emails';

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
async function organizers(clubId: string): Promise<Array<{ email: string; firstName: string }>> {
  const members = await prisma.clubMember.findMany({
    where: { clubId, role: { in: [ClubRole.OWNER, ClubRole.ADMIN] } },
    select: { user: { select: { email: true, firstName: true } } },
  });
  return members.map((m) => m.user).filter((u): u is { email: string; firstName: string } => !!u?.email);
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
  const adminUrl = clubAppUrl(opts.slug, opts.activityType === 'tournament' ? '/admin/tournaments' : '/admin/events');
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
    await sendMail({ to: s.email, subject: mail.subject, html: mail.html, text: mail.text });
  }
}

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

// ----------------------------------------------------------------- Tournois

const tournamentInclude = {
  tournament: {
    include: { club: { select: { name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } },
  },
  captain: { select: { email: true, firstName: true, lastName: true } },
  partner: { select: { email: true, firstName: true, lastName: true } },
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
    await sendMail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
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
    include: { club: { select: { name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } },
  },
  user: { select: { email: true, firstName: true, lastName: true } },
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
  const mail = buildPlayerEmail({
    firstName: reg.user.firstName,
    action,
    activityType: 'event',
    activityName: e.name,
    clubName: e.club.name,
    dateLabel: formatDateRangeFr(e.startTime, e.endTime, e.club.timezone),
    url: clubAppUrl(e.club.slug, `/events/${e.id}`),
    brand: brandOf(e.club),
  });
  await sendMail({ to: reg.user.email, subject: mail.subject, html: mail.html, text: mail.text });
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
