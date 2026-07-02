// Places G/D côté client — miroir du remplissage serveur `effectiveTeams`
// (spec 2026-07-02 places G/D persistées). Pur, sans dépendance UI.

export interface TeamedRow {
  userId: string;
  team?: 1 | 2 | null;
  slot?: number | null;
}

// Maps complètes { userId → équipe } et { userId → place } à envoyer au serveur après un
// ajout ou un remplacement : les rangées existantes gardent leur team/slot serveur (slot
// invalide ou en collision → recasé en ascendant, ordre d'entrée), la rangée `add` prend
// l'équipe imposée et la place visée si elle est libre — sinon la première libre de son équipe.
export function teamSlotMaps(
  rows: TeamedRow[],
  capacity: number,
  add?: { userId: string; team: 1 | 2; slot?: number },
): { teams: Record<string, 1 | 2>; slots: Record<string, number> } {
  const half = Math.max(1, Math.floor(capacity / 2));
  const all: Array<{ userId: string; team: 1 | 2; slot?: number | null }> = [
    ...rows.map((r) => ({ userId: r.userId, team: (r.team ?? 1) as 1 | 2, slot: r.slot })),
    ...(add ? [add] : []),
  ];
  const taken: Record<1 | 2, Set<number>> = { 1: new Set(), 2: new Set() };
  const teams: Record<string, 1 | 2> = {};
  const slots: Record<string, number> = {};
  for (const r of all) {
    teams[r.userId] = r.team;
    const s = r.slot;
    if (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < half && !taken[r.team].has(s)) {
      taken[r.team].add(s);
      slots[r.userId] = s;
    }
  }
  for (const r of all) {
    if (slots[r.userId] !== undefined) continue;
    let s = 0;
    while (taken[r.team].has(s)) s++;
    taken[r.team].add(s);
    slots[r.userId] = s;
  }
  return { teams, slots };
}
