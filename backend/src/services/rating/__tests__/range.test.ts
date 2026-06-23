import { inRange } from '../range';

describe('inRange (matchmaking par fourchette de niveau)', () => {
  it('niveau inconnu (null) → toujours dans la fourchette', () => {
    expect(inRange(null, 2, 5)).toBe(true);
    expect(inRange(null, null, null)).toBe(true);
  });

  it('en dessous du min → false', () => {
    expect(inRange(1, 2, 5)).toBe(false);
  });

  it('au dessus du max → false', () => {
    expect(inRange(6, 2, 5)).toBe(false);
  });

  it('dans la fourchette (bornes incluses) → true', () => {
    expect(inRange(2, 2, 5)).toBe(true);
    expect(inRange(3.5, 2, 5)).toBe(true);
    expect(inRange(5, 2, 5)).toBe(true);
  });

  it('fourchette ouverte côté min (min null) → seul le max contraint', () => {
    expect(inRange(0, null, 5)).toBe(true);
    expect(inRange(6, null, 5)).toBe(false);
  });

  it('fourchette ouverte côté max (max null) → seul le min contraint', () => {
    expect(inRange(8, 2, null)).toBe(true);
    expect(inRange(1, 2, null)).toBe(false);
  });
});
