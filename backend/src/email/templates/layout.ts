// Layout HTML d'email, sans dépendance : tables + CSS inline (la seule mise en forme
// qui survit à la plupart des clients mail). Gabarit « Éditorial épuré » : liseré fin à la
// couleur du club, en-tête centré (logo + nom en petites capitales), titre en serif,
// CTA en pill sombre, pied de page avec coordonnées du club + lien de gestion des notifs.

export interface Brand {
  name: string;
  logoUrl: string | null;
  accentColor: string;
  /** Coordonnées du club pour le pied de page (facultatives — lignes omises si absentes). */
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  /** URL « Gérer mes notifications » (profil membre sur le sous-domaine du club). */
  manageUrl?: string | null;
  /** Lien de désinscription en un clic (emails de diffusion club.broadcast), signé par destinataire. */
  unsubscribeUrl?: string | null;
}

// Identité Palova = bleu primaire du site (ACCENTS.blue). Le logo est injecté par l'appelant
// (URL absolue via links.platformAsset) car il dépend du domaine canonique.
export const PALOVA_BRAND: Brand = { name: 'Palova', logoUrl: null, accentColor: '#5e93da' };

// Bleu nuit d'ancrage — gardé pour l'API publique testée, plus utilisé par renderLayout
// lui-même (le gabarit « Éditorial épuré » n'a plus de dégradé d'en-tête).
const HEADER_DARK_FACTOR = 0.5;

/** Assombrit une couleur hex (multiplie les canaux RGB). */
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

  // Palette « Éditorial épuré » : encre froide, hairlines, fond neutre.
  const INK = '#181d26';
  const BODY = '#4a5261';
  const MUTE = '#8a93a3';
  const FAINT = '#9aa2b0';
  const HAIR = '#e8eaee';
  const SERIF = "Georgia,'Times New Roman',serif";
  const SANS = 'Helvetica,Arial,sans-serif';

  // En-tête centré : logo (image) ou tuile encre avec l'initiale du club.
  const initial = escapeHtml(((brand.name || '').trim().charAt(0) || 'P').toUpperCase());
  const logo = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" height="36" style="display:inline-block;height:36px;width:auto;max-height:36px;border-radius:9px;border:0;outline:none;text-decoration:none;" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td width="36" height="36" style="width:36px;height:36px;background:${INK};border-radius:9px;text-align:center;vertical-align:middle;font-family:${SANS};font-size:17px;font-weight:800;color:#ffffff;">${initial}</td></tr></table>`;

  const codeHtml = codeBlock
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:22px 0 14px;">
        <tr><td align="center" style="background:#f4f6f9;border:1px solid ${HAIR};border-radius:14px;padding:22px 16px;">
          <div style="font-family:${SANS};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTE};margin-bottom:8px;">${escapeHtml(codeBlock.caption || 'Votre code')}</div>
          <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:${INK};font-family:'Courier New',Courier,monospace;">${escapeHtml(codeBlock.code)}</div>
        </td></tr>
      </table>`
    : '';

  const infoTable = infoRows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0 4px;border-collapse:collapse;border-top:1px solid ${HAIR};">
        ${infoRows
          .map(
            (row) => `<tr>
              <td style="padding:9px 0;font-family:${SANS};font-size:13.5px;color:${MUTE};width:38%;vertical-align:top;border-bottom:1px solid ${HAIR};">${escapeHtml(row.label)}</td>
              <td align="right" style="padding:9px 0;font-family:${SANS};font-size:13.5px;color:${INK};font-weight:600;text-align:right;border-bottom:1px solid ${HAIR};">${escapeHtml(row.value)}</td>
            </tr>`,
          )
          .join('')}
      </table>`
    : '';

  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:26px auto 6px;">
          <tr><td bgcolor="${INK}" style="border-radius:999px;background:${INK};">
            <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 28px;font-family:${SANS};font-size:14.5px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(ctaLabel)}</a>
          </td></tr>
        </table>`
      : '';

  const note = footerNote
    ? `<p style="margin:18px 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${FAINT};text-align:center;">${escapeHtml(footerNote)}</p>`
    : '';

  const coordParts = [brand.address, brand.phone, brand.email].filter(Boolean) as string[];
  const coordLine = `<strong style="color:#5d6675;">${escapeHtml(brand.name)}</strong>${coordParts.length ? ' · ' + coordParts.map(escapeHtml).join(' · ') : ''}`;
  const manageLink = brand.manageUrl
    ? `<a href="${escapeHtml(brand.manageUrl)}" style="color:${FAINT};text-decoration:underline;">Gérer mes notifications</a> · `
    : '';
  const unsubLink = brand.unsubscribeUrl
    ? `<a href="${escapeHtml(brand.unsubscribeUrl)}" style="color:${FAINT};text-decoration:underline;">Se désabonner</a> · `
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader || heading)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f5f7;padding:28px 0;font-family:${SANS};">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(24,29,38,0.08);">
        <tr><td bgcolor="${accent}" style="height:5px;line-height:5px;font-size:0;background:${accent};">&nbsp;</td></tr>
        <tr><td align="center" style="padding:28px 30px 0;">
          ${logo}
          <div style="margin-top:12px;font-family:${SANS};font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${INK};">${escapeHtml(brand.name)}</div>
        </td></tr>
        <tr><td style="padding:16px 34px 30px;">
          <h1 style="margin:12px 0 16px;font-family:${SERIF};font-size:26px;line-height:34px;font-weight:400;color:${INK};text-align:center;">${escapeHtml(heading)}</h1>
          <div style="font-family:${SANS};font-size:15px;line-height:24px;color:${BODY};">${introHtml}</div>
          ${codeHtml}
          ${infoTable}
          ${cta}
          ${note}
        </td></tr>
        <tr><td align="center" style="border-top:1px solid ${HAIR};padding:18px 30px 22px;font-family:${SANS};font-size:11.5px;line-height:19px;color:${FAINT};">
          ${coordLine}<br/>
          ${manageLink}${unsubLink}Envoyé avec Palova
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
