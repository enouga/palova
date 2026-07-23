import { toCents, fmtEuros } from '@/lib/caisse';

// Helpers PURS de la fiche joueur (passif). Aucune dépendance DOM, aucun `new Date()`
// au calcul de rendu — toute la géométrie des graphiques SVG et les libellés FR
// vivent ici (testables), les composants ne font que dessiner. Miroir de l'esprit
// de lib/caisse.ts / lib/levelHistory.ts.

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne',
  VOUCHER: 'Ticket CE', OTHER: 'Autre', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abonnement',
};

/** Libellé d'une méthode de paiement (repli : la clé brute). */
export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

/** "yyyy-MM" → "juin" (parse pur, sans Date — hydration-safe). */
export function monthShort(monthKey: string): string {
  const m = Number(monthKey.slice(5, 7));
  return MONTHS_FR[m - 1] ?? monthKey;
}

/** 1=lundi…7=dimanche → "lundi". */
export function weekdayLabel(weekday: number): string {
  return WEEKDAYS_FR[weekday - 1] ?? '—';
}

export const WEEKDAY_INITIALS = WEEKDAYS_SHORT;

/** Taux de victoire en %, ou null si aucun match joué. */
export function winRate(wins: number, losses: number): number | null {
  const total = wins + losses;
  return total > 0 ? Math.round((wins / total) * 100) : null;
}

/** "Vu il y a N j" / "Vu aujourd'hui", ou null si jamais venu. */
export function lastVisitLabel(daysSinceLastVisit: number | null): string | null {
  if (daysSinceLastVisit == null) return null;
  if (daysSinceLastVisit <= 0) return "Vu aujourd'hui";
  if (daysSinceLastVisit === 1) return 'Vu hier';
  return `Vu il y a ${daysSinceLastVisit} j`;
}

/** Taux d'annulation en % (entier). */
export function cancellationLabel(rate: number): string {
  return `${Math.round(rate * 100)} %`;
}

/** Ancienneté lisible : "2 ans", "5 mois", "12 j". */
export function tenureLabel(days: number): string {
  if (days >= 365) { const y = Math.floor(days / 365); return `${y} an${y > 1 ? 's' : ''}`; }
  if (days >= 60) return `${Math.floor(days / 30)} mois`;
  return `${Math.max(0, days)} j`;
}

export interface RevenueBar { month: string; label: string; value: number; x: number; y: number; w: number; h: number; }
export interface RevenueChartModel { max: number; bars: RevenueBar[]; width: number; height: number; }

/**
 * Géométrie des barres « CA par mois ». Auto-zoom [0, max] ; barres réparties
 * sur la largeur, hauteur ∝ valeur. Montants reçus en strings décimales API.
 */
export function revenueChartModel(
  series: ReadonlyArray<{ month: string; net: string }>,
  width = 320, height = 120, gap = 6,
): RevenueChartModel {
  const values = series.map((s) => Math.max(0, toCents(s.net)));
  const max = values.reduce((m, v) => Math.max(m, v), 0);
  const n = series.length;
  const barW = n > 0 ? Math.max(2, (width - gap * (n - 1)) / n) : 0;
  const bars: RevenueBar[] = series.map((s, i) => {
    const value = values[i];
    const h = max > 0 ? (value / max) * height : 0;
    return { month: s.month, label: monthShort(s.month), value, x: i * (barW + gap), y: height - h, w: barW, h };
  });
  return { max, bars, width, height };
}

export interface HeatmapModel { max: number; matrix: number[][]; peak: { weekday: number; hour: number; count: number } | null; }

/** Max et cellule de pointe d'une heatmap jour×heure (7×24). */
export function heatmapModel(matrix: number[][]): HeatmapModel {
  let max = 0;
  let peak: { weekday: number; hour: number; count: number } | null = null;
  for (let d = 0; d < matrix.length; d++) {
    for (let h = 0; h < (matrix[d]?.length ?? 0); h++) {
      const c = matrix[d][h];
      if (c > max) max = c;
      if (c > 0 && (!peak || c > peak.count)) peak = { weekday: d + 1, hour: h, count: c };
    }
  }
  return { max, matrix, peak };
}

