import { activePosters, announcementExpired, offerIsActive, pickUpcomingSlots, posterLayout, tournamentPlacesLabel, todayISO } from '../lib/clubhouse';
import { Announcement, ClubAvailability, Tournament } from '../lib/api';

const slot = (startTime: string, available = true) =>
  ({ startTime, endTime: startTime, available, price: '25', offPeak: false });
const court = (id: string, name: string, slots: ReturnType<typeof slot>[]) =>
  ({ resource: { id, name }, slots }) as unknown as ClubAvailability;
const NOW = new Date('2026-06-10T12:00:00Z');

describe('pickUpcomingSlots', () => {
  it('garde les créneaux libres postérieurs à maintenant, triés, max 3, tous terrains', () => {
    const avail = [
      court('c1', 'Terrain 1', [slot('2026-06-10T10:00:00Z'), slot('2026-06-10T15:00:00Z'), slot('2026-06-10T18:00:00Z')]),
      court('c2', 'Terrain 2', [slot('2026-06-10T13:00:00Z'), slot('2026-06-10T14:00:00Z', false), slot('2026-06-10T19:00:00Z')]),
    ];
    const out = pickUpcomingSlots(avail, NOW);
    expect(out.map((s) => [s.resourceName, s.slot.startTime])).toEqual([
      ['Terrain 2', '2026-06-10T13:00:00Z'],
      ['Terrain 1', '2026-06-10T15:00:00Z'],
      ['Terrain 1', '2026-06-10T18:00:00Z'],
    ]);
  });

  it('renvoie [] quand plus rien de libre', () => {
    expect(pickUpcomingSlots([court('c1', 'T1', [slot('2026-06-10T10:00:00Z')])], NOW)).toEqual([]);
  });
});

describe('tournamentPlacesLabel', () => {
  const t = (maxTeams: number | null, confirmedCount: number) => ({ maxTeams, confirmedCount }) as Tournament;
  it('urgence quand ≤ 5 places restantes', () => {
    expect(tournamentPlacesLabel(t(16, 13))).toEqual({ text: 'Plus que 3 places', urgent: true });
    expect(tournamentPlacesLabel(t(16, 15))).toEqual({ text: 'Plus que 1 place', urgent: true });
  });
  it('complet → liste d attente', () => {
    expect(tournamentPlacesLabel(t(16, 16))).toEqual({ text: "Complet · liste d'attente possible", urgent: false });
    expect(tournamentPlacesLabel(t(16, 20))).toEqual({ text: "Complet · liste d'attente possible", urgent: false });
  });
  it('pas d urgence sinon', () => {
    expect(tournamentPlacesLabel(t(16, 4))).toEqual({ text: '12 places restantes', urgent: false });
    expect(tournamentPlacesLabel(t(null, 7))).toEqual({ text: '7 binômes inscrits', urgent: false });
    expect(tournamentPlacesLabel(t(null, 1))).toEqual({ text: '1 binôme inscrit', urgent: false });
  });
});

describe('offerIsActive', () => {
  it('texte présent + pas de date limite → active', () => {
    expect(offerIsActive({ offerText: '-10 %', offerUntil: null }, NOW)).toBe(true);
  });
  it('date limite future → active, dépassée → inactive', () => {
    expect(offerIsActive({ offerText: '-10 %', offerUntil: '2026-06-30T23:59:59.999Z' }, NOW)).toBe(true);
    expect(offerIsActive({ offerText: '-10 %', offerUntil: '2026-06-01T23:59:59.999Z' }, NOW)).toBe(false);
  });
  it('sans texte → inactive même avec une date', () => {
    expect(offerIsActive({ offerText: null, offerUntil: '2026-06-30T23:59:59.999Z' }, NOW)).toBe(false);
  });
});

describe('todayISO', () => {
  it('formate la date injectée en YYYY-MM-DD (UTC)', () => {
    expect(todayISO(new Date('2026-06-10T15:30:00Z'))).toBe('2026-06-10');
  });
});

const ann = (over: Partial<Announcement>): Announcement => ({
  id: 'a', title: 't', body: 'b', linkUrl: null, imageUrl: null, isPublished: true,
  pinned: false, kind: 'INFO', validUntil: null, createdAt: '', updatedAt: '', ...over,
});

describe('activePosters', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  it('garde les annonces avec image non expirées, exclut le hero, plafond 5', () => {
    const list = [
      ann({ id: 'hero', imageUrl: '/u/h.jpg', pinned: true }),
      ann({ id: 'ok', imageUrl: '/u/1.jpg' }),
      ann({ id: 'expired', imageUrl: '/u/2.jpg', validUntil: '2026-07-01T23:59:59.999Z' }),
      ann({ id: 'noimg' }),
      ...[3, 4, 5, 6, 7, 8].map((i) => ann({ id: `p${i}`, imageUrl: `/u/${i}.jpg` })),
    ];
    const out = activePosters(list, now, 'hero');
    expect(out.map((a) => a.id)).toEqual(['ok', 'p3', 'p4', 'p5', 'p6']);
  });
});

describe('posterLayout', () => {
  it('single / duo / bento', () => {
    expect(posterLayout(1)).toBe('single');
    expect(posterLayout(2)).toBe('duo');
    expect(posterLayout(3)).toBe('bento');
    expect(posterLayout(5)).toBe('bento');
  });
});

describe('announcementExpired', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  it('null = jamais expirée ; date passée = expirée', () => {
    expect(announcementExpired({ validUntil: null }, now)).toBe(false);
    expect(announcementExpired({ validUntil: '2026-07-01T23:59:59.999Z' }, now)).toBe(true);
    expect(announcementExpired({ validUntil: '2026-08-01T23:59:59.999Z' }, now)).toBe(false);
  });
});
