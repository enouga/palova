import { splitHomeAgenda, startsInLabel, sortMatchesForHome, ratingToLevel, agendaItemHeading, agendaWhenLabel, agendaDateParts, agendaKindIcon } from '@/lib/monPalova';
import { buildAgendaList } from '@/lib/calendar';
import { MyReservation, NationalOpenMatch } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';

const NOW = new Date('2026-07-22T12:00:00.000Z');

function res(id: string, startIso: string, slug = 'padel-arena'): MyReservation {
  const end = new Date(new Date(startIso).getTime() + 3600e3).toISOString();
  return {
    id, startTime: startIso, endTime: end, status: 'CONFIRMED', totalPrice: '25',
    resource: { id: `c-${id}`, name: `Court ${id}`, club: { name: 'Padel Arena', slug, timezone: 'Europe/Paris' } },
    capacity: 4, participants: [],
  };
}

describe('splitHomeAgenda', () => {
  it('hero = 1re entrée à venir, next = les 3 suivantes (jamais de doublon)', () => {
    const list = buildAgendaList(
      [res('1', '2026-07-23T10:00:00.000Z'), res('2', '2026-07-24T10:00:00.000Z'),
       res('3', '2026-07-25T10:00:00.000Z'), res('4', '2026-07-26T10:00:00.000Z'),
       res('5', '2026-07-27T10:00:00.000Z')],
      [], [], [], NOW,
    );
    const { hero, next } = splitHomeAgenda(list);
    expect(hero!.id).toBe('1');
    expect(next.map((i) => i.id)).toEqual(['2', '3', '4']);
  });

  it('exclut le passé ; agenda vide → hero null, next []', () => {
    const list = buildAgendaList([res('old', '2026-07-01T10:00:00.000Z')], [], [], [], NOW);
    expect(splitHomeAgenda(list)).toEqual({ hero: null, next: [] });
  });
});

describe('startsInLabel', () => {
  it('« dans X min » sous 1 h, « dans X h » sous 48 h, « J-x » au-delà, null si commencé', () => {
    expect(startsInLabel('2026-07-22T12:30:00.000Z', NOW)).toBe('dans 30 min');
    expect(startsInLabel('2026-07-23T10:00:00.000Z', NOW)).toBe('dans 22 h');
    expect(startsInLabel('2026-07-26T12:00:00.000Z', NOW)).toBe('J-4');
    expect(startsInLabel('2026-07-22T11:00:00.000Z', NOW)).toBeNull();
  });
});

describe('sortMatchesForHome', () => {
  const m = (id: string, slug: string) => ({ id, club: { slug } } as NationalOpenMatch);
  it('mes clubs d\'abord (ordre du flux conservé), cap 6', () => {
    const out = sortMatchesForHome(
      [m('a', 'x'), m('b', 'mine'), m('c', 'y'), m('d', 'mine'), m('e', 'z'), m('f', 'x'), m('g', 'y')],
      new Set(['mine']),
    );
    expect(out.map((x) => x.id)).toEqual(['b', 'd', 'a', 'c', 'e', 'f']);
  });
});

describe('ratingToLevel', () => {
  it('mappe MyRating → UserLevel ; null si pas de niveau', () => {
    expect(ratingToLevel({ calibrated: true, level: 6, tier: 'Confirmé', isProvisional: false, reliability: 93, matchesPlayed: 17 }))
      .toEqual({ level: 6, tier: 'Confirmé', isProvisional: false, reliability: 93 });
    expect(ratingToLevel({ calibrated: false, level: null, tier: '—', isProvisional: true, reliability: 0, matchesPlayed: 0 })).toBeNull();
    expect(ratingToLevel(null)).toBeNull();
  });
});

describe('agendaItemHeading / agendaWhenLabel', () => {
  it('titre par kind + horaire au fuseau du club de l\'entrée', () => {
    const [item] = buildAgendaList([res('1', '2026-07-23T16:00:00.000Z')], [], [], [], NOW);
    expect(agendaItemHeading(item).title).toBe('Court 1');
    expect(agendaItemHeading(item).href).toBe(clubUrl('padel-arena', '/me/reservations'));
    expect(agendaWhenLabel(item)).toMatch(/jeu\. 23 juil\. · 18h00/); // 16h UTC = 18h Paris
  });
});

describe('agendaDateParts', () => {
  it('jour / mois (sans point) / jour+heure, au fuseau du club (16h UTC = 18h Paris)', () => {
    const [item] = buildAgendaList([res('1', '2026-07-23T16:00:00.000Z')], [], [], [], NOW);
    expect(agendaDateParts(item)).toEqual({ day: '23', month: 'juil', weekdayTime: 'jeu. · 18h00' });
  });
});

describe('agendaKindIcon', () => {
  it('mappe chaque kind sur une icône', () => {
    expect(agendaKindIcon('reservation')).toBe('calendar');
    expect(agendaKindIcon('tournament')).toBe('trophy');
    expect(agendaKindIcon('event')).toBe('bolt');
    expect(agendaKindIcon('lesson')).toBe('racket');
  });
});
