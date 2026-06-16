import { updateRating, RatingState } from '../glicko2';

const fresh: RatingState = { rating: 1500, rd: 200, volatility: 0.06 };

describe('updateRating (Glicko-2)', () => {
  it('gagner contre un égal fait monter la note', () => {
    const r = updateRating(fresh, [{ rating: 1500, rd: 200, score: 1 }]);
    expect(r.rating).toBeGreaterThan(1500);
  });

  it('perdre contre un égal fait baisser la note', () => {
    const r = updateRating(fresh, [{ rating: 1500, rd: 200, score: 0 }]);
    expect(r.rating).toBeLessThan(1500);
  });

  it('un match réduit l incertitude (RD)', () => {
    const r = updateRating(fresh, [{ rating: 1500, rd: 200, score: 1 }]);
    expect(r.rd).toBeLessThan(fresh.rd);
  });

  it('battre plus fort rapporte plus que battre plus faible', () => {
    const vsStrong = updateRating(fresh, [{ rating: 1800, rd: 200, score: 1 }]);
    const vsWeak = updateRating(fresh, [{ rating: 1200, rd: 200, score: 1 }]);
    expect(vsStrong.rating - 1500).toBeGreaterThan(vsWeak.rating - 1500);
  });

  it('aucun match : la note ne bouge pas mais le RD remonte (décote d inactivité)', () => {
    const r = updateRating({ rating: 1500, rd: 80, volatility: 0.06 }, []);
    expect(r.rating).toBe(1500);
    expect(r.rd).toBeGreaterThan(80);
  });

  it('le RD reste plafonné à 350', () => {
    const r = updateRating({ rating: 1500, rd: 349, volatility: 0.2 }, []);
    expect(r.rd).toBeLessThanOrEqual(350);
  });
});