export interface DonutSegment { key: string; label: string; value: number; fraction: number; dashArray: string; dashOffset: number; }
export interface DonutModel { total: number; circumference: number; segments: DonutSegment[]; }

/**
 * Anneau (donut) des montants par méthode, en stroke-dasharray. Chaque segment
 * est un cercle complet dont le tiret couvre sa fraction du périmètre, décalé du
 * cumul précédent. Montants reçus en strings décimales API.
 */
export function donutSegments(byMethod: Record<string, string>, radius = 52): DonutModel {
  const circumference = 2 * Math.PI * radius;
  const entries = Object.entries(byMethod)
    .map(([key, v]) => ({ key, value: Math.max(0, toCents(v)) }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = entries.reduce((s, e) => s + e.value, 0);
  let acc = 0;
  const segments: DonutSegment[] = entries.map((e) => {
    const fraction = total > 0 ? e.value / total : 0;
    const len = fraction * circumference;
    const seg: DonutSegment = {
      key: e.key, label: methodLabel(e.key), value: e.value, fraction,
      dashArray: `${len.toFixed(2)} ${(circumference - len).toFixed(2)}`,
      dashOffset: -acc,
    };
    acc += len;
    return seg;
  });
  return { total, circumference, segments };
}

/** Montant en centimes → "13,50 €" (réexport de la convention caisse). */
export function euros(cents: number): string {
  return fmtEuros(cents);
}

/** Montant en centimes → "12,00 €" (toujours 2 décimales, pour les libellés d'alerte/badge ci-dessous). */
const fmtCents = (c: number): string => `${(c / 100).toFixed(2).replace('.', ',')} €`;

export interface MemberAlert { key: 'outstanding' | 'lowPackage' | 'subExpiring'; label: string }

/** Alertes du bandeau de la fiche 360 (occasions de relance) — pur, testé. */
export function memberAlerts(
  input: {
    outstandingCents: number;
    balances: Array<{ kind: 'ENTRIES' | 'WALLET'; name: string; creditsRemaining: number | null; amountRemaining: string | null; expiresAt: string | null }>;
    subscriptionExpiresAt: string | null;
  },
  now: Date,
): MemberAlert[] {
  const out: MemberAlert[] = [];
  if (input.outstandingCents > 0) out.push({ key: 'outstanding', label: `${fmtCents(input.outstandingCents)} dus` });
  const low = input.balances.some((b) =>
    (b.expiresAt == null || new Date(b.expiresAt).getTime() > now.getTime())
    && b.kind === 'ENTRIES' && b.creditsRemaining != null && b.creditsRemaining > 0 && b.creditsRemaining <= 2);
  if (low) out.push({ key: 'lowPackage', label: 'Carnet presque vide' });
  if (input.subscriptionExpiresAt) {
    const days = Math.ceil((new Date(input.subscriptionExpiresAt).getTime() - now.getTime()) / 86_400_000);
    if (days > 0 && days <= 30) out.push({ key: 'subExpiring', label: `Abonnement expire dans ${days} j` });
  }
  return out;
}

/** Badge paiement d'une ligne de réservation de la fiche. */
export function reservationPaymentBadge(
  r: { status: string; attributedCents: number; dueCents: number },
): { label: string; tone: 'ok' | 'due' | 'off' } {
  if (r.status === 'CANCELLED') return { label: 'Annulée', tone: 'off' };
  if (r.dueCents > 0 && r.attributedCents < r.dueCents) return { label: `Reste ${fmtCents(r.dueCents - r.attributedCents)}`, tone: 'due' };
  return { label: r.attributedCents > 0 ? `Payé ${fmtCents(r.attributedCents)} ✓` : 'Payé ✓', tone: 'ok' };
}

/** Résultat V/D du joueur sur une ligne de résa (null si aucun match saisi). */
export function matchOutcome(
  m: { winningTeam: number | null; myTeam: number | null; sets: [number, number][]; competitive: boolean } | null,
): { won: boolean; score: string } | null {
  if (!m || m.winningTeam == null || m.myTeam == null) return null;
  return { won: m.winningTeam === m.myTeam, score: m.sets.map(([a, b]) => `${a}-${b}`).join(' ') };
}
