// Accusé de réception d'un ticket support club → Palova. Identité PALOVA (jamais brandé
// club : c'est Palova qui répond au club) — hors registre des emails personnalisables.
import { Brand, escapeHtml, renderLayout } from './layout';
import type { BuiltEmail } from './emails';

export interface SupportAckInput {
  number: number | null; // null = ticket parti par le repli email, pas de n° GitHub
  subject: string;
  clubName: string;
  brand: Brand;
}

export function buildSupportAckEmail(i: SupportAckInput): BuiltEmail {
  const ref = i.number != null ? ` #${i.number}` : '';
  const subject = `Votre demande${ref} a bien été reçue`;
  const introHtml = `<p style="margin:0;">Nous avons bien reçu votre demande${ref ? ` <strong>${escapeHtml(ref.trim())}</strong>` : ''} « ${escapeHtml(i.subject)} » pour ${escapeHtml(i.clubName)}. Nous revenons vers vous par email au plus vite.</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading: 'Demande transmise à Palova',
    introHtml,
    footerNote: 'Cet email est un accusé de réception automatique.',
  });
  const text = [
    `Nous avons bien reçu votre demande${ref} « ${i.subject} » pour ${i.clubName}.`,
    'Nous revenons vers vous par email au plus vite.',
  ].join('\n');
  return { subject, html, text };
}
