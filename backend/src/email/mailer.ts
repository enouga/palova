import nodemailer from 'nodemailer';

const FROM = process.env.SMTP_FROM || 'Palova <noreply@palova.fr>';

// Transport SMTP si configuré (prod), sinon null → fallback console (dev).
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

/** En dev sans SMTP, on peut renvoyer le code dans la réponse API pour tester sans email réel. */
export const emailDevMode = !process.env.SMTP_HOST && process.env.NODE_ENV !== 'production';

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const subject = 'Votre code de validation Palova';
  const text = `Bienvenue sur Palova !\n\nVotre code de validation : ${code}\nIl expire dans 15 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`;
  if (!transporter) {
    // Fallback dev : pas d'envoi réel, on logge le code.
    console.log(`[mailer:dev] Code de validation pour ${to} : ${code}`);
    return;
  }
  await transporter.sendMail({ from: FROM, to, subject, text });
}
