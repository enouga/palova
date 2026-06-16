// Helpers purs pour la saisie/affichage des résultats de match. Miroir léger de la logique backend.

export type SetScore = [number, number];

export function scoreLine(sets: SetScore[]): string {
  if (!sets.length) return '—';
  return sets.map(([a, b]) => `${a}-${b}`).join(' / ');
}

/** Une réservation peut donner lieu à un résultat si elle est passée et a exactement 4 participants. */
export function canRecordResult(
  reservation: { endTime: string; participants: { userId: string }[] },
  now: Date,
): boolean {
  return new Date(reservation.endTime).getTime() <= now.getTime() && reservation.participants.length === 4;
}

/** Sets valides : ≥1 set, chaque jeu 0–7, pas d'égalité dans un set. */
export function validSets(sets: SetScore[]): boolean {
  if (!sets.length) return false;
  return sets.every(([a, b]) =>
    Number.isInteger(a) && Number.isInteger(b) && a >= 0 && a <= 7 && b >= 0 && b <= 7 && a !== b);
}

export function winnerFromSets(sets: SetScore[]): 1 | 2 {
  let s1 = 0, s2 = 0;
  for (const [a, b] of sets) { if (a > b) s1++; else if (b > a) s2++; }
  return s1 >= s2 ? 1 : 2;
}
