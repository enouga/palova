import { abbrevName, teamRows } from '@/lib/resultsToRecord';
import type { MatchToRecordPlayer } from '@/lib/api';

const p = (userId: string, firstName: string, lastName: string, team: 1 | 2, slot: number): MatchToRecordPlayer =>
  ({ userId, isOrganizer: false, firstName, lastName, avatarUrl: null, team, slot });

describe('abbrevName', () => {
  it('abrège le prénom en initiale', () => {
    expect(abbrevName('Jean', 'Dupont')).toBe('J. Dupont');
  });

  it('renvoie le nom seul quand le prénom est vide', () => {
    expect(abbrevName('', 'Dupont')).toBe('Dupont');
  });

  it('renvoie le prénom seul quand le nom est vide', () => {
    expect(abbrevName('Jean', '')).toBe('Jean');
  });
});

describe('teamRows', () => {
  it('sépare les joueurs en deux rangées ordonnées par slot', () => {
    const players = [
      p('u2', 'Marie', 'Leroy', 1, 1),
      p('u3', 'Paul', 'Roux', 2, 0),
      p('u1', 'Jean', 'Dupont', 1, 0),
      p('u4', 'Lea', 'Girard', 2, 1),
    ];
    const [team1, team2] = teamRows(players);
    expect(team1.map((x) => x.userId)).toEqual(['u1', 'u2']);
    expect(team2.map((x) => x.userId)).toEqual(['u3', 'u4']);
  });

  it('verse un team inattendu dans la rangée la moins remplie', () => {
    const players = [
      p('u1', 'Jean', 'Dupont', 1, 0),
      p('u2', 'Marie', 'Leroy', 1, 1),
      p('u3', 'Paul', 'Roux', 1, 0),
      { ...p('u4', 'Lea', 'Girard', 1, 1), team: 3 as unknown as 1 },
    ];
    const [team1, team2] = teamRows(players);
    expect(team1).toHaveLength(2);
    expect(team2.map((x) => x.userId)).toEqual(['u3', 'u4']);
  });

  it('renvoie deux rangées vides pour une liste vide', () => {
    expect(teamRows([])).toEqual([[], []]);
  });
});
