// Statistiques joueur dérivées de l'historique de matchs, côté client.
// Helpers PURS : aucune horloge (les fenêtres temporelles s'ancrent sur les dates des données),
// aucun appel réseau — testables en isolation.

export interface StatsMatchPlayer {
  userId: string;
  team: number;
  firstName: string;
  lastName: string;
  isMe: boolean;
}

export interface StatsMatch {
  status: string;                 // seuls les CONFIRMED comptent
  sets: [number, number][];       // [jeux équipe 1, jeux équipe 2] par set
  playedAt: string;
  winningTeam: number | null;
  myTeam: number;
  players?: StatsMatchPlayer[];
  sport?: { name: string };
}

export interface FavoritePartner {
  userId: string;
  firstName: string;
  lastName: string;
  played: number;
  wins: number;
}

export interface PlayerStats {
  played: number;                 // matchs décidés (CONFIRMED avec vainqueur)
  wins: number;
  losses: number;
  winRate: number | null;         // % entier, null si aucun match décidé
  currentStreak: number;          // signé : +N victoires d'affilée, -N défaites, 0 sinon
  bestWinStreak: number;
  form: ('W' | 'L')[];            // ≤ 5 derniers résultats, chronologique (le plus récent en dernier)
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  favoritePartner: FavoritePartner | null; // partenaire le plus fréquent (départage : + de victoires)
}

const decidedOnly = (matches: StatsMatch[], sportName?: string): StatsMatch[] =>
  matches
    .filter((m) => m.status === 'CONFIRMED' && m.winningTeam != null)
    .filter((m) => !sportName || !m.sport?.name || m.sport.name === sportName)
    .slice()
    .sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt));

/** Agrège l'historique de matchs en stats d'affichage. `sportName` (optionnel) filtre par sport. */
export function computePlayerStats(matches: StatsMatch[], sportName?: string): PlayerStats {
  const decided = decidedOnly(matches, sportName);

  let wins = 0, losses = 0, setsWon = 0, setsLost = 0, gamesWon = 0, gamesLost = 0;
  let bestWinStreak = 0, run = 0;
  const results: ('W' | 'L')[] = [];
  const partners = new Map<string, FavoritePartner>();

  for (const m of decided) {
    const won = m.winningTeam === m.myTeam;
    if (won) { wins++; run++; bestWinStreak = Math.max(bestWinStreak, run); }
    else { losses++; run = 0; }
    results.push(won ? 'W' : 'L');

    for (const [a, b] of m.sets) {
      const mine = m.myTeam === 1 ? a : b;
      const theirs = m.myTeam === 1 ? b : a;
      if (mine > theirs) setsWon++; else if (theirs > mine) setsLost++;
      gamesWon += mine;
      gamesLost += theirs;
    }

    for (const p of m.players ?? []) {
      if (p.team !== m.myTeam || p.isMe) continue;
      const cur = partners.get(p.userId) ?? { userId: p.userId, firstName: p.firstName, lastName: p.lastName, played: 0, wins: 0 };
      cur.played++;
      if (won) cur.wins++;
      partners.set(p.userId, cur);
    }
  }

  // Série en cours, signée, depuis la fin.
  let currentStreak = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const w = results[i] === 'W';
    if (currentStreak === 0) currentStreak = w ? 1 : -1;
    else if (currentStreak > 0 && w) currentStreak++;
    else if (currentStreak < 0 && !w) currentStreak--;
    else break;
  }

  let favoritePartner: FavoritePartner | null = null;
  for (const p of partners.values()) {
    if (!favoritePartner || p.played > favoritePartner.played ||
        (p.played === favoritePartner.played && p.wins > favoritePartner.wins)) {
      favoritePartner = p;
    }
  }

  const played = wins + losses;
  return {
    played, wins, losses,
    winRate: played > 0 ? Math.round((wins / played) * 100) : null,
    currentStreak, bestWinStreak,
    form: results.slice(-5),
    setsWon, setsLost, gamesWon, gamesLost,
    favoritePartner,
  };
}

export interface LevelPoint { playedAt: string; level: number; }

/**
 * Tendance de niveau : delta entre le dernier point et le niveau ~`days` jours avant CE point
 * (ancré sur les dates des données — pas d'horloge). Baseline = dernier point antérieur ou égal
 * à la fenêtre, sinon le tout premier point. null si < 2 points.
 */
export function levelTrend(history: LevelPoint[], days = 30): number | null {
  if (history.length < 2) return null;
  const sorted = history.slice().sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt));
  const last = sorted[sorted.length - 1];
  const cutoff = Date.parse(last.playedAt) - days * 86400e3;
  let baseline = sorted[0];
  for (const p of sorted) {
    if (Date.parse(p.playedAt) <= cutoff) baseline = p;
    else break;
  }
  return Math.round((last.level - baseline.level) * 10) / 10;
}

/** Les `n` derniers points de la courbe, ordre chronologique (pour la sparkline). */
export function sparkPoints(history: LevelPoint[], n = 12): LevelPoint[] {
  return history.slice().sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt)).slice(-n);
}
