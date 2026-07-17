import { teamRows, teamLabel } from '@/lib/resultsToRecord';
import type { MatchToRecordPlayer } from '@/lib/api';

const p = (userId: string, firstName: string, lastName: string, team: 1 | 2, slot: number): MatchToRecordPlayer =>
  ({ userId, firstName, lastName, avatarUrl: null, isOrganizer: false, team, slot });

const roster: MatchToRecordPlayer[] = [
  p('u1', 'Lucas', 'Moreau', 1, 0),
  p('u2', 'Jean', 'Dupont', 1, 1),
  p('u3', 'Celine', 'Barbier', 2, 0),
  p('u4', 'Melanie', 'Bernard', 2, 1),
];

describe('teamRows', () => {
  it('sépare les deux équipes triées par slot', () => {
    const [t1, t2] = teamRows(roster);
    expect(t1.map((x) => x.userId)).toEqual(['u1', 'u2']);
    expect(t2.map((x) => x.userId)).toEqual(['u3', 'u4']);
  });

  it('verse un team inattendu dans la rangée la moins remplie', () => {
    const odd = [p('a', 'A', 'A', 3 as 1, 0), p('b', 'B', 'B', 3 as 1, 0)];
    const [t1, t2] = teamRows(odd);
    expect(t1).toHaveLength(1);
    expect(t2).toHaveLength(1);
  });
});

describe('teamLabel', () => {
  it('joint les prénoms d\'une équipe', () => {
    const [t1] = teamRows(roster);
    expect(teamLabel(t1, roster)).toBe('Lucas & Jean');
  });

  it('désambiguïse par l\'initiale du nom en cas de prénom en double', () => {
    const dup = [
      p('u1', 'Jean', 'Dupont', 1, 0),
      p('u2', 'Marie', 'Leroy', 1, 1),
      p('u3', 'Jean', 'Martin', 2, 0),
      p('u4', 'Paul', 'Roux', 2, 1),
    ];
    const [t1, t2] = teamRows(dup);
    expect(teamLabel(t1, dup)).toBe('Jean D. & Marie');
    expect(teamLabel(t2, dup)).toBe('Jean M. & Paul');
  });
});
