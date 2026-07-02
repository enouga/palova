import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { OGCARDS_DIR, UPLOADS_DIR } from '../utils/uploads';
import { colorForSeed } from '../utils/playerColors';
import { readableTextOn } from '../email/templates/layout';
import { clubAppUrl } from '../email/links';
import { fetchLogo } from './icon.service';
import { OpenMatchService } from './openMatch.service';

// Carte Open Graph d'une partie ouverte (1200×630) : l'aperçu WhatsApp montre l'état
// RÉEL du match — équipes G/D, avatars, places restantes, niveau, date — aux couleurs
// du club. Cache disque par état (uploads/ogcards/<matchId>-<cardVersion>.png), purge
// des états précédents, repli PNG embarqué sur toute erreur (jamais de 500 pour un
// crawler). Patron : icon.service.ts.

export const CARD_W = 1200;
export const CARD_H = 630;
const FONT = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif";
const AVATAR = 112; // diamètre px des avatars sur la carte

export function fallbackCardPath(): string {
  return path.join(process.cwd(), 'assets', 'og-card-fallback.png');
}

type MatchDTO = Awaited<ReturnType<OpenMatchService['getOpenMatch']>>;
type CardClub = { slug: string; name: string; timezone: string; accentColor: string; logoUrl: string | null };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fmtLevel = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

// Assombrit un hex #rrggbb (facteur 0..1) — bas du dégradé de fond. Hex invalide → nuit.
function darken(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return '#0e1b2e';
  const n = parseInt(m[1], 16);
  const ch = (x: number) => Math.round(x * (1 - f)).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

function levelRangeLabel(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return `Niveau ${fmtLevel(min)} à ${fmtLevel(max)}`;
  if (min != null) return `Niveau ${fmtLevel(min)} et +`;
  if (max != null) return `Niveau ${fmtLevel(max)} et -`;
  return null;
}

/** Avatar local (/uploads/…) recadré rond, ou null (photo distante/illisible → pastille). */
async function circleAvatar(avatarUrl: string, size: number): Promise<Buffer | null> {
  try {
    if (!avatarUrl.startsWith('/uploads/')) return null;
    const filePath = path.resolve(UPLOADS_DIR, avatarUrl.replace(/^\/uploads\//, ''));
    if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) return null; // anti-traversée
    const img = await sharp(await fs.promises.readFile(filePath))
      .resize(size, size, { fit: 'cover' }).png().toBuffer();
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
    return await sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  } catch { return null; }
}

/** Rendu complet de la carte (SVG de base + photos composées par-dessus les pastilles). */
async function renderCard(dto: MatchDTO, club: CardClub): Promise<Buffer> {
  const zone = club.timezone || 'Europe/Paris';
  const start = DateTime.fromISO(dto.startTime, { zone }).setLocale('fr');
  const end = DateTime.fromISO(dto.endTime, { zone });
  const whenLabel = `${start.toFormat('ccc d LLL')} · ${start.toFormat("HH'h'mm")} – ${end.toFormat("HH'h'mm")} · ${clamp(dto.resourceName, 20)}`;

  const half = Math.max(1, Math.floor(dto.maxPlayers / 2));
  const byPos = new Map(dto.players.map((p) => [`${p.team}:${p.slot}`, p]));
  const rowY = (s: number) => (half === 1 ? 320 : 228 + s * 186); // centre du cercle avatar (écart ≥ hauteur pastille+libellés)
  const colX = (team: 1 | 2) => (team === 1 ? 330 : 870);

  const parts: string[] = [];
  const overlays: Array<{ url: string; x: number; y: number }> = [];

  parts.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${esc(club.accentColor || '#1d3557')}"/>
    <stop offset="1" stop-color="${darken(club.accentColor || '#1d3557', 0.65)}"/>
  </linearGradient></defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>`);

  // En-tête : tuile logo + nom du club + date/heure/terrain.
  parts.push(`<rect x="48" y="44" width="84" height="84" rx="18" fill="#ffffff"/>`);
  parts.push(`<text x="152" y="88" font-family="${FONT}" font-size="34" font-weight="700" fill="#ffffff">${esc(clamp(club.name, 28))}</text>`);
  parts.push(`<text x="152" y="124" font-family="${FONT}" font-size="24" fill="rgba(255,255,255,0.82)">${esc(whenLabel)}</text>`);

  // VS central.
  parts.push(`<circle cx="600" cy="320" r="46" fill="rgba(255,255,255,0.14)"/>
  <text x="600" y="331" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="#ffffff">VS</text>`);

  // Équipes : pastille initiales (ou cercle pointillé « Libre ») + prénom + niveau.
  for (const team of [1, 2] as const) {
    parts.push(`<text x="${colX(team)}" y="158" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="600" fill="rgba(255,255,255,0.65)">Éq. ${team}</text>`);
    for (let s = 0; s < half; s++) {
      const cx = colX(team); const cy = rowY(s);
      const p = byPos.get(`${team}:${s}`);
      if (!p) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${AVATAR / 2}" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="3" stroke-dasharray="8 8"/>
        <text x="${cx}" y="${cy + AVATAR / 2 + 36}" text-anchor="middle" font-family="${FONT}" font-size="26" fill="rgba(255,255,255,0.6)">Libre</text>`);
        continue;
      }
      const color = colorForSeed(p.userId);
      const initials = `${(p.firstName[0] || '').toUpperCase()}${(p.lastName[0] || '').toUpperCase()}`;
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${AVATAR / 2}" fill="${color}"/>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="700" fill="${readableTextOn(color)}">${esc(initials)}</text>
      <text x="${cx}" y="${cy + AVATAR / 2 + 36}" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="600" fill="#ffffff">${esc(clamp(p.firstName, 14))}</text>`);
      if (p.level) parts.push(`<text x="${cx}" y="${cy + AVATAR / 2 + 64}" text-anchor="middle" font-family="${FONT}" font-size="20" fill="rgba(255,255,255,0.7)">Niv. ${fmtLevel(p.level.level)}</text>`);
      if (p.avatarUrl) overlays.push({ url: p.avatarUrl, x: cx - AVATAR / 2, y: cy - AVATAR / 2 });
    }
  }

  // Bandeau bas : places · niveau · domaine du club.
  const placesLabel = dto.full ? 'Complet' : `${dto.spotsLeft} place${dto.spotsLeft > 1 ? 's' : ''} restante${dto.spotsLeft > 1 ? 's' : ''}`;
  const domain = clubAppUrl(club.slug).replace(/^https?:\/\//, '');
  const footer = [placesLabel, levelRangeLabel(dto.targetLevelMin ?? null, dto.targetLevelMax ?? null), domain].filter(Boolean).join('  ·  ');
  parts.push(`<rect x="0" y="${CARD_H - 84}" width="${CARD_W}" height="84" fill="rgba(0,0,0,0.28)"/>
  <text x="600" y="${CARD_H - 32}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="#ffffff">${esc(footer)}</text>`);

  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">${parts.join('\n')}</svg>`;

  const composites: sharp.OverlayOptions[] = [];
  if (club.logoUrl) {
    try {
      const logo = await fetchLogo(club.logoUrl);
      composites.push({
        input: await sharp(logo).resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
        left: 58, top: 54,
      });
    } catch { /* logo injoignable → tuile blanche vide, pas bloquant */ }
  }
  for (const o of overlays) {
    const buf = await circleAvatar(o.url, AVATAR);
    if (buf) composites.push({ input: buf, left: o.x, top: o.y });
  }

  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  return composites.length ? sharp(base).composite(composites).png().toBuffer() : base;
}

