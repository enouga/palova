import { Brand, escapeHtml, renderLayout } from './layout';

export interface BuiltEmail { subject: string; html: string; text: string }

export interface ClubMessageReportEmailInput {
  authorName: string;
  excerpt: string;
  court: string;
  when: string;
  url: string;
  brand: Brand;
}

/** Email au staff OWNER/ADMIN du club : un message du chat de partie a été signalé. */
export function buildClubMessageReportEmail(i: ClubMessageReportEmailInput): BuiltEmail {
  const subject = `Signalement d'un message — ${i.brand.name}`;
  const introHtml = `<p style="margin:0;">Un membre a signalé un message de <strong>${escapeHtml(i.authorName)}</strong> dans le chat d'une partie (${escapeHtml(i.court)}, ${escapeHtml(i.when)}).</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading: 'Nouveau signalement',
    introHtml,
    infoRows: [{ label: 'Extrait du message', value: i.excerpt }],
    ctaLabel: 'Voir les signalements',
    ctaUrl: i.url,
  });
  const text = [
    'Nouveau signalement',
    '',
    `${i.authorName} — ${i.court}, ${i.when}`,
    `Extrait : ${i.excerpt}`,
    '',
    `Voir les signalements : ${i.url}`,
  ].join('\n');
  return { subject, html, text };
}

export interface PlatformMessageReportEmailInput {
  authorName: string;
  excerpt: string;
  hasImage: boolean;
  url: string;
  brand: Brand;
}

/** Email aux superadmins plateforme : un message privé (DM) a été signalé. */
export function buildPlatformMessageReportEmail(i: PlatformMessageReportEmailInput): BuiltEmail {
  const subject = "Signalement d'un message privé";
  const introHtml = `<p style="margin:0;">Un message privé de <strong>${escapeHtml(i.authorName)}</strong> a été signalé.${i.hasImage ? ' Il contient une photo.' : ''}</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading: 'Nouveau signalement',
    introHtml,
    infoRows: [{ label: 'Extrait du message', value: i.excerpt }],
    ctaLabel: 'Voir les signalements',
    ctaUrl: i.url,
  });
  const text = [
    'Nouveau signalement (messagerie privée)',
    '',
    `Auteur : ${i.authorName}`,
    `Extrait : ${i.excerpt}`,
    i.hasImage ? 'Contient une photo.' : '',
    '',
    `Voir les signalements : ${i.url}`,
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}
