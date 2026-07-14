// Helpers purs de la fiche cockpit membre (admin). Paramétrés par nowMs — jamais de Date.now() ici.

const DAY_MS = 86_400_000;

/** Résas confirmées commencées dans les 30 derniers jours (bornes incluses, futur exclu). */
export function resasLast30(
  reservations: Array<{ status: string; startTime: string }>,
  nowMs: number,
): number {
  const from = nowMs - 30 * DAY_MS;
  let n = 0;
  for (const r of reservations) {
    if (r.status !== 'CONFIRMED') continue;
    const t = new Date(r.startTime).getTime();
    if (t >= from && t <= nowMs) n++;
  }
  return n;
}

/** Somme (centimes) du CA des 12 derniers mois calendaires (clés "yyyy-MM"). */
export function spent12moCents(
  revenueByMonth: Array<{ month: string; net: string }>,
  nowMs: number,
): number {
  const now = new Date(nowMs);
  const cur = now.getUTCFullYear() * 12 + now.getUTCMonth();
  let sum = 0;
  for (const { month, net } of revenueByMonth) {
    const idx = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1);
    if (idx > cur || idx <= cur - 12) continue;
    sum += Math.round(Number(net) * 100);
  }
  return sum;
}

/** Fiabilité affichée = 100 − taux d'annulation (0..1), arrondie. */
export function reliabilityPct(cancellationRate: number): number {
  return Math.round((1 - cancellationRate) * 100);
}

/** Total (centimes) des restes dus ligne par ligne. */
export function unpaidTotalCents(unpaid: Array<{ dueAmount: string }>): number {
  return unpaid.reduce((s, u) => s + Math.round(Number(u.dueAmount) * 100), 0);
}
