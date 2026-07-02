import { matchCardStateHash, MatchCardState } from '../matchCardState';

const base = (): MatchCardState => ({
  players: [
    { userId: 'u1', team: 1, slot: 0, avatarUrl: null, level: { level: 6.1 } },
    { userId: 'u2', team: 2, slot: 0, avatarUrl: '/uploads/avatars/u2.jpg', level: null },
  ],
  spotsLeft: 2,
  targetLevelMin: 6,
  targetLevelMax: 7,
  startTime: '2026-07-04T16:00:00.000Z',
  endTime: '2026-07-04T17:30:00.000Z',
  resourceName: 'Court 2',
  accentColor: '#0f6bff',
  logoUrl: null,
});

describe('matchCardStateHash', () => {
  it('est stable : même état → même hash, forme 12 hex', () => {
    expect(matchCardStateHash(base())).toBe(matchCardStateHash(base()));
    expect(matchCardStateHash(base())).toMatch(/^[0-9a-f]{12}$/);
  });

  it('change quand un joueur rejoint', () => {
    const joined = base();
    joined.players.push({ userId: 'u3', team: 1, slot: 1, avatarUrl: null, level: null });
    joined.spotsLeft = 1;
    expect(matchCardStateHash(joined)).not.toBe(matchCardStateHash(base()));
  });

  it("change quand un joueur change d'équipe ou de place", () => {
    const moved = base();
    moved.players[0] = { ...moved.players[0], team: 2, slot: 1 };
    expect(matchCardStateHash(moved)).not.toBe(matchCardStateHash(base()));
  });

  it('change quand la fourchette de niveau change', () => {
    expect(matchCardStateHash({ ...base(), targetLevelMin: null, targetLevelMax: null }))
      .not.toBe(matchCardStateHash(base()));
  });

  it('change avec la couleur ou le logo du club (re-branding)', () => {
    expect(matchCardStateHash({ ...base(), accentColor: '#ff7a4d' })).not.toBe(matchCardStateHash(base()));
    expect(matchCardStateHash({ ...base(), logoUrl: '/uploads/logos/x.png' })).not.toBe(matchCardStateHash(base()));
  });
});
