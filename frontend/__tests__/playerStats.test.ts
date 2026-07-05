import { computePlayerStats, levelTrend, sparkPoints, StatsMatch } from '@/lib/playerStats';

const players = [
  { userId: 'me', team: 1, firstName: 'Moi', lastName: 'M', isMe: true },
  { userId: 'p1', team: 1, firstName: 'Ines', lastName: 'Andre', isMe: false },
  { userId: 'o1', team: 2, firstName: 'Clement', lastName: 'Arnaud', isMe: false },
  { userId: 'o2', team: 2, firstName: 'Karim', lastName: 'Benali', isMe: false },
];

const m = (over: Partial<StatsMatch> = {}): StatsMatch => ({
  status: 'CONFIRMED',
  sets: [[6, 4], [6, 3]],
  playedAt: '2026-06-01T10:00:00Z',
  winningTeam: 1,
  myTeam: 1,
  players,
  sport: { name: 'Padel' },
  ...over,
});

describe('computePlayerStats', () => {
  it('agrège victoires, défaites, sets, jeux et forme (ordre chronologique)', () => {
    const s = computePlayerStats([
      // Défaite la plus récente (fournie en premier pour vérifier le tri par date)
      m({ playedAt: '2026-06-10T10:00:00Z', winningTeam: 2, sets: [[4, 6], [3, 6]] }),
      m({ playedAt: '2026-06-01T10:00:00Z' }),                       // victoire (éq.1) 6-4 / 6-3
      m({ playedAt: '2026-06-05T10:00:00Z', myTeam: 2, winningTeam: 2, sets: [[3, 6], [4, 6]] }), // victoire côté éq.2
    ]);
    expect(s.played).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(67);
    expect(s.form).toEqual(['W', 'W', 'L']);
    expect(s.currentStreak).toBe(-1);
    expect(s.bestWinStreak).toBe(2);
    expect(s.setsWon).toBe(4);
    expect(s.setsLost).toBe(2);
    expect(s.gamesWon).toBe(31);
    expect(s.gamesLost).toBe(26);
  });

  it('ignore les matchs non confirmés et filtre par sport', () => {
    const s = computePlayerStats([
      m(),
      m({ playedAt: '2026-06-02T10:00:00Z', status: 'PENDING' }),
      m({ playedAt: '2026-06-03T10:00:00Z', status: 'DISPUTED' }),
      m({ playedAt: '2026-06-04T10:00:00Z', sport: { name: 'Tennis' } }),
    ], 'Padel');
    expect(s.played).toBe(1);
  });

  it('série en cours positive et forme limitée aux 5 derniers', () => {
    const dates = ['01', '02', '03', '04', '05', '06', '07'];
    const s = computePlayerStats(dates.map((d, i) =>
      m({ playedAt: `2026-06-${d}T10:00:00Z`, winningTeam: i < 2 ? 2 : 1 }))); // L L W W W W W
    expect(s.currentStreak).toBe(5);
    expect(s.bestWinStreak).toBe(5);
    expect(s.form).toEqual(['W', 'W', 'W', 'W', 'W']);
  });

  it('partenaire favori = le plus fréquent, départagé par les victoires', () => {
    const p2 = [
      players[0],
      { userId: 'p2', team: 1, firstName: 'Adam', lastName: 'Bernard', isMe: false },
      players[2], players[3],
    ];
    const s = computePlayerStats([
      m({ playedAt: '2026-06-01T10:00:00Z' }),                    // avec p1, victoire
      m({ playedAt: '2026-06-02T10:00:00Z', winningTeam: 2 }),    // avec p1, défaite
      m({ playedAt: '2026-06-03T10:00:00Z', players: p2 }),       // avec p2, victoire
    ]);
    expect(s.favoritePartner).toMatchObject({ userId: 'p1', played: 2, wins: 1 });
  });

  it('aucun match décidé → stats vides', () => {
    const s = computePlayerStats([m({ winningTeam: null })]);
    expect(s.played).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.form).toEqual([]);
    expect(s.favoritePartner).toBeNull();
  });
});

describe('levelTrend', () => {
  it('delta vs le dernier point antérieur à la fenêtre de 30 j', () => {
    expect(levelTrend([
      { playedAt: '2026-05-01T10:00:00Z', level: 4.0 },
      { playedAt: '2026-05-11T10:00:00Z', level: 4.3 },
      { playedAt: '2026-06-15T10:00:00Z', level: 4.6 },
    ])).toBe(0.3);
  });

  it('historique entièrement dans la fenêtre → delta depuis le premier point', () => {
    expect(levelTrend([
      { playedAt: '2026-06-01T10:00:00Z', level: 4.0 },
      { playedAt: '2026-06-06T10:00:00Z', level: 4.6 },
    ])).toBe(0.6);
  });

  it('moins de 2 points → null', () => {
    expect(levelTrend([{ playedAt: '2026-06-01T10:00:00Z', level: 4.0 }])).toBeNull();
    expect(levelTrend([])).toBeNull();
  });
});

describe('sparkPoints', () => {
  it('renvoie les n derniers points en ordre chronologique', () => {
    const pts = Array.from({ length: 15 }, (_, i) => ({
      playedAt: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00Z`, level: i,
    }));
    const out = sparkPoints(pts.slice().reverse(), 12);
    expect(out).toHaveLength(12);
    expect(out[0].level).toBe(3);
    expect(out[11].level).toBe(14);
  });
});
