import { replayRatings, ReplayBaseline, ReplayMatchInput } from '../recompute';
import { levelToRating, SKIP_DEFAULT_LEVEL } from '../level';

const d = (s: string) => new Date(s);

const m1: ReplayMatchInput = {
  matchId: 'm1', playedAt: d('2026-06-10T10:00:00Z'), sets: [[6, 2], [6, 2]],
  players: [
    { userId: 'u1', team: 1 }, { userId: 'u2', team: 1 },
    { userId: 'u3', team: 2 }, { userId: 'u4', team: 2 },
  ],
};
const m2: ReplayMatchInput = {
  matchId: 'm2', playedAt: d('2026-06-12T10:00:00Z'), sets: [[6, 3], [6, 4]],
  players: [
    { userId: 'u1', team: 1 }, { userId: 'u3', team: 1 },
    { userId: 'u2', team: 2 }, { userId: 'u4', team: 2 },
  ],
};
const baselines: ReplayBaseline[] = ['u1', 'u2', 'u3', 'u4'].map((userId) => ({ userId, initialSelfLevel: null }));

describe('replayRatings', () => {
  it('un seul match : le gagnant monte au-dessus du perdant, matchesPlayed=1', () => {
    const out = replayRatings(baselines, [m1]);
    const byId = Object.fromEntries(out.players.map((p) => [p.userId, p]));
    expect(byId.u1.displayLevel).toBeGreaterThan(byId.u3.displayLevel);
    expect(byId.u1.matchesPlayed).toBe(1);
    expect(byId.u1.lastMatchAt).toEqual(m1.playedAt);
    expect(out.matchPlayers.filter((mp) => mp.matchId === 'm1')).toHaveLength(4);
  });

  it('est déterministe et indépendant de l ordre du tableau (tri par playedAt)', () => {
    const a = replayRatings(baselines, [m1, m2]);
    const b = replayRatings(baselines, [m2, m1]);
    expect(b.players).toEqual(a.players);
  });

  it('retirer un match = « comme s il n avait pas eu lieu »', () => {
    const withBoth = replayRatings(baselines, [m1, m2]);
    const withoutM2 = replayRatings(baselines, [m1]);
    const a = Object.fromEntries(withBoth.players.map((p) => [p.userId, p.displayLevel]));
    const b = Object.fromEntries(withoutM2.players.map((p) => [p.userId, p.displayLevel]));
    expect(b.u1).not.toEqual(a.u1);
  });

  it('joueur sans match restant : retombe sur sa calibration', () => {
    const withCal: ReplayBaseline[] = [{ userId: 'solo', initialSelfLevel: 5 }];
    const out = replayRatings(withCal, []);
    expect(out.players).toHaveLength(1);
    expect(out.players[0].rating).toBeCloseTo(levelToRating(5), 6);
    expect(out.players[0].matchesPlayed).toBe(0);
    expect(out.players[0].lastMatchAt).toBeNull();
    expect(out.players[0].isProvisional).toBe(true);
  });

  it('initialSelfLevel null => départ neutre (SKIP_DEFAULT_LEVEL)', () => {
    const out = replayRatings([{ userId: 'x', initialSelfLevel: null }], []);
    expect(out.players[0].rating).toBeCloseTo(levelToRating(SKIP_DEFAULT_LEVEL), 6);
  });

  it('lève si un match référence un joueur absent des baselines', () => {
    const orphan: ReplayMatchInput = {
      matchId: 'mX', playedAt: d('2026-06-10T10:00:00Z'), sets: [[6, 0]],
      players: [
        { userId: 'a', team: 1 }, { userId: 'b', team: 1 },
        { userId: 'c', team: 2 }, { userId: 'd', team: 2 },
      ],
    };
    expect(() => replayRatings([{ userId: 'a', initialSelfLevel: null }], [orphan]))
      .toThrow(/REPLAY_MISSING_BASELINE/);
  });
});
