// Rendus de nom courts « Prénom N. » avec désambiguïsation par lot
// (spec 2026-07-02-matchteams-noms-abreges). Pur, sans dépendance UI —
// réutilisable au-delà de MatchTeams (PlayerPills plus tard).

export interface NamedPlayer {
  id: string;
  firstName: string;
  lastName: string;
}

// Préfixe de collision : nom débarrassé des espaces, coupé à n caractères,
// première lettre majusculée (« de la Fuente », n=2 → « De »).
function prefix(lastName: string, n: number): string {
  const compact = lastName.replace(/\s+/g, '');
  const p = compact.slice(0, n);
  return p.charAt(0).toUpperCase() + p.slice(1);
}

// « Prénom N. » pour chaque joueur. En cas de collision entre rendus, l'initiale
// s'allonge d'un caractère — seulement pour les joueurs en collision — jusqu'à
// distinction ; nom épuisé → nom complet (deux homonymes complets restent identiques).
export function shortNamesById(players: NamedPlayer[]): Record<string, string> {
  const lens = new Map<string, number>(players.map((p) => [p.id, 1]));
  const label = (p: NamedPlayer): string => {
    const compact = p.lastName.replace(/\s+/g, '');
    if (!compact) return p.firstName;
    const n = lens.get(p.id)!;
    if (n >= compact.length) return `${p.firstName} ${p.lastName}`.trim();
    return `${p.firstName} ${prefix(p.lastName, n)}.`;
  };
  // Boucle bornée : chaque tour allonge d'au moins 1 les joueurs en collision.
  for (let guard = 0; guard < 40; guard++) {
    const byLabel = new Map<string, NamedPlayer[]>();
    for (const p of players) {
      const l = label(p);
      byLabel.set(l, [...(byLabel.get(l) ?? []), p]);
    }
    let changed = false;
    for (const group of byLabel.values()) {
      if (group.length < 2) continue;
      for (const p of group) {
        const compact = p.lastName.replace(/\s+/g, '');
        const n = lens.get(p.id)!;
        if (n < compact.length) { lens.set(p.id, n + 1); changed = true; }
      }
    }
    if (!changed) break;
  }
  return Object.fromEntries(players.map((p) => [p.id, label(p)]));
}
