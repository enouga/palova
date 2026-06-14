import { DateTime } from 'luxon';

// Domaine racine CANONIQUE pour les emails (1re entrée de FRONTEND_ROOT_DOMAINS,
// ex. palova.fr ; repli singulier puis localhost en dev). Multi-domaines : les liens
// d'email pointent toujours vers la canonique, même pour une action faite sur palova.app.
// Sert à construire des URLs absolues atteignables depuis un client mail (liens + logo).
const ROOT = ((process.env.FRONTEND_ROOT_DOMAINS || '')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean)[0] || process.env.FRONTEND_ROOT_DOMAIN || 'localhost').toLowerCase();
const IS_LOCAL = ROOT === 'localhost' || ROOT.startsWith('localhost');

/** URL publique de l'app d'un club (son sous-domaine), avec un chemin optionnel. */
export function clubAppUrl(slug: string, path = ''): string {
  const base = IS_LOCAL ? `http://${slug}.localhost:3000` : `https://${slug}.${ROOT}`;
  return `${base}${path}`;
}

/** Transforme un chemin `/uploads/...` en URL absolue (laisse une URL http(s) telle quelle). */
export function absoluteAsset(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const apiBase = IS_LOCAL ? 'http://localhost:3001' : `https://api.${ROOT}`;
  return `${apiBase}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** URL absolue d'un asset servi par le frontend plateforme (ex. le logo Palova des emails). */
export function platformAsset(path: string): string {
  const base = IS_LOCAL ? 'http://localhost:3000' : `https://${ROOT}`;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Date lisible en français dans le fuseau du club. Ex. « samedi 12 juillet 2026 à 09h00 ». */
export function formatDateFr(date: Date, timezone?: string | null): string {
  return DateTime.fromJSDate(date, { zone: timezone || 'Europe/Paris' })
    .setLocale('fr')
    .toFormat("cccc d LLLL yyyy 'à' HH'h'mm");
}

/**
 * Plage de dates lisible : début seul si pas de fin. Si la fin existe et tombe le même
 * jour → « … à 09h00 → 12h00 » ; un autre jour → « … → <date+heure de fin> ».
 * Une fin incohérente (≤ début) est ignorée.
 */
export function formatDateRangeFr(
  start: Date,
  end: Date | null | undefined,
  timezone?: string | null,
): string {
  const startLabel = formatDateFr(start, timezone);
  if (!end) return startLabel;
  const zone = timezone || 'Europe/Paris';
  const s = DateTime.fromJSDate(start, { zone });
  const e = DateTime.fromJSDate(end, { zone });
  if (e <= s) return startLabel;
  if (s.hasSame(e, 'day')) {
    return `${startLabel} → ${e.setLocale('fr').toFormat("HH'h'mm")}`;
  }
  return `${startLabel} → ${formatDateFr(end, timezone)}`;
}
