import nodemailer from 'nodemailer';
import { Brand, PALOVA_BRAND } from './templates/layout';
import { buildVerificationEmail, buildPasswordResetEmail } from './templates/emails';
import { platformAsset } from './links';

const FROM = process.env.SMTP_FROM || 'Palova <noreply@palova.fr>';

// Marque Palova pour les emails plateforme : logo en URL absolue (atteignable depuis un client mail).
const PALOVA_BRAND_EMAIL: Brand = { ...PALOVA_BRAND, logoUrl: platformAsset('/icon-192.png') };

// Transport SMTP si configuré (prod), sinon null → fallback console (dev).
// Timeouts explicites : sans eux, nodemailer attend jusqu'à 2 min (défaut connectionTimeout)
// avant d'abandonner un hôte injoignable — un SMTP en panne/filtré bloquerait alors toute
// notification best-effort qui l'attend pour un temps déraisonnable.
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    })
  : null;

/** En dev sans SMTP, on peut renvoyer le code dans la réponse API pour tester sans email réel. */
export const emailDevMode = !process.env.SMTP_HOST && process.env.NODE_ENV !== 'production';

export interface MailInput {
  /** Destinataire(s). Un email par appel = un destinataire (on personnalise par joueur). */
  to: string | string[];
  subject: string;
  /** Corps HTML (emails « jolis »). Optionnel : nodemailer envoie aussi le repli texte. */
  html?: string;
  /** Repli texte brut, toujours fourni (clients sans HTML, délivrabilité). */
  text: string;
}

/** Envoi générique. En dev sans SMTP configuré, logge au lieu d'envoyer. */
export async function sendMail({ to, subject, html, text }: MailInput): Promise<void> {
  if (!transporter) {
    const rcpt = Array.isArray(to) ? to.join(', ') : to;
    console.log(`[mailer:dev] → ${rcpt} | ${subject}`);
    return;
  }
  await transporter.sendMail({ from: FROM, to, subject, html, text });
}

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  if (!transporter) {
    // Fallback dev : pas d'envoi réel, on logge le code.
    console.log(`[mailer:dev] Code de validation pour ${to} : ${code}`);
    return;
  }
  const mail = buildVerificationEmail(code, PALOVA_BRAND_EMAIL);
  await transporter.sendMail({ from: FROM, to, subject: mail.subject, html: mail.html, text: mail.text });
}

export async function sendPasswordResetEmail(to: string, code: string): Promise<void> {
  if (!transporter) {
    // Fallback dev : pas d'envoi réel, on logge le code.
    console.log(`[mailer:dev] Code de réinitialisation pour ${to} : ${code}`);
    return;
  }
  const mail = buildPasswordResetEmail(code, PALOVA_BRAND_EMAIL);
  await transporter.sendMail({ from: FROM, to, subject: mail.subject, html: mail.html, text: mail.text });
}
