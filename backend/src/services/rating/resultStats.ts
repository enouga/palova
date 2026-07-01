// Module PUR : bilan victoires/défaites + série en cours d'un joueur à partir de ses matchs.
export interface ResultStatRow {
  team: number;
  winningTeam: number | null;
  playedAt: Date;
}

export interface ResultStats {
  wins: number;
  losses: number;
  /** Entier signé : +N victoires d'affilée en tête, -N défaites, 0 si aucune. */
  streak: number;
}

/**
 * Bilan V/D + série en cours d'un joueur, à partir de ses lignes de match
 * TRIÉES par playedAt DÉCROISSANT (plus récent en premier).
 * Seuls les matchs décidés (winningTeam != null) sont pris en compte.
 */
export function computeResultStats(rows: ResultStatRow[]): ResultStats {
  // Tri défensif : la série dépend de l'ordre (plus récent d'abord), on ne fait pas
  // confiance à l'ordre d'arrivée (certaines requêtes de matchs trient en ascendant).
  const decided = rows
    .filter((r) => r.winningTeam != null)
    .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime());
  let wins = 0;
  let losses = 0;
  for (const r of decided) {
    if (r.winningTeam === r.team) wins++;
    else losses++;
  }
  let streak = 0;
  for (const r of decided) {
    const won = r.winningTeam === r.team;
    if (streak === 0) streak = won ? 1 : -1;
    else if (won && streak > 0) streak++;
    else if (!won && streak < 0) streak--;
    else break;
  }
  return { wins, losses, streak };
}
