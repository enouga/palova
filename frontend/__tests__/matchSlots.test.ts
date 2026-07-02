import { teamSlotMaps } from '@/lib/matchSlots';

describe('teamSlotMaps', () => {
  const rows = [
    { userId: 'a', team: 1 as const, slot: 0 },
    { userId: 'b', team: 1 as const, slot: 1 },
    { userId: 'c', team: 2 as const, slot: 1 },
  ];

  it('reprend les team/slot serveur et ajoute le joueur sur la place visée', () => {
    expect(teamSlotMaps(rows, 4, { userId: 'n', team: 2, slot: 0 })).toEqual({
      teams: { a: 1, b: 1, c: 2, n: 2 },
      slots: { a: 0, b: 1, c: 1, n: 0 },
    });
  });

  it("place visée déjà prise → première place libre de l'équipe", () => {
    const { slots } = teamSlotMaps(rows, 4, { userId: 'n', team: 2, slot: 1 });
    expect(slots.n).toBe(0);
  });

  it('sans place visée → première place libre', () => {
    const { slots } = teamSlotMaps(rows, 4, { userId: 'n', team: 2 });
    expect(slots.n).toBe(0);
  });

  it("slots absents (données legacy) → comblés dans l'ordre, team absente → équipe 1", () => {
    expect(teamSlotMaps([{ userId: 'a' }, { userId: 'b', team: 2 }], 4)).toEqual({
      teams: { a: 1, b: 2 },
      slots: { a: 0, b: 0 },
    });
  });

  it("collision de slots serveur → le premier gagne, l'autre est recasé", () => {
    const { slots } = teamSlotMaps([
      { userId: 'a', team: 1, slot: 0 },
      { userId: 'b', team: 1, slot: 0 },
    ], 4);
    expect(slots).toEqual({ a: 0, b: 1 });
  });
});
