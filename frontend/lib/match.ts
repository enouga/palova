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

/**
 * Libellé d'une équipe en prénoms : « Lucas & Jean ». En cas de prénom en double DANS LE
 * MATCH (`allPlayers`), on ajoute l'initiale du nom pour lever l'ambiguïté : « Jean D. & Jean M. ».
 * Réservé aux petits écrans / lignes concaténées où le prénom+nom complet des deux équipes
 * ne tient pas sur une ligne.
 */
export function teamFirstNamesLabel(
  team: { firstName: string; lastName: string }[],
  allPlayers: { firstName: string; lastName: string }[],
): string {
  const counts = new Map<string, number>();
  for (const p of allPlayers) {
    const key = p.firstName.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return team
    .map((p) => {
      const first = p.firstName.trim();
      const last = p.lastName.trim();
      const collides = (counts.get(first.toLowerCase()) ?? 0) > 1;
      return collides && last ? `${first} ${last[0].toUpperCase()}.` : first;
    })
    .join(' & ');
}

export interface MatchPlayerLite {
  userId: string;
  team: number;
  firstName: string;
  lastName: string;
  isMe: boolean;
}

/** Partenaire(s) = ma propre équipe sans moi ; adversaires = l'autre équipe. */
export function splitTeams(players: MatchPlayerLite[], myTeam: number): {
  partners: MatchPlayerLite[];
  opponents: MatchPlayerLite[];
} {
  return {
    partners: players.filter((p) => p.team === myTeam && !p.isMe),
    opponents: players.filter((p) => p.team !== myTeam),
  };
}
