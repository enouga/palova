import { outcomeScore, winningTeam, SetScore } from '../score';

const crush: SetScore[] = [[6, 0], [6, 0]];
const tight: SetScore[] = [[7, 6], [7, 6]];

describe('winningTeam', () => {
  it('équipe 1 gagne 2 sets', () => expect(winningTeam([[6, 4], [6, 3]])).toBe(1));
  it('équipe 2 gagne 2 sets', () => expect(winningTeam([[4, 6], [3, 6]])).toBe(2));
  it('match en 3 sets gagné par 2', () => expect(winningTeam([[6, 4], [3, 6], [4, 6]])).toBe(2));
});

describe('outcomeScore', () => {
  it('écrasement → score proche de 1 pour le vainqueur', () => {
    expect(outcomeScore(crush, 1)).toBeGreaterThan(0.95);
    expect(outcomeScore(crush, 2)).toBeLessThan(0.05);
  });
  it('victoire serrée → score à peine au-dessus de 0,5', () => {
    expect(outcomeScore(tight, 1)).toBeGreaterThan(0.5);
    expect(outcomeScore(tight, 1)).toBeLessThan(0.6);
  });
  it('battre large rapporte un score plus haut que battre serré', () => {
    expect(outcomeScore(crush, 1)).toBeGreaterThan(outcomeScore(tight, 1));
  });
  it('aucun jeu → 0,5 (neutre)', () => {
    expect(outcomeScore([[0, 0]], 1)).toBe(0.5);
  });
});
