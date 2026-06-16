// Conversion d'un score set-par-set en score Glicko ∈ [0,1] pondéré par la MARGE.
// [jeuxÉquipe1, jeuxÉquipe2] par set.

export type SetScore = [number, number];

/** Équipe vainqueure (au nombre de sets gagnés ; égalité improbable → équipe 1). */
export function winningTeam(sets: SetScore[]): 1 | 2 {
  let s1 = 0;
  let s2 = 0;
  for (const [a, b] of sets) {
    if (a > b) s1++;
    else if (b > a) s2++;
  }
  return s1 >= s2 ? 1 : 2;
}

/** Score ∈ [0,1] du point de vue de `team`, basé sur le ratio de jeux : 6-0/6-0 ≈ 1, 7-6/7-6 ≈ 0,54. */
export function outcomeScore(sets: SetScore[], team: 1 | 2): number {
  let forG = 0;
  let againstG = 0;
  for (const [a, b] of sets) {
    if (team === 1) { forG += a; againstG += b; }
    else { forG += b; againstG += a; }
  }
  const total = forG + againstG;
  if (total === 0) return 0.5;
  const s = 0.5 + 0.5 * (forG - againstG) / total;
  return Math.max(0, Math.min(1, s));
}
