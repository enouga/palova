import { snapMinutes } from './planningTime';

// Géométrie pure du drag & drop de la grille du planning (déplacer / étirer / créer en
// glissant). Le déplacement est DELTA-based (écart de pointeur depuis le mousedown) plutôt
// que position-absolue : plus simple, et insensible au défilement de la grille pendant le
// drag. La colonne (terrain) survolée reste une question DOM (document.elementFromPoint),
// gérée par l'appelant — tout ce qui touche au TEMPS est pur et testé ici.

/** Écart de pointeur (px, vertical) → écart en minutes, aligné sur le pas (15 par défaut). */
export function dragDeltaMinutes(deltaPx: number, hourHeightPx: number, step = 15): number {
  return snapMinutes((deltaPx / hourHeightPx) * 60, step);
}

/** Nouveau [début,fin] d'un DÉPLACEMENT (span fixe = durationMin), clampé aux heures d'ouverture. */
export function moveTarget(
  originStartMin: number, durationMin: number, deltaPx: number, hourHeightPx: number, openMin: number, closeMin: number,
): { startMin: number; endMin: number } {
  const delta = dragDeltaMinutes(deltaPx, hourHeightPx);
  const maxStart = closeMin - durationMin;
  const startMin = Math.max(openMin, Math.min(originStartMin + delta, maxStart));
  return { startMin, endMin: startMin + durationMin };
}

/** Nouvelle fin d'un REDIMENSIONNEMENT (le début ne bouge pas), durée minimale 30 min. */
export function resizeTarget(
  startMin: number, originEndMin: number, deltaPx: number, hourHeightPx: number, closeMin: number,
): number {
  const delta = dragDeltaMinutes(deltaPx, hourHeightPx);
  return Math.max(startMin + 30, Math.min(originEndMin + delta, closeMin));
}

/** Fin d'une CRÉATION par glisser (le début est l'ancre fixe du mousedown), durée minimale 30 min. */
export function createTarget(
  anchorMin: number, deltaPx: number, hourHeightPx: number, closeMin: number,
): number {
  const delta = dragDeltaMinutes(deltaPx, hourHeightPx);
  return Math.min(Math.max(anchorMin + delta, anchorMin + 30), closeMin);
}
