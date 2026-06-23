// Fiabilité affichée (« façon Pista/Playtomic ») : un % dérivé du RD Glicko.
// RD élevé (joueur tout neuf) → fiabilité basse ; RD bas (niveau rodé) → fiabilité haute.
// Module PUR. Constantes de calibration isolées/tunables.

import { DEFAULT_RD, PROVISIONAL_RD_THRESHOLD } from './level';

/** Seuil de RD en-deçà duquel le niveau est « fiabilisé ». Source unique = level.ts. */
export const RD_RELIABLE = PROVISIONAL_RD_THRESHOLD; // 110
const RD_MAX = DEFAULT_RD;   // 350 — RD initial (incertitude max)
const RD_FLOOR = 50;         // RD plancher pratique → fiabilité 100 %

const REL_AT_MAX_RD = 50;    // % à RD max (joueur neuf)
const REL_AT_RELIABLE = 85;  // % au seuil « fiabilisé »
const REL_AT_FLOOR = 100;    // % au RD plancher

const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) =>
  y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);

/** RD Glicko → fiabilité 0–100 (entier, décroissante avec le RD). */
export function reliability(rd: number): number {
  if (rd >= RD_MAX) return REL_AT_MAX_RD;
  if (rd <= RD_FLOOR) return REL_AT_FLOOR;
  const pct = rd > RD_RELIABLE
    ? lerp(rd, RD_RELIABLE, RD_MAX, REL_AT_RELIABLE, REL_AT_MAX_RD)   // 110→85 … 350→50
    : lerp(rd, RD_FLOOR, RD_RELIABLE, REL_AT_FLOOR, REL_AT_RELIABLE); // 50→100 … 110→85
  return Math.round(pct);
}
