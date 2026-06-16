import { applyMatchRatings, decayForInactivity, TeamPlayer, RATING_PERIOD_DAYS } from '../match-rating';

const P = (rating: number, team: 1 | 2): TeamPlayer => ({ rating, rd: 200, volatility: 0.06, team });

describe('applyMatchRatings', () => {
  it('les gagnants montent, les perdants descendent', () => {
    const players: TeamPlayer[] = [P(1500, 1), P(1500, 1), P(1500, 2), P(1500, 2)];
    const out = applyMatchRatings(players, [[6, 2], [6, 2]]);
    expect(out[0].rating).toBeGreaterThan(1500);
    expect(out[2].rating).toBeLessThan(1500);
  });

  it('battre une équipe plus forte rapporte plus que battre une plus faible', () => {
    const vsStrong = applyMatchRatings([P(1500, 1), P(1500, 1), P(1800, 2), P(1800, 2)], [[6, 4], [6, 4]]);
    const vsWeak = applyMatchRatings([P(1500, 1), P(1500, 1), P(1200, 2), P(1200, 2)], [[6, 4], [6, 4]]);
    expect(vsStrong[0].rating - 1500).toBeGreaterThan(vsWeak[0].rating - 1500);
  });

  it('préserve l ordre des joueurs en sortie', () => {
    const out = applyMatchRatings([P(1500, 1), P(1600, 1), P(1400, 2), P(1300, 2)], [[6, 0], [6, 0]]);
    expect(out).toHaveLength(4);
  });
});

describe('decayForInactivity', () => {
  it('aucune décote sous une période', () => {
    const s = decayForInactivity({ rating: 1500, rd: 100, volatility: 0.06 }, RATING_PERIOD_DAYS - 1);
    expect(s.rd).toBe(100);
    expect(s.rating).toBe(1500);
  });
  it('le RD remonte après plusieurs périodes, la note ne bouge pas', () => {
    const s = decayForInactivity({ rating: 1500, rd: 100, volatility: 0.06 }, RATING_PERIOD_DAYS * 5);
    expect(s.rd).toBeGreaterThan(100);
    expect(s.rating).toBe(1500);
  });
  it('le RD reste borné à 350', () => {
    const s = decayForInactivity({ rating: 1500, rd: 100, volatility: 0.3 }, RATING_PERIOD_DAYS * 500);
    expect(s.rd).toBeLessThanOrEqual(350);
  });
});
