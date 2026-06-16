import { scoreLine, canRecordResult, validSets, winnerFromSets } from '@/lib/match';

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
