// Layout HTML d'email, sans dépendance : tables + CSS inline (la seule mise en forme
// qui survit à la plupart des clients mail). Aux couleurs du club (accent + logo) si
// disponibles, repli identité Palova sinon.

export interface Brand {
  name: string;
  logoUrl: string | null;
  accentColor: string;
}

// Identité Palova = bleu primaire du site (ACCENTS.blue). Le logo est injecté par l'appelant
// (URL absolue via links.platformAsset) car il dépend du domaine canonique.
export const PALOVA_BRAND: Brand = { name: 'Palova', logoUrl: null, accentColor: '#5e93da' };

// Bleu nuit d'ancrage du dégradé d'en-tête (= HERO_NAVY du site pour l'accent bleu).
const HEADER_DARK_FACTOR = 0.5;

/** Assombrit une couleur hex (multiplie les canaux RGB) pour le bas du dégradé d'en-tête. */
export function darken(hex: string, factor = HEADER_DARK_FACTOR): string {
  const h = (hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return hex;
  const n = parseInt(full, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(v * factor))),
  );
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Échappe le texte dynamique inséré dans le HTML (noms, intitulés…). */
export function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Noir ou blanc selon la luminance de la couleur de fond (contraste lisible du bouton). */
export function readableTextOn(hex: string): string {
  const h = (hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#0b0b0c';
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0b0b0c' : '#ffffff';
}

export interface InfoRow {
  label: string;
  value: string;
}

export interface LayoutInput {
  brand: Brand;
  /** Texte d'aperçu (preheader) masqué, affiché par certains clients à côté de l'objet. */
  preheader?: string;
  heading: string;
  /** Paragraphes d'intro déjà échappés/formatés (HTML). */
  introHtml: string;
  /** Cadre mettant en avant un code (email de validation). */
  codeBlock?: { code: string; caption?: string };
  infoRows?: InfoRow[];
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}

export function renderLayout(input: LayoutInput): string {
  const { brand, preheader, heading, introHtml, codeBlock, infoRows = [], ctaLabel, ctaUrl, footerNote } = input;
  const accent = brand.accentColor || PALOVA_BRAND.accentColor;
  const onAccent = readableTextOn(accent);
  const headerGradient = `linear-gradient(115deg, ${accent}, ${darken(accent)})`;

  // Wordmark (nom de la marque/club), avec le logo en tuile blanche à gauche s'il existe.
  const wordmark = `<span style="font-size:24px;font-weight:800;letter-spacing:0.5px;color:${onAccent};">${escapeHtml(brand.name)}</span>`;
  const header = brand.logoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:13px;vertical-align:middle;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ffffff;border-radius:12px;padding:5px;line-height:0;">
            <img src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" height="38" style="display:block;height:38px;width:auto;max-height:38px;border-radius:9px;border:0;outline:none;text-decoration:none;" />
          </td></tr></table>
        </td>
        <td style="vertical-align:middle;">${wordmark}</td>
      </tr></table>`
    : wordmark;

  const codeHtml = codeBlock
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:22px 0 14px;">
        <tr><td align="center" style="background:#eef3fb;border:1px solid #d4e1f4;border-radius:14px;padding:22px 16px;">
          <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#6d6a5d;margin-bottom:8px;">${escapeHtml(codeBlock.caption || 'Votre code')}</div>
          <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:#2c4668;font-family:'Courier New',Courier,monospace;">${escapeHtml(codeBlock.code)}</div>
        </td></tr>
      </table>`
    : '';

  const infoTable = infoRows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 4px;border-collapse:collapse;">
        ${infoRows
          .map(
            (row) => `<tr>
              <td style="padding:9px 0;font-size:14px;color:#6d6a5d;width:38%;vertical-align:top;border-bottom:1px solid #efece2;">${escapeHtml(row.label)}</td>
              <td style="padding:9px 0;font-size:14px;color:#181510;font-weight:600;border-bottom:1px solid #efece2;">${escapeHtml(row.value)}</td>
            </tr>`,
          )
          .join('')}
      </table>`
    : '';

  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 6px;">
          <tr><td bgcolor="${accent}" style="border-radius:11px;background:${accent};background-image:${headerGradient};">
            <a href="${ctaUrl}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:700;color:${onAccent};text-decoration:none;border-radius:11px;">${escapeHtml(ctaLabel)}</a>
          </td></tr>
        </table>`
      : '';

  const footer = footerNote
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#9b978a;">${escapeHtml(footerNote)}</p>`
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f1eee5;">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader || heading)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f1eee5;padding:28px 0;font-family:Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(24,21,16,0.10);">
        <tr><td bgcolor="${accent}" style="background:${accent};background-image:${headerGradient};padding:22px 30px;">${header}</td></tr>
        <tr><td style="padding:32px 30px 28px;">
          <h1 style="margin:0 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:22px;line-height:28px;color:#181510;">${escapeHtml(heading)}</h1>
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:#4a4639;">${introHtml}</div>
          ${codeHtml}
          ${infoTable}
          ${cta}
          ${footer}
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9b978a;">Envoyé par Palova · Réservez vos terrains de padel</p>
    </td></tr>
  </table>
</body>
</html>`;
}
