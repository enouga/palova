// Helpers purs de la carte « Résultat à saisir » (components/match/ResultsToRecord.tsx).
// Aucune dépendance React : testables directement.
import type { MatchToRecordPlayer } from '@/lib/api';

/**
 * Sépare les joueurs en deux rangées d'équipe ordonnées par `slot` (gauche puis droite).
 * Le backend garantit un 2v2 avec team/slot concrets (effectiveTeams) ; par défense en
 * profondeur, un `team` inattendu est versé dans la rangée la moins remplie. Un `team`
 * explicite est toujours respecté — un rendu déséquilibré visible vaut mieux qu'un 2v2
 * plausible obtenu en déplaçant silencieusement un joueur valide.
 */
export function teamRows(players: MatchToRecordPlayer[]): [MatchToRecordPlayer[], MatchToRecordPlayer[]] {
  const team1: MatchToRecordPlayer[] = [];
  const team2: MatchToRecordPlayer[] = [];
  for (const p of players) {
    if (p.team === 1) team1.push(p);
    else if (p.team === 2) team2.push(p);
    else (team1.length <= team2.length ? team1 : team2).push(p);
  }
  const bySlot = (a: MatchToRecordPlayer, b: MatchToRecordPlayer) => a.slot - b.slot;
  return [team1.sort(bySlot), team2.sort(bySlot)];
}

/**
 * Libellé d'une équipe en prénoms : « Lucas & Jean ». En cas de prénom en double DANS LE
 * MATCH (`allPlayers` = les 4 joueurs), on ajoute l'initiale du nom pour lever l'ambiguïté :
 * « Jean D. & Jean M. ». Un joueur sans nom garde son prénom seul.
 */
export function teamLabel(team: MatchToRecordPlayer[], allPlayers: MatchToRecordPlayer[]): string {
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
