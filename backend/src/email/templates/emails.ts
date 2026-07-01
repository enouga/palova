import { Brand, escapeHtml, renderLayout } from './layout';

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export interface BroadcastEmailInput {
  title: string;
  body: string;
  /** URL explicite (deep link) ; si absent, on utilise l'app du club. */
  url?: string | null;
  brand: Brand;
}

/** Email de diffusion envoyé par un club à tous ses membres actifs. */
export function buildBroadcastEmail(i: BroadcastEmailInput): BuiltEmail {
  const subject = `${i.title} — ${i.brand.name}`;
  const introHtml = `<p style="margin:0;">${escapeHtml(i.body)}</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: i.title,
    heading: i.title,
    introHtml,
    ctaLabel: 'Voir',
    ctaUrl: i.url ?? undefined,
  });
  const text = [i.title, '', i.body, '', i.url ? `Lien : ${i.url}` : ''].filter(Boolean).join('\n');
  return { subject, html, text };
}

/** Email de validation d'inscription : code à 6 chiffres mis en avant, au gabarit Palova. */
export function buildVerificationEmail(code: string, brand: Brand): BuiltEmail {
  const subject = 'Votre code de validation Palova';
  const introHtml =
    "<p style=\"margin:0;\">Voici votre code de validation. Saisissez-le sur la page d'inscription pour activer votre compte.</p>";
  const html = renderLayout({
    brand,
    preheader: `${subject} — il expire dans 15 minutes.`,
    heading: 'Bienvenue sur Palova 👋',
    introHtml,
    codeBlock: { code, caption: 'Votre code' },
    footerNote:
      "Ce code expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.",
  });
  const text = [
    'Bienvenue sur Palova !',
    '',
    `Votre code de validation : ${code}`,
    'Il expire dans 15 minutes.',
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.",
  ].join('\n');
  return { subject, html, text };
}

/** Email de réinitialisation de mot de passe : code à 6 chiffres mis en avant. */
export function buildPasswordResetEmail(code: string, brand: Brand): BuiltEmail {
  const subject = 'Réinitialisation de votre mot de passe Palova';
  const introHtml =
    "<p style=\"margin:0;\">Vous avez demandé à réinitialiser votre mot de passe. Saisissez ce code pour en choisir un nouveau.</p>";
  const html = renderLayout({
    brand,
    preheader: `${subject} — il expire dans 15 minutes.`,
    heading: 'Réinitialisation du mot de passe 🔒',
    introHtml,
    codeBlock: { code, caption: 'Votre code' },
    footerNote:
      "Ce code expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email : votre mot de passe reste inchangé.",
  });
  const text = [
    'Réinitialisation de votre mot de passe Palova',
    '',
    `Votre code : ${code}`,
    'Il expire dans 15 minutes.',
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.",
  ].join('\n');
  return { subject, html, text };
}
