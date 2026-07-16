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
 * profondeur, chaque rangée est plafonnée à la moitié de l'effectif — un `team` inattendu
 * (ou un excédent au-delà du plafond) est versé dans la rangée la moins remplie.
 */
export function teamRows(players: MatchToRecordPlayer[]): [MatchToRecordPlayer[], MatchToRecordPlayer[]] {
  const team1: MatchToRecordPlayer[] = [];
  const team2: MatchToRecordPlayer[] = [];
  const half = Math.ceil(players.length / 2);
  for (const p of players) {
    const preferred: 1 | 2 = p.team === 1 || p.team === 2 ? p.team : (team1.length <= team2.length ? 1 : 2);
    const target = preferred === 1 ? team1 : team2;
    const other = preferred === 1 ? team2 : team1;
    if (target.length < half) target.push(p);
    else other.push(p);
  }
  const bySlot = (a: MatchToRecordPlayer, b: MatchToRecordPlayer) => a.slot - b.slot;
  return [team1.sort(bySlot), team2.sort(bySlot)];
}
