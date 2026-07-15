import { DateTime } from 'luxon';

// Tarification au CRÉNEAU, heures pleines / creuses.
// Le prix d'une ressource (Resource.price) est le prix d'une réservation, quelle
// que soit sa durée. Le tarif creux (Resource.offPeakPrice) s'applique ssi le
// créneau est ENTIÈREMENT en heures creuses (classifySlot).
// offPeakHours = plages d'heures CREUSES par jour de semaine (clé = weekday Luxon
// 1=lundi..7=dimanche), plusieurs plages possibles par jour, précision à la minute.
// Jour non configuré (ou rien de configuré) → tout en heures pleines.
export type OffPeakRange = { start: number; startMin?: number; end: number; endMin?: number };
export type OffPeakHours = Record<number, Array<OffPeakRange>>;

/** Convertit une plage en bornes en minutes depuis minuit. */
function rangeMinutes(r: OffPeakRange): { s: number; e: number } {
  return { s: r.start * 60 + (r.startMin ?? 0), e: r.end * 60 + (r.endMin ?? 0) };
}

// ------------------------------------------------------- Classe d'un créneau
// Un créneau peut chevaucher des plages creuses et pleines : on le découpe en
// segments par un walker qui avance en minutes RÉELLES et relit l'heure locale
// à chaque borne — minuit et le changement de jour sont gérés gratuitement.
// Miroir frontend : frontend/lib/caisse.ts (mêmes vecteurs de test).

/** Minutes creuses / pleines d'un créneau, en heure locale du club. */
export function splitOffPeakMinutes(
  off: OffPeakHours | null | undefined,
  start: Date,
  end: Date,
  tz: string,
): { offPeakMin: number; peakMin: number } {
  let offPeakMin = 0;
  let peakMin = 0;
  let cursorMs = start.getTime();
  const endMs = end.getTime();
  while (cursorMs < endMs) {
    const local = DateTime.fromMillis(cursorMs, { zone: tz });
    const t = local.hour * 60 + local.minute;
    const ranges = off?.[local.weekday] ?? [];
    const offPeak = ranges.some((r) => { const { s, e } = rangeMinutes(r); return t >= s && t < e; });
    // Prochaine borne de plage strictement après t, sinon minuit (reclassification au jour suivant).
    let next = 1440;
    for (const r of ranges) {
      const { s, e } = rangeMinutes(r);
      if (s > t && s < next) next = s;
      if (e > t && e < next) next = e;
    }
    const remainMin = Math.ceil((endMs - cursorMs) / 60_000);
    const segMin = Math.max(1, Math.min(next - t, remainMin));
    if (offPeak) offPeakMin += segMin; else peakMin += segMin;
    cursorMs += segMin * 60_000;
  }
  return { offPeakMin, peakMin };
}

/** Classe d'un créneau (tarif et quotas) : CREUX ssi 100 % des minutes en creuses. */
export function classifySlot(
  off: OffPeakHours | null | undefined,
  start: Date,
  end: Date,
  tz: string,
): 'PEAK' | 'OFF_PEAK' {
  const { peakMin } = splitOffPeakMinutes(off, start, end, tz);
  return peakMin === 0 ? 'OFF_PEAK' : 'PEAK';
}

/**
 * Prix d'un créneau en CENTIMES : tarif creux si le créneau est entièrement en
 * heures creuses (et qu'un tarif creux existe), sinon tarif plein. La durée du
 * créneau n'entre pas dans le prix.
 */
export function slotPriceCents(
  off: OffPeakHours | null | undefined,
  start: Date,
  end: Date,
  tz: string,
  priceCents: number,
  offPeakCents: number | null,
): number {
  if (offPeakCents == null) return priceCents;
  return classifySlot(off, start, end, tz) === 'OFF_PEAK' ? offPeakCents : priceCents;
}

// ------------------------------------------------------- Promotions datées
/** Promo active (déjà filtrée sur la date) prête pour le calcul de prix. */
export interface ActivePromo {
  name: string;
  kind: 'PERCENT' | 'FIXED';
  percentOff: number | null;
  fixedPriceCents: number | null;
  windowStart: number | null; // minutes depuis minuit, heure locale ; null = toute la journée
  windowEnd: number | null;
  resourceIds: string[];       // vide = tous les terrains
}

/**
 * Prix effectif d'un créneau en CENTIMES après application des promotions actives.
 * `baseCents` = prix normal (déjà calculé par slotPriceCents). `promos` doit déjà être
 * filtré sur la date du créneau (cf. loadActivePromotions). Le client gagne : on retient
 * le prix le plus bas, et une promo ne fait jamais monter le prix.
 */
export function effectiveSlotPriceCents(
  baseCents: number,
  promos: ActivePromo[],
  resourceId: string,
  start: Date,
  end: Date,
  tz: string,
): { priceCents: number; promoName?: string } {
  const s = DateTime.fromJSDate(start, { zone: tz });
  const e = DateTime.fromJSDate(end, { zone: tz });
  const startMin = s.hour * 60 + s.minute;
  const endMin = e.hour * 60 + e.minute;

  let bestCents = baseCents;
  let bestName: string | undefined;
  for (const p of promos) {
    if (p.resourceIds.length > 0 && !p.resourceIds.includes(resourceId)) continue;
    if (p.windowStart != null && p.windowEnd != null) {
      if (endMin <= startMin) continue;                       // créneau à cheval sur minuit : hors périmètre
      if (startMin < p.windowStart || endMin > p.windowEnd) continue; // pas entièrement dans la fenêtre
    }
    let candidate: number;
    if (p.kind === 'PERCENT' && p.percentOff != null) {
      candidate = Math.round((baseCents * (100 - p.percentOff)) / 100);
    } else if (p.kind === 'FIXED' && p.fixedPriceCents != null) {
      candidate = p.fixedPriceCents;
    } else {
      continue;
    }
    if (candidate < bestCents) { bestCents = candidate; bestName = p.name; }
  }
  return bestName ? { priceCents: bestCents, promoName: bestName } : { priceCents: bestCents };
}
