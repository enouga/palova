import { scoreLine, canRecordResult, validSets, winnerFromSets, splitTeams, teamFirstNamesLabel } from '@/lib/match';

describe('scoreLine', () => {
  it('formate les sets', () => expect(scoreLine([[6, 4], [3, 6], [7, 5]])).toBe('6-4 / 3-6 / 7-5'));
  it('vide → tiret', () => expect(scoreLine([])).toBe('—'));
});

describe('canRecordResult', () => {
  const base = { endTime: '2026-06-10T11:00:00Z', participants: [1, 2, 3, 4].map((i) => ({ userId: `u${i}` })) } as any;
  it('résa passée à 4 joueurs → true', () => expect(canRecordResult(base, new Date('2026-06-11T00:00:00Z'))).toBe(true));
  it('résa future → false', () => expect(canRecordResult(base, new Date('2026-06-09T00:00:00Z'))).toBe(false));
  it('moins de 4 joueurs → false', () =>
    expect(canRecordResult({ ...base, participants: [{ userId: 'u1' }] }, new Date('2026-06-11T00:00:00Z'))).toBe(false));
});

describe('validSets / winnerFromSets', () => {
  it('au moins un set, scores 0-7, pas d égalité', () => {
    expect(validSets([[6, 4]])).toBe(true);
    expect(validSets([])).toBe(false);
    expect(validSets([[6, 6]])).toBe(false);
    expect(validSets([[8, 4]])).toBe(false);
  });
  it('vainqueur au nombre de sets', () => {
    expect(winnerFromSets([[6, 4], [3, 6], [6, 2]])).toBe(1);
    expect(winnerFromSets([[4, 6], [3, 6]])).toBe(2);
  });
});

const players = [
  { userId: 'u1', team: 2, firstName: 'Eric', lastName: 'Nougayrede', isMe: true },
  { userId: 'u2', team: 2, firstName: 'Marie', lastName: 'Durand', isMe: false },
  { userId: 'u3', team: 1, firstName: 'Paul', lastName: 'Roy', isMe: false },
  { userId: 'u4', team: 1, firstName: 'Lea', lastName: 'Martin', isMe: false },
];

describe('splitTeams', () => {
  it('sépare partenaire (mon équipe sans moi) et adversaires', () => {
    const { partners, opponents } = splitTeams(players, 2);
    expect(partners.map((p) => p.userId)).toEqual(['u2']);
    expect(opponents.map((p) => p.userId).sort()).toEqual(['u3', 'u4']);
  });

  it('tolère une liste partielle (pas de partenaire)', () => {
    const { partners, opponents } = splitTeams([players[0], players[2]], 2);
    expect(partners).toEqual([]);
    expect(opponents.map((p) => p.userId)).toEqual(['u3']);
  });
});

describe('teamFirstNamesLabel', () => {
  it('joint les prénoms', () => {
    const all = [
      { firstName: 'Jean', lastName: 'Dupont' },
      { firstName: 'Adrien', lastName: 'Abonne' },
      { firstName: 'Karim', lastName: 'Benali' },
      { firstName: 'Lucas', lastName: 'Moreau' },
    ];
    expect(teamFirstNamesLabel([all[0], all[1]], all)).toBe('Jean & Adrien');
  });

  it('désambiguïse un prénom en double par l\'initiale du nom', () => {
    const all = [
      { firstName: 'Jean', lastName: 'Dupont' },
      { firstName: 'Jean', lastName: 'Moreau' },
      { firstName: 'Karim', lastName: 'Benali' },
      { firstName: 'Lea', lastName: 'Martin' },
    ];
    expect(teamFirstNamesLabel([all[0], all[2]], all)).toBe('Jean D. & Karim');
    expect(teamFirstNamesLabel([all[1], all[3]], all)).toBe('Jean M. & Lea');
  });
});
