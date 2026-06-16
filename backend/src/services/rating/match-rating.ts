// Câble le moteur Glicko-2 (Lot 1) au format match 2v2 : chaque joueur est mis à jour contre
// l'ÉQUIPE adverse (note moyenne + RD quadratique moyen), score pondéré par la marge. Module PUR.
import { updateRating, RatingState, Opponent, MAX_RD } from './glicko2';
import { outcomeScore, SetScore } from './score';

export interface TeamPlayer extends RatingState { team: 1 | 2; }

export const RATING_PERIOD_DAYS = 7; // une « période » Glicko = 1 semaine

/** Regonfle le RD pour `days` d'inactivité (la note ne bouge jamais), borné à MAX_RD. */
export function decayForInactivity(state: RatingState, days: number): RatingState {
  const periods = Math.floor(Math.max(0, days) / RATING_PERIOD_DAYS);
  let s = state;
  for (let i = 0; i < periods && s.rd < MAX_RD; i++) s = updateRating(s, []);
  return s;
}

const teamAggregate = (players: RatingState[]): { rating: number; rd: number } => ({
  rating: players.reduce((sum, p) => sum + p.rating, 0) / players.length,
  rd: Math.sqrt(players.reduce((sum, p) => sum + p.rd * p.rd, 0) / players.length),
});

/** Nouveaux états des joueurs après un match 2v2. Ordre de sortie = ordre d'entrée. */
export function applyMatchRatings(players: TeamPlayer[], sets: SetScore[]): RatingState[] {
  const agg1 = teamAggregate(players.filter((p) => p.team === 1));
  const agg2 = teamAggregate(players.filter((p) => p.team === 2));
  const score1 = outcomeScore(sets, 1);
  const score2 = outcomeScore(sets, 2);
  return players.map((p) => {
    const opp = p.team === 1 ? agg2 : agg1;
    const opponent: Opponent = { rating: opp.rating, rd: opp.rd, score: p.team === 1 ? score1 : score2 };
    return updateRating({ rating: p.rating, rd: p.rd, volatility: p.volatility }, [opponent]);
  });
}
