import { relativeDayLabel, playedTogetherLine, suggestionReason, dedupFavorites, friendsAnchor, agendaWhenLabel } from '@/lib/social';
import type { Friend } from '@/lib/api';

const NOW = new Date('2026-07-14T10:00:00'); // mardi

describe('relativeDayLabel', () => {
  it('aujourd\'hui / hier', () => {
    expect(relativeDayLabel('2026-07-14T08:00:00', NOW)).toBe("aujourd'hui");
    expect(relativeDayLabel('2026-07-13T22:00:00', NOW)).toBe('hier');
  });
  it('moins de 7 jours → jour de la semaine', () => {
    expect(relativeDayLabel('2026-07-11T10:00:00', NOW)).toBe('samedi');
  });
  it('semaines puis mois', () => {
    expect(relativeDayLabel('2026-06-30T10:00:00', NOW)).toBe('il y a 2 sem.');
    expect(relativeDayLabel('2026-05-01T10:00:00', NOW)).toBe('il y a 2 mois');
  });
});

describe('playedTogetherLine', () => {
  it('null sans partie commune ou sans horloge', () => {
    expect(playedTogetherLine({ playedTogetherCount: 0, lastPlayedTogetherAt: null }, NOW)).toBeNull();
    expect(playedTogetherLine({ playedTogetherCount: 3, lastPlayedTogetherAt: '2026-07-11T10:00:00' }, null)).toBeNull();
  });
  it('singulier / pluriel', () => {
    expect(playedTogetherLine({ playedTogetherCount: 1, lastPlayedTogetherAt: '2026-07-13T10:00:00' }, NOW)).toBe('1 partie ensemble · hier');
    expect(playedTogetherLine({ playedTogetherCount: 12, lastPlayedTogetherAt: '2026-07-11T10:00:00' }, NOW)).toBe('12 parties ensemble · samedi');
  });
});

describe('suggestionReason', () => {
  it('avec et sans horloge', () => {
    expect(suggestionReason('2026-07-11T10:00:00', NOW)).toBe('Vous avez joué ensemble samedi');
    expect(suggestionReason('2026-07-11T10:00:00', null)).toBe('Vous avez joué ensemble récemment');
  });
});

describe('dedupFavorites', () => {
  const f = (id: string): Friend => ({ id, firstName: id, lastName: 'X', avatarUrl: null, mutual: false });
  it('retire les amis confirmés des favoris', () => {
    expect(dedupFavorites([f('a'), f('b')], [f('b')]).map((x) => x.id)).toEqual(['a']);
  });
});

describe('friendsAnchor', () => {
  it('demandes / followers / le reste', () => {
    expect(friendsAnchor('demandes')).toBe('demandes');
    expect(friendsAnchor('followers')).toBe('followers');
    expect(friendsAnchor('amis')).toBeNull();
    expect(friendsAnchor(null)).toBeNull();
  });
});

describe('agendaWhenLabel', () => {
  it('jour + heure au fuseau du club', () => {
    // 18h30 heure de Paris en été = 16:30 UTC
    expect(agendaWhenLabel('2026-07-18T16:30:00Z', 'Europe/Paris')).toBe('sam. 18 · 18h30');
  });
});
