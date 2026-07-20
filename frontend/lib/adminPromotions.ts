import type { Promotion } from './api';

export type PromoStatus = 'upcoming' | 'running' | 'past';

/** Statut d'une promo vs un instant (ms). Bornes de dates incluses (jour entier). */
export function promoStatus(p: Promotion, nowMs: number): PromoStatus {
  const startMs = Date.parse(`${p.startDate}T00:00:00Z`);
  const endMs = Date.parse(`${p.endDate}T23:59:59Z`);
  if (nowMs < startMs) return 'upcoming';
  if (nowMs > endMs) return 'past';
  return 'running';
}

/** Groupe par statut ; running d'abord (début croissant), upcoming (début croissant), past (fin décroissante). */
export function groupPromotions(promos: Promotion[], nowMs: number) {
  const running: Promotion[] = [], upcoming: Promotion[] = [], past: Promotion[] = [];
  for (const p of promos) {
    const s = promoStatus(p, nowMs);
    (s === 'running' ? running : s === 'upcoming' ? upcoming : past).push(p);
  }
  running.sort((a, b) => a.startDate.localeCompare(b.startDate));
  upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
  past.sort((a, b) => b.endDate.localeCompare(a.endDate));
  return { running, upcoming, past };
}

/** Libellé de remise : "−20 %" ou "15 €". */
export function discountLabel(p: Promotion): string {
  if (p.kind === 'PERCENT' && p.percentOff != null) return `−${p.percentOff} %`;
  if (p.kind === 'FIXED' && p.fixedPrice != null) return `${Number(p.fixedPrice)} €`;
  return '';
}

/** Libellé fenêtre horaire "18h–20h", ou null si toute la journée. */
export function windowLabel(p: Promotion): string | null {
  if (p.windowStart == null || p.windowEnd == null) return null;
  const h = (min: number) => { const hh = Math.floor(min / 60), mm = min % 60; return mm === 0 ? `${hh}h` : `${hh}h${String(mm).padStart(2, '0')}`; };
  return `${h(p.windowStart)}–${h(p.windowEnd)}`;
}

/** Libellé cible : "Tous les terrains" ou "N terrain(s)". */
export function targetLabel(p: Promotion, _totalCourts: number): string {
  const n = p.resourceIds.length;
  if (n === 0) return 'Tous les terrains';
  return `${n} terrain${n > 1 ? 's' : ''}`;
}
