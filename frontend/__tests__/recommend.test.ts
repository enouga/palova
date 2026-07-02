import { recommendMatches, rangeCenter } from '@/lib/recommend';
import type { OpenMatch } from '@/lib/api';

const NOW = new Date('2026-06-20T10:00:00Z');
const future = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();
const past = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function m(over: Partial<OpenMatch> & { id: string }): OpenMatch {
  return {
    resourceName: 'Court 1', startTime: future(2), endTime: future(3),
    maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
    players: [], targetLevelMin: null, targetLevelMax: null,
    lastMessageAt: null, unreadCount: 0, ...over,
  };
}

describe('rangeCenter', () => {
  it('moyenne des deux bornes', () => expect(rangeCenter(4, 6)).toBe(5));
  it('borne unique', () => { expect(rangeCenter(4, null)).toBe(4); expect(rangeCenter(null, 6)).toBe(6); });
  it('aucune borne → null', () => expect(rangeCenter(null, null)).toBeNull());
});

describe('recommendMatches', () => {
  it('niveau inconnu → []', () => {
    expect(recommendMatches([m({ id: 'a' })], null, NOW)).toEqual([]);
  });

  it('exclut complète, passée, déjà inscrit, hors fourchette', () => {
    const matches = [
      m({ id: 'full', full: true, targetLevelMin: 4, targetLevelMax: 6 }),
      m({ id: 'past', startTime: past(2), endTime: past(1), targetLevelMin: 4, targetLevelMax: 6 }),
      m({ id: 'in', viewerIsParticipant: true, targetLevelMin: 4, targetLevelMax: 6 }),
      m({ id: 'low', targetLevelMin: 1, targetLevelMax: 2 }),
      m({ id: 'ok', targetLevelMin: 4, targetLevelMax: 6 }),
    ];
    expect(recommendMatches(matches, 5, NOW).map((x) => x.id)).toEqual(['ok']);
  });

  it('trie par proximité au centre, « tous niveaux » relégué', () => {
    const matches = [
      m({ id: 'all' }),                                       // tous niveaux → relégué
      m({ id: 'far', targetLevelMin: 3, targetLevelMax: 5 }), // centre 4, dist 1 (inclut 5)
      m({ id: 'near', targetLevelMin: 5, targetLevelMax: 5 }),// centre 5, dist 0
    ];
    expect(recommendMatches(matches, 5, NOW).map((x) => x.id)).toEqual(['near', 'far', 'all']);
  });

  it('à distance égale, la plus tôt d’abord', () => {
    const matches = [
      m({ id: 'late', startTime: future(5), endTime: future(6), targetLevelMin: 5, targetLevelMax: 5 }),
      m({ id: 'soon', startTime: future(1), endTime: future(2), targetLevelMin: 5, targetLevelMax: 5 }),
    ];
    expect(recommendMatches(matches, 5, NOW).map((x) => x.id)).toEqual(['soon', 'late']);
  });
});
