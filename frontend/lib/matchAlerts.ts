import type { MatchAlert } from '@/lib/api';
import { fmtLevel } from '@/lib/levelMatch';

const MS_HOUR = 3_600_000;

// Parties/heures d'un instant UTC dans un fuseau donné (sans luxon — Intl seul).
function localParts(iso: string, tz: string): { date: string; hm: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(d);
  const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
  return { date, hm };
}

/**
 * Fenêtre d'alerte pré-remplie autour d'un créneau : élargie d'1 h de chaque côté
 * (arithmétique pure sur les instants UTC → toujours correcte), puis exprimée en
 * date + HH:MM locaux du club. Les créneaux réservables (8h–22h) ne franchissent
 * jamais minuit après ±1 h → la date reste constante (hypothèse assumée).
 */
export function slotToAlertWindow(startIso: string, endIso: string, tz: string): { date: string; from: string; to: string } {
  const start = new Date(new Date(startIso).getTime() - MS_HOUR);
  const end   = new Date(new Date(endIso).getTime() + MS_HOUR);
  const s = localParts(start.toISOString(), tz);
  const e = localParts(end.toISOString(), tz);
  return { date: s.date, from: s.hm, to: e.hm };
}

/** Libellé de chip « jeu. 16 juil. · 18h30 → 20h00 » (+ « · Niv. 3–6 » si fourchette). */
export function alertChipLabel(alert: MatchAlert, tz: string): string {
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(alert.windowStart));
  const hm = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
  const base = `${day} · ${hm(alert.windowStart)} → ${hm(alert.windowEnd)}`;
  return alert.targetLevelMin != null && alert.targetLevelMax != null
    ? `${base} · Niv. ${fmtLevel(alert.targetLevelMin)}–${fmtLevel(alert.targetLevelMax)}`
    : base;
}
