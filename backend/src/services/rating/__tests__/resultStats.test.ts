import { computeResultStats } from '../resultStats';

// rows triés par playedAt DÉCROISSANT (plus récent en premier).
const d = (s: string) => new Date(s);

describe('computeResultStats', () => {
  it('bilan V/D + série de victoires en tête', () => {
    const res = computeResultStats([
      { team: 1, winningTeam: 1, playedAt: d('2026-06-05') }, // W (le + récent)
      { team: 1, winningTeam: 1, playedAt: d('2026-06-04') }, // W
      { team: 1, winningTeam: 1, playedAt: d('2026-06-03') }, // W
      { team: 1, winningTeam: 2, playedAt: d('2026-06-02') }, // L
    ]);
    expect(res).toEqual({ wins: 3, losses: 1, streak: 3 });
  });

  it('série de défaites → streak négatif', () => {
    const res = computeResultStats([
      { team: 2, winningTeam: 1, playedAt: d('2026-06-05') }, // L
      { team: 2, winningTeam: 1, playedAt: d('2026-06-04') }, // L
      { team: 2, winningTeam: 2, playedAt: d('2026-06-03') }, // W
    ]);
    expect(res).toEqual({ wins: 1, losses: 2, streak: -2 });
  });

  it('série mixte : streak = suite consécutive de tête seulement', () => {
    const res = computeResultStats([
      { team: 1, winningTeam: 1, playedAt: d('2026-06-05') }, // W
      { team: 1, winningTeam: 2, playedAt: d('2026-06-04') }, // L
      { team: 1, winningTeam: 1, playedAt: d('2026-06-03') }, // W
    ]);
    expect(res).toEqual({ wins: 2, losses: 1, streak: 1 });
  });

  it('ignore les matchs non décidés (winningTeam null)', () => {
    const res = computeResultStats([
      { team: 1, winningTeam: null, playedAt: d('2026-06-05') }, // en attente → ignoré
      { team: 1, winningTeam: 1, playedAt: d('2026-06-04') },    // W
      { team: 1, winningTeam: 1, playedAt: d('2026-06-03') },    // W
    ]);
    expect(res).toEqual({ wins: 2, losses: 0, streak: 2 });
  });

  it('aucun match décidé → 0/0/0', () => {
    expect(computeResultStats([])).toEqual({ wins: 0, losses: 0, streak: 0 });
    expect(computeResultStats([{ team: 1, winningTeam: null, playedAt: d('2026-06-05') }]))
      .toEqual({ wins: 0, losses: 0, streak: 0 });
  });
});
