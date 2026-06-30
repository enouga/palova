import sanitizeHtml from 'sanitize-html';
import { Brand, InfoRow, PALOVA_BRAND, escapeHtml, renderLayout } from './templates/layout';
import { absoluteAsset } from './links';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Substitution texte : valeur brute, placeholder inconnu → retiré. */
export function substituteText(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(PLACEHOLDER, (_m, k: string) => (k in vars ? vars[k] : ''));
}

/** Substitution dans du HTML : valeur HTML-échappée, placeholder inconnu → retiré. */
export function substituteHtml(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(PLACEHOLDER, (_m, k: string) => (k in vars ? escapeHtml(vars[k]) : ''));
}

/** Clés `{{…}}` uniques présentes dans un gabarit. */
export function collectPlaceholders(tpl: string): string[] {
  const set = new Set<string>();
  for (const m of tpl.matchAll(PLACEHOLDER)) set.add(m[1]);
  return [...set];
}

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'span', 'h2', 'h3', 'blockquote'],
  allowedAttributes: { a: ['href'], p: ['style'], span: ['style'], h2: ['style'], h3: ['style'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(/],
      'font-weight': [/^(normal|bold|[1-9]00)$/],
      'font-style': [/^(normal|italic)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'text-decoration': [/^(none|underline|line-through)$/],
    },
  },
  disallowedTagsMode: 'discard',
};

/** Assainit le corps HTML **personnalisé** d'un club (allowlist serrée). */
export function sanitizeBodyHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTS);
}

/** Brand email d'un club (logo en URL absolue, repli Palova). */
export function brandFromClub(club: { name: string; logoUrl: string | null; accentColor: string }): Brand {
  return {
    name: club.name || PALOVA_BRAND.name,
    logoUrl: absoluteAsset(club.logoUrl),
    accentColor: club.accentColor || PALOVA_BRAND.accentColor,
  };
}
