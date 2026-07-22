// Helpers purs de la carte « Résultat à confirmer » (components/match/ResultsToConfirm.tsx).
// Aucune dépendance React : testables directement.
import type { MatchToConfirmPlayer } from '@/lib/api';

/**
 * Sépare les joueurs en deux équipes (team 1 puis team 2), ordre de tableau préservé au sein
 * de chaque équipe (le backend n'expose pas de `slot` pour ce DTO). Un `team` inattendu
 * (défense en profondeur — l'application garantit team 1|2) est versé dans l'équipe la moins
 * remplie plutôt que de perdre le joueur.
 */
export function teamRows(players: MatchToConfirmPlayer[]): [MatchToConfirmPlayer[], MatchToConfirmPlayer[]] {
  const team1: MatchToConfirmPlayer[] = [];
  const team2: MatchToConfirmPlayer[] = [];
  for (const p of players) {
    if (p.team === 1) team1.push(p);
    else if (p.team === 2) team2.push(p);
    else (team1.length <= team2.length ? team1 : team2).push(p);
  }
  return [team1, team2];
}

/**
 * Libellé d'une équipe en prénoms : « Lucas & Jean ». En cas de prénom en double DANS LE
 * MATCH (`allPlayers` = les 4 joueurs), on ajoute l'initiale du nom pour lever l'ambiguïté :
 * « Jean D. & Jean M. ». Un joueur sans nom garde son prénom seul.
 */
export function teamLabel(team: MatchToConfirmPlayer[], allPlayers: MatchToConfirmPlayer[]): string {
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

/** Score compact affiché sur la carte : « 6-4, 6-2 ». */
export function scoreSummary(sets: [number, number][]): string {
  return sets.map(([a, b]) => `${a}-${b}`).join(', ');
}
