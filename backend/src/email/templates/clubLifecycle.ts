import { Brand, escapeHtml, renderLayout } from './layout';

export interface BuiltEmail { subject: string; html: string; text: string }

export interface NewClubEmailInput {
  clubName: string; clubUrl: string; city: string | null;
  ownerName: string; ownerEmail: string; ownerPhone: string;
  siret: string; legalName: string | null; verified: boolean;
  url: string; brand: Brand;
}

/** Email aux superadmins : un club vient d'être créé en self-service. */
export function buildNewClubEmail(i: NewClubEmailInput): BuiltEmail {
  const badge = i.verified ? '✓ vérifié' : '⚠ non vérifié (API indisponible)';
  const subject = `Nouveau club : ${i.clubName}`;
  const introHtml = `<p style="margin:0;">Un club vient d'être créé sur Palova : <strong>${escapeHtml(i.clubName)}</strong>${i.city ? ` (${escapeHtml(i.city)})` : ''}.</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading: 'Nouveau club créé',
    introHtml,
    infoRows: [
      { label: 'Club', value: i.clubName },
      { label: 'URL', value: i.clubUrl },
      { label: 'Gérant', value: `${i.ownerName} · ${i.ownerEmail} · ${i.ownerPhone}` },
      { label: 'SIRET', value: `${i.siret} — ${badge}` },
      ...(i.legalName ? [{ label: 'Raison sociale', value: i.legalName }] : []),
    ],
    ctaLabel: 'Voir les clubs',
    ctaUrl: i.url,
  });
  const text = [
    'Nouveau club créé', '',
    `Club : ${i.clubName}${i.city ? ` (${i.city})` : ''}`,
    `URL : ${i.clubUrl}`,
    `Gérant : ${i.ownerName} · ${i.ownerEmail} · ${i.ownerPhone}`,
    `SIRET : ${i.siret} — ${badge}`,
    i.legalName ? `Raison sociale : ${i.legalName}` : '',
    '', `Voir les clubs : ${i.url}`,
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}

export interface ClubOwnerEmailInput { clubName: string; adminUrl: string; brand: Brand }

/** Relance J+15 au gérant d'un club encore sans terrain (ton accompagnement). */
export function buildClubSetupReminderEmail(i: ClubOwnerEmailInput): BuiltEmail {
  const subject = `Besoin d'aide pour démarrer ${i.clubName} ?`;
  const introHtml = `<p style="margin:0;">Votre club <strong>${escapeHtml(i.clubName)}</strong> n'a pas encore de terrain. Ajoutez-en un pour ouvrir les réservations — on est là si vous avez besoin d'aide.</p>`;
  const html = renderLayout({
    brand: i.brand, preheader: subject, heading: 'Prêt à démarrer ?',
    introHtml, ctaLabel: 'Configurer mon club', ctaUrl: i.adminUrl,
  });
  const text = [
    'Prêt à démarrer ?', '',
    `Votre club ${i.clubName} n'a pas encore de terrain. Ajoutez-en un pour ouvrir les réservations.`,
    '', `Configurer mon club : ${i.adminUrl}`,
  ].join('\n');
  return { subject, html, text };
}

/** Suspension J+30 au gérant : club mis en veille faute de terrain. */
export function buildClubAutoSuspendedEmail(i: ClubOwnerEmailInput): BuiltEmail {
  const subject = `${i.clubName} a été mis en veille`;
  const introHtml = `<p style="margin:0;">Faute de terrain configuré, <strong>${escapeHtml(i.clubName)}</strong> a été mis en veille. Répondez à cet email ou reconfigurez votre club pour le réactiver.</p>`;
  const html = renderLayout({
    brand: i.brand, preheader: subject, heading: 'Club mis en veille',
    introHtml, ctaLabel: 'Réactiver mon club', ctaUrl: i.adminUrl,
  });
  const text = [
    'Club mis en veille', '',
    `Faute de terrain configuré, ${i.clubName} a été mis en veille. Répondez à cet email pour le réactiver.`,
    '', `Réactiver mon club : ${i.adminUrl}`,
  ].join('\n');
  return { subject, html, text };
}
