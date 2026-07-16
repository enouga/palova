import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '../db/prisma';
import { ICONS_DIR, UPLOADS_DIR } from '../utils/uploads';

// Icônes PWA d'un club : logo recadré « contain » en carré sur fond accentColor
// (jamais tronqué), cache disque uploads/icons (hash de l'URL du logo = invalidation
// naturelle au changement de logo), repli silencieux sur les PNG Palova embarqués.

// markRatio < 1 : zone de sécurité (maskable). transparent : fond transparent au lieu du
// carré accentColor — réservé aux icônes « any » 192/512 (bureau/Windows, affichées telles
// quelles). Les maskable (Android masque → comblerait le vide en noir) et apple-180 (iOS
// noircit la transparence) gardent un fond plein.
interface IconVariant { size: number; markRatio: number; transparent?: boolean; monochrome?: boolean }
export const ICON_VARIANTS: Record<string, IconVariant> = {
  '192': { size: 192, markRatio: 0.86, transparent: true },
  '512': { size: 512, markRatio: 0.86, transparent: true },
  'maskable-192': { size: 192, markRatio: 0.62 },
  'maskable-512': { size: 512, markRatio: 0.62 },
  'apple-180': { size: 180, markRatio: 0.74 },
  'badge-96': { size: 96, markRatio: 0.9, monochrome: true }, // silhouette blanche Android
};

const FALLBACK_DIR = path.join(process.cwd(), 'assets', 'pwa');
export function fallbackIconPath(variant: string): string {
  return path.join(FALLBACK_DIR, `icon-${variant}.png`);
}

// Version de rendu : à incrémenter quand le rendu des icônes change, pour invalider le
// cache disque (le hash dépend sinon du seul logoUrl, inchangé ⇒ anciennes icônes servies).
const RENDER_VERSION = 'v3-badge';
export function iconCacheFile(clubId: string, variant: string, logoUrl: string): string {
  const hash = crypto.createHash('md5').update(`${RENDER_VERSION}:${logoUrl}`).digest('hex').slice(0, 12);
  return path.join(ICONS_DIR, `${clubId}-${variant}-${hash}.png`);
}

const FETCH_TIMEOUT_MS = 5000;
const MAX_LOGO_BYTES = 5 * 1024 * 1024; // garde poids/SSRF : 5 Mo max

export async function fetchLogo(url: string): Promise<Buffer> {
  // Logo uploadé localement (/uploads/...) : lecture disque directe — `fetch` exigerait
  // une URL absolue que le backend ne connaît pas. Garde anti-traversée de répertoire.
  if (url.startsWith('/uploads/')) {
    const filePath = path.resolve(UPLOADS_DIR, url.replace(/^\/uploads\//, ''));
    if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) throw new Error('LOGO_PATH_INVALID');
    const buf = await fs.promises.readFile(filePath);
    if (buf.byteLength > MAX_LOGO_BYTES) throw new Error('LOGO_TOO_LARGE');
    return buf;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`LOGO_HTTP_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_LOGO_BYTES) throw new Error('LOGO_TOO_LARGE');
  return buf;
}

async function renderIcon(logo: Buffer, accentColor: string, v: IconVariant): Promise<Buffer> {
  const inner = Math.round(v.size * v.markRatio);
  const resized = await sharp(logo)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  const background = v.transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : accentColor;
  return sharp({ create: { width: v.size, height: v.size, channels: 4, background } })
    .composite([{ input: resized, gravity: 'centre' }])
    .png().toBuffer();
}

// Badge de notification Android : silhouette BLANCHE dérivée du canal alpha du logo.
// null = logo sans transparence réelle (JPEG/PNG à fond plein) → l'appelant sert le
// badge Palova de repli (jamais un carré blanc plein).
async function renderBadge(logo: Buffer, size: number, markRatio: number): Promise<Buffer | null> {
  // Opacité vérifiée sur le logo D'ORIGINE, avant le letterboxing `contain` : celui-ci ajoute
  // un remplissage transparent qui, pour une image opaque NON carrée, ferait croire à tort à
  // de la transparence (min d'alpha = 0) et produirait un rectangle blanc plein au lieu du repli.
  // Le canal alpha est matérialisé (toBuffer) avant stats() — sinon stats() porte sur le RGB.
  const srcAlpha = await sharp(logo).ensureAlpha().extractChannel(3).toBuffer();
  if (((await sharp(srcAlpha).stats()).channels[0]?.min ?? 255) >= 250) return null; // logo opaque → repli
  const inner = Math.round(size * markRatio);
  const resized = await sharp(logo)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha().png().toBuffer();
  const alpha = await sharp(resized).extractChannel(3).toBuffer(); // niveaux de gris = alpha
  const whiteMark = await sharp({ create: { width: inner, height: inner, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: whiteMark, gravity: 'centre' }]).png().toBuffer();
}

export class IconService {
  /** Chemin absolu du PNG à servir pour ce club+variant, ou null (404). */
  async getClubIconPath(slug: string, variant: string): Promise<string | null> {
    if (!ICON_VARIANTS[variant]) return null;
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, logoUrl: true, accentColor: true } });
    if (!club) return null;
    if (!club.logoUrl) return fallbackIconPath(variant);
    const cached = iconCacheFile(club.id, variant, club.logoUrl);
    if (fs.existsSync(cached)) return cached;
    try {
      const logo = await fetchLogo(club.logoUrl);
      const v = ICON_VARIANTS[variant];
      const png = v.monochrome
        ? await renderBadge(logo, v.size, v.markRatio)
        : await renderIcon(logo, club.accentColor, v);
      if (!png) return fallbackIconPath(variant); // badge sans alpha → repli Palova
      fs.writeFileSync(cached, png);
      return cached;
    } catch {
      return fallbackIconPath(variant); // logo injoignable/illisible → icône Palova
    }
  }
}

export const iconService = new IconService();
