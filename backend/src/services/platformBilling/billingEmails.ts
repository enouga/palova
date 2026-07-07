// Emails PLATEFORME (identité Palova) envoyés au gérant du club — hors registre des
// emails personnalisables par club (qui sont les emails club → joueurs).
import { prisma } from '../../db/prisma';
import { sendMail } from '../../email/mailer';
import { renderLayout, PALOVA_BRAND, escapeHtml } from '../../email/templates/layout';
import { clubAppUrl } from '../../email/links';
import { tierLabel, tierPriceCents, BillingInterval } from './tiers';

export interface BuiltMail { subject: string; html: string; text: string }

/** 2900 → « 29 € », 2950 → « 29,50 € » (HT). Espaces insécables normalisées. */
export function eurosLabel(cents: number): string {
  const euros = cents / 100;
  const s = (Number.isInteger(euros)
    ? euros.toLocaleString('fr-FR')
    : euros.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  ).replace(/[  ]/g, ' ');
  return `${s} €`;
}

function intervalLabel(interval: BillingInterval): string {
  return interval === 'year' ? 'annuel' : 'mensuel';
}

function priceLine(tier: number, interval: BillingInterval): string {
  const amount = eurosLabel(tierPriceCents(tier, interval));
  return interval === 'year' ? `${amount} HT/an` : `${amount} HT/mois`;
}

export function buildOverFreeTierEmail(input: {
  clubName: string; slug: string; activeMembers: number; observedTier: number;
}): BuiltMail {
  const url = clubAppUrl(input.slug, '/admin/billing');
  const price = priceLine(input.observedTier, 'month');
  const subject = `Palova — ${input.clubName} dépasse le palier gratuit`;
  const introHtml = `<p>Votre club compte <strong>${input.activeMembers} membres actifs</strong> sur les 90 derniers jours, `
    + `soit le palier <strong>${escapeHtml(tierLabel(input.observedTier))}</strong> de l'offre Palova (${escapeHtml(price)}).</p>`
    + `<p>Toutes vos fonctionnalités restent ouvertes — régularisez votre abonnement quand vous voulez depuis votre espace d'administration.</p>`;
  const html = renderLayout({
    brand: PALOVA_BRAND,
    heading: 'Votre club grandit 🎉',
    introHtml,
    infoRows: [
      { label: 'Membres actifs', value: String(input.activeMembers) },
      { label: 'Palier', value: tierLabel(input.observedTier) },
      { label: 'Tarif', value: price },
    ],
    ctaLabel: 'Souscrire',
    ctaUrl: url,
  });
  const text = `Votre club compte ${input.activeMembers} membres actifs (palier ${tierLabel(input.observedTier)}, ${price}). `
    + `Toutes vos fonctionnalités restent ouvertes — souscrivez depuis ${url}`;
  return { subject, html, text };
}

export function buildTierChangeEmail(input: {
  clubName: string; slug: string; fromTier: number; toTier: number; interval: BillingInterval;
}): BuiltMail {
  const url = clubAppUrl(input.slug, '/admin/billing');
  const subject = `Palova — changement de palier pour ${input.clubName}`;
  const isFree = input.toTier === 0;
  const introHtml = isFree
    ? `<p>Votre club est repassé sous les 50 membres actifs : votre abonnement s'arrêtera à la fin de la période en cours `
      + `et vous repasserez au <strong>palier gratuit</strong>. Rien d'autre ne change.</p>`
    : `<p>Le nombre de membres actifs de votre club correspond désormais au palier `
      + `<strong>${escapeHtml(tierLabel(input.toTier))}</strong>. Votre abonnement passera à `
      + `<strong>${escapeHtml(priceLine(input.toTier, input.interval))}</strong> à votre prochaine facture — `
      + `aucun prorata, le prix de la période en cours ne change pas.</p>`;
  const html = renderLayout({
    brand: PALOVA_BRAND,
    heading: 'Changement de palier',
    introHtml,
    infoRows: isFree ? [] : [
      { label: 'Ancien palier', value: tierLabel(input.fromTier) },
      { label: 'Nouveau palier', value: tierLabel(input.toTier) },
      { label: 'Nouveau tarif', value: priceLine(input.toTier, input.interval) },
    ],
    ctaLabel: 'Voir mon abonnement',
    ctaUrl: url,
  });
  const text = isFree
    ? `Votre club repasse au palier gratuit à la fin de la période en cours. Détails : ${url}`
    : `Nouveau palier ${tierLabel(input.toTier)} : ${priceLine(input.toTier, input.interval)} à la prochaine facture. Détails : ${url}`;
  return { subject, html, text };
}

export function buildSubscribedEmail(input: {
  clubName: string; slug: string; tier: number; interval: BillingInterval;
}): BuiltMail {
  const url = clubAppUrl(input.slug, '/admin/billing');
  const subject = `Palova — abonnement activé pour ${input.clubName}`;
  const introHtml = `<p>Merci ! L'abonnement <strong>${escapeHtml(tierLabel(input.tier))}</strong> `
    + `(${intervalLabel(input.interval)}, ${escapeHtml(priceLine(input.tier, input.interval))}) est actif. `
    + `Vos factures sont disponibles à tout moment depuis « Gérer mon abonnement ».</p>`;
  const html = renderLayout({
    brand: PALOVA_BRAND,
    heading: 'Abonnement activé',
    introHtml,
    infoRows: [
      { label: 'Palier', value: tierLabel(input.tier) },
      { label: 'Cadence', value: intervalLabel(input.interval) },
      { label: 'Tarif', value: priceLine(input.tier, input.interval) },
    ],
    ctaLabel: 'Mon abonnement',
    ctaUrl: url,
  });
  const text = `Abonnement Palova actif : ${tierLabel(input.tier)}, ${priceLine(input.tier, input.interval)}. ${url}`;
  return { subject, html, text };
}

/** Emails des gérants OWNER du club (repli legalEmail). */
async function ownerEmails(clubId: string): Promise<string[]> {
  const owners = await prisma.clubMember.findMany({
    where: { clubId, role: 'OWNER' },
    select: { user: { select: { email: true } } },
  });
  const emails = owners.map((o) => o.user.email).filter((e): e is string => Boolean(e));
  if (emails.length > 0) return emails;
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { legalEmail: true } });
  return club?.legalEmail ? [club.legalEmail] : [];
}

/** Envoi best-effort aux gérants — un échec SMTP ne casse JAMAIS l'appelant (cron/webhook). */
export async function sendToOwners(clubId: string, mail: BuiltMail): Promise<void> {
  try {
    const emails = await ownerEmails(clubId);
    for (const to of emails) {
      await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    }
  } catch (err) {
    console.error('[billing] email non envoyé :', err);
  }
}