export class MatchCardService {
  private openMatches = new OpenMatchService();

  /** Chemin absolu du PNG à servir. Ne lève JAMAIS : toute erreur → PNG de repli. */
  async getMatchCardPath(slug: string, matchId: string): Promise<string> {
    try {
      // L'id entre dans un nom de fichier : garde stricte avant toute requête.
      if (!/^[A-Za-z0-9_-]+$/.test(matchId)) return fallbackCardPath();
      const club = await prisma.club.findUnique({
        where: { slug },
        select: { slug: true, name: true, status: true, timezone: true, accentColor: true, logoUrl: true },
      });
      if (!club || club.status !== 'ACTIVE') return fallbackCardPath();
      const dto = await this.openMatches.getOpenMatch(slug, matchId, null);
      const cached = path.join(OGCARDS_DIR, `${matchId}-${dto.cardVersion}.png`);
      if (fs.existsSync(cached)) return cached;
      const png = await renderCard(dto, club);
      fs.mkdirSync(OGCARDS_DIR, { recursive: true });
      fs.writeFileSync(cached, png);
      // Purge best-effort des états précédents du même match.
      for (const f of fs.readdirSync(OGCARDS_DIR)) {
        if (f.startsWith(`${matchId}-`) && f !== path.basename(cached)) {
          try { fs.unlinkSync(path.join(OGCARDS_DIR, f)); } catch { /* déjà parti */ }
        }
      }
      return cached;
    } catch {
      return fallbackCardPath();
    }
  }
}

export const matchCardService = new MatchCardService();
