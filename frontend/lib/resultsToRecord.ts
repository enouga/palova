// Helpers purs de la carte « Résultat à saisir » (components/match/ResultsToRecord.tsx).
// Aucune dépendance React : testables directement.
import type { MatchToRecordPlayer } from '@/lib/api';

/** « Jean Dupont » → « J. Dupont ». Tolère un prénom ou un nom vide. */
export function abbrevName(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!first) return last;
  if (!last) return first;
  return `${first[0].toUpperCase()}. ${last}`;
}

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
