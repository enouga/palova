// Helpers purs du sélecteur d'heures « clavier + raccourcis intelligents » et du
// drag & drop du planning admin. Tout est exprimé en minutes depuis minuit (fuseau
// du club déjà résolu par l'appelant) — aucune dépendance à Intl/Date ici.

/** Un créneau déjà occupé sur un terrain, réduit aux bornes utiles à la détection de conflit. */
export interface BusySlot {
  id: string;
  resourceId: string;
  startMin: number;
  endMin: number;
}

export interface SmartChip {
  key: string;
  label: string;
  startMin: number;
}

/**
 * Parse une saisie clavier libre en "HH:MM", ou null si invalide.
 * "17:30" / "1730" (HHMM) / "930" (H MM) / "9" ou "17" (heure ronde).
 */
export function parseTimeInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let h: number, m: number;
  if (trimmed.includes(':')) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (!match) return null;
    h = Number(match[1]);
    m = Number(match[2]);
  } else {
    if (!/^\d{1,4}$/.test(trimmed)) return null;
    if (trimmed.length <= 2) { h = Number(trimmed); m = 0; }
    else if (trimmed.length === 3) { h = Number(trimmed.slice(0, 1)); m = Number(trimmed.slice(1)); }
    else { h = Number(trimmed.slice(0, 2)); m = Number(trimmed.slice(2)); }
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Arrondit des minutes au pas donné (le plus proche). */
export function snapMinutes(min: number, step: number): number {
  return Math.round(min / step) * step;
}

/** "HH:MM" → minutes depuis minuit. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes depuis minuit → "HH:MM" (replié modulo 24 h). */
export function fromMinutes(min: number): string {
  const norm = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
}

/** Le créneau [startMin, startMin+durationMin) chevauche-t-il un busy slot du même terrain (hors excludeId) ? */
export function findOverlap(
  busy: BusySlot[],
  resourceId: string,
  startMin: number,
  durationMin: number,
  excludeId?: string,
): BusySlot | null {
  const endMin = startMin + durationMin;
  for (const b of busy) {
    if (b.resourceId !== resourceId) continue;
    if (excludeId && b.id === excludeId) continue;
    if (startMin < b.endMin && endMin > b.startMin) return b;
  }
  return null;
}

/** Premier départ libre ≥ fromMin (aligné sur `step`) pour une durée donnée, borné par closeMin. null si aucun. */
export function nextFreeStart(
  busy: BusySlot[],
  resourceId: string,
  fromMin: number,
  durationMin: number,
  closeMin: number,
  step = 15,
): number | null {
  for (let start = snapMinutes(fromMin, step); start + durationMin <= closeMin; start += step) {
    if (!findOverlap(busy, resourceId, start, durationMin)) return start;
  }
  return null;
}

const HINGE_HOURS = [8, 12, 18, 20];

/** Heures charnières (8h/12h/18h/20h) présentes dans la plage d'ouverture du terrain. */
export function hingeHourChips(openMin: number, closeMin: number): number[] {
  return HINGE_HOURS.map((h) => h * 60).filter((m) => m >= openMin && m < closeMin);
}

/**
 * Chips de début intelligentes : « Maintenant » (si nowMin fourni, arrondi au ¼ h),
 * « Prochain libre » (premier créneau ≥ fromMin qui tient sans conflit — fromMin est le
 * début actuellement choisi par l'utilisateur, PAS l'heure d'ouverture), puis les heures
 * charnières du terrain — dédupliquées par minute de départ.
 */
export function smartChips(params: {
  nowMin: number | null;
  fromMin: number;
  openMin: number;
  closeMin: number;
  durationMin: number;
  busy: BusySlot[];
  resourceId: string;
}): SmartChip[] {
  const { nowMin, fromMin, openMin, closeMin, durationMin, busy, resourceId } = params;
  const chips: SmartChip[] = [];
  const seen = new Set<number>();
  const push = (key: string, label: string, startMin: number) => {
    if (startMin < openMin || startMin + durationMin > closeMin) return;
    if (seen.has(startMin)) return;
    seen.add(startMin);
    chips.push({ key, label, startMin });
  };

  if (nowMin != null) {
    const nowStart = Math.max(snapMinutes(nowMin, 15), openMin);
    push('now', `Maintenant · ${fromMinutes(nowStart)}`, nowStart);
  }

  const free = nextFreeStart(busy, resourceId, Math.max(fromMin, openMin), durationMin, closeMin);
  if (free != null) push('free', `Prochain libre · ${fromMinutes(free)}`, free);

  for (const h of hingeHourChips(openMin, closeMin)) push(`hinge-${h}`, fromMinutes(h).replace(':', 'h'), h);

  return chips;
}

/** Position Y (px, relative au haut de la grille) → minutes locales, alignées sur `step` (défaut 15). */
export function pxToMinutes(y: number, hourHeightPx: number, minOpenMin: number, step = 15): number {
  const raw = minOpenMin + (y / hourHeightPx) * 60;
  return snapMinutes(raw, step);
}

/** Minutes locales (fuseau du club) depuis minuit pour un instant ISO. */
export function localMinutesOfDay(iso: string, tz: string): number {
  const f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
  const [h, m] = f.split(':').map(Number);
  return h * 60 + m;
}

/** Jour de semaine convention Luxon (1=lundi..7=dimanche) d'une date "YYYY-MM-DD". */
export function weekdayOf(dateISO: string): number {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const js = d.getUTCDay(); // 0=dimanche..6=samedi
  return js === 0 ? 7 : js;
}
