import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '../db/prisma';
import { ICONS_DIR, UPLOADS_DIR } from '../utils/uploads';
import { readableTextOn } from '../email/templates/layout';

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

// Carte de marque générique d'un club (logo + nom sur fond accentColor, 1200×630) : image
// Open Graph réutilisée par les pages club qui n'ont pas de carte dédiée (à la différence
// des parties ouvertes, cf. matchCard.service.ts, qui garde sa carte dynamique par état).
const OG_W = 1200;
const OG_H = 630;
const OG_FONT = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif";
const OG_RENDER_VERSION = 'v1';

function fallbackOgCardPath(): string {
  return path.join(process.cwd(), 'assets', 'og-card-fallback.png');
}

function ogCacheFile(clubId: string, logoUrl: string): string {
  // Hash sur logoUrl seul (comme iconCacheFile) : un changement d'accentColor/nom sans
  // changement de logo ne rebustera pas le cache — même tradeoff déjà accepté pour les
  // icônes PWA, pas retravaillé ici.
  const hash = crypto.createHash('md5').update(`${OG_RENDER_VERSION}:${logoUrl}`).digest('hex').slice(0, 12);
  return path.join(ICONS_DIR, `${clubId}-og-${hash}.png`);
}

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clampText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Carte 1200×630 : fond accentColor, logo centré (contain), nom du club en dessous. */
async function renderOgCard(logo: Buffer, accentColor: string, clubName: string): Promise<Buffer> {
  const bg = accentColor || '#1d3557';
  const ink = readableTextOn(bg);
  const svg = `<svg width="${OG_W}" height="${OG_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${OG_W}" height="${OG_H}" fill="${escXml(bg)}"/>
    <text x="${OG_W / 2}" y="470" text-anchor="middle" font-family="${OG_FONT}" font-size="52" font-weight="700" fill="${escXml(ink)}">${escXml(clampText(clubName, 32))}</text>
  </svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const mark = await sharp(logo)
    .resize(260, 260, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  return sharp(base).composite([{ input: mark, left: Math.round(OG_W / 2 - 130), top: 90 }]).png().toBuffer();
}

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
const MAX_LOGO_REDIRECTS = 5;

// Bloque les cibles internes (metadata cloud, réseau Docker, LAN…) : logoUrl est saisi par
// un admin de club et fetché serveur-side depuis 2 routes PUBLIQUES (icône PWA, carte de
// partie) — sans ce garde, n'importe qui peut déclencher une requête serveur vers une IP
// interne (SSRF) en pointant le logo dessus. Revalidé à CHAQUE redirection suivie.
function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local / metadata cloud
    if (a === 0) return true;
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice(7)); // IPv4-mapped
  return false;
}

async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('LOGO_URL_INVALID');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('LOGO_URL_INVALID');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost') throw new Error('LOGO_URL_INVALID');
  const literalIp = net.isIP(hostname) ? hostname : null;
  const addresses = literalIp ? [literalIp] : (await dns.lookup(hostname, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) throw new Error('LOGO_URL_INVALID');
}

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
  let target = url;
  for (let hop = 0; ; hop++) {
    await assertPublicHttpUrl(target);
    const res = await fetch(target, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop >= MAX_LOGO_REDIRECTS) throw new Error('LOGO_TOO_MANY_REDIRECTS');
      target = new URL(res.headers.get('location')!, target).toString();
      continue;
    }
    if (!res.ok) throw new Error(`LOGO_HTTP_${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_LOGO_BYTES) throw new Error('LOGO_TOO_LARGE');
    return buf;
  }
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

  /** Chemin absolu de la carte OG de marque du club, ou null (club introuvable → 404). */
  async getClubOgCardPath(slug: string): Promise<string | null> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, name: true, logoUrl: true, accentColor: true } });
    if (!club) return null;
    if (!club.logoUrl) return fallbackOgCardPath();
    const cached = ogCacheFile(club.id, club.logoUrl);
    if (fs.existsSync(cached)) return cached;
    try {
      const logo = await fetchLogo(club.logoUrl);
      const png = await renderOgCard(logo, club.accentColor, club.name);
      fs.writeFileSync(cached, png);
      return cached;
    } catch {
      return fallbackOgCardPath();
    }
  }
}

export const iconService = new IconService();
