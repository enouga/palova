import cron from 'node-cron';
import { prisma } from '../db/prisma';
import { sendMail } from '../email/mailer';
import { buildClubSetupReminderEmail, buildClubAutoSuspendedEmail, buildClubAutoSuspendedAdminEmail } from '../email/templates/clubLifecycle';
import { PALOVA_BRAND } from '../email/templates/layout';
import { clubAppUrl, platformAsset } from '../email/links';
import { reportError } from '../observability/reportError';

export const REMINDER_DAYS = 15; // relance : club sans terrain depuis 15 j
export const SUSPEND_DAYS = 30;  // suspension : depuis 30 j ET relancé il y a ≥ 7 j
const MIN_GAP_DAYS = 7;          // délai plancher garanti entre relance et suspension

const dayMs = 86400000;

/**
 * Ménage des clubs fantômes. Cible : club ACTIVE, avec SIRET (self-service), SANS aucun
 * terrain, jamais auto-suspendu. Relance à J+15, suspend à J+30 (si relancé il y a ≥ 7 j).
 * best-effort par club — un email en échec ne bloque pas les autres. Testable (now injecté).
 */
export async function runClubJanitor(now: Date): Promise<void> {
  const clubs = await prisma.club.findMany({
    where: {
      status: 'ACTIVE',
      siret: { not: null },
      autoSuspendedAt: null,
      resources: { none: {} },
    },
    select: {
      id: true, slug: true, name: true, createdAt: true, setupReminderSentAt: true,
      members: { where: { role: 'OWNER' }, select: { user: { select: { email: true } } } },
    },
  });

  const reminderBefore = new Date(now.getTime() - REMINDER_DAYS * dayMs);
  const suspendBefore = new Date(now.getTime() - SUSPEND_DAYS * dayMs);
  const gapBefore = new Date(now.getTime() - MIN_GAP_DAYS * dayMs);

  for (const club of clubs) {
    const ownerEmail = club.members[0]?.user?.email ?? null;
    const adminUrl = clubAppUrl(club.slug, '/admin');
    try {
      // Suspension : vieux de 30 j ET relancé il y a ≥ 7 j.
      if (club.setupReminderSentAt && club.createdAt < suspendBefore && club.setupReminderSentAt < gapBefore) {
        await prisma.club.update({ where: { id: club.id }, data: { status: 'SUSPENDED', autoSuspendedAt: now } });
        if (ownerEmail) {
          const mail = buildClubAutoSuspendedEmail({ clubName: club.name, adminUrl, brand: PALOVA_BRAND });
          await sendMail({ to: ownerEmail, subject: mail.subject, html: mail.html, text: mail.text });
        }
        const admins = await prisma.user.findMany({ where: { isSuperAdmin: true, deletedAt: null }, select: { email: true } });
        const adminMail = buildClubAutoSuspendedAdminEmail({ clubName: club.name, clubsUrl: platformAsset('/superadmin/clubs'), brand: PALOVA_BRAND });
        await Promise.all(
          admins.map((a) => a.email)
            .filter((e): e is string => !!e)
            .map((to) => sendMail({ to, subject: adminMail.subject, html: adminMail.html, text: adminMail.text })
              .catch((err) => reportError(err, { source: 'janitor:superadminEmail' }))),
        );
        continue;
      }
      // Relance : vieux de 15 j et jamais relancé.
      if (!club.setupReminderSentAt && club.createdAt < reminderBefore) {
        await prisma.club.update({ where: { id: club.id }, data: { setupReminderSentAt: now } });
        if (ownerEmail) {
          const mail = buildClubSetupReminderEmail({ clubName: club.name, adminUrl, brand: PALOVA_BRAND });
          await sendMail({ to: ownerEmail, subject: mail.subject, html: mail.html, text: mail.text });
        }
      }
    } catch (err) {
      reportError(err, { source: 'janitor:club' });
    }
  }
}

export function startClubJanitorJob(): void {
  // 04:15 Europe/Paris chaque nuit (après les autres jobs nocturnes).
  cron.schedule('15 4 * * *', () => {
    runClubJanitor(new Date()).catch((err) => reportError(err, { source: 'janitor:run' }));
  }, { timezone: 'Europe/Paris' });
  console.log('[janitor] Job de ménage des clubs démarré (04:15 chaque nuit)');
}
