import {
  dayKeyInTz,
  todayKey,
  monthGrid,
  addMonths,
  monthLabel,
  enumerateDayKeys,
  buildCalendarEntries,
  entriesByDay,
  buildAgendaList,
  agendaKindMeta,
  agendaItemClubSlug,
  CalendarEntry,
  addDaysKey,
  frLongLabel,
  frWeekday,
} from '@/lib/calendar';
import { MyReservation, MyTournamentRegistration, MyEventRegistration, MyLessonEnrollment } from '@/lib/api';
import { ACCENTS } from '@/lib/theme';

function makeReservation(over: Partial<MyReservation> = {}): MyReservation {
  return {
    id: 'res-1',
    startTime: '2026-06-12T16:00:00.000Z',
    endTime: '2026-06-12T17:00:00.000Z',
    status: 'CONFIRMED',
    totalPrice: '25.00',
    resource: { id: 'court-1', name: 'Court 1', club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris' } },
    capacity: 4,
    participants: [],
    ...over,
  };
}

function makeRegistration(over: {
  id?: string;
  status?: MyTournamentRegistration['status'];
  startTime?: string;
  endTime?: string | null;
  tournamentStatus?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  timezone?: string;
} = {}): MyTournamentRegistration {
  return {
    id: over.id ?? 'reg-1',
    status: over.status ?? 'CONFIRMED',
    createdAt: '2026-06-01T10:00:00.000Z',
    captain: { id: 'u1', firstName: 'Eric', lastName: 'N', email: 'e@x.fr', phone: null },
    partner: { id: 'u2', firstName: 'Marc', lastName: 'D', email: 'm@x.fr', phone: null },
    captainLicense: null,
    partnerLicense: null,
    tournament: {
      id: 't-1',
      clubId: 'club-demo',
      clubSportId: 'cs-1',
      name: 'P100 Messieurs',
      category: 'P100',
      gender: 'MEN',
      openToWomen: false,
      description: null,
      contactInfo: null,
      startTime: over.startTime ?? '2026-06-13T07:00:00.000Z',
      endTime: over.endTime === undefined ? '2026-06-14T16:00:00.000Z' : over.endTime,
      registrationDeadline: '2026-06-11T22:00:00.000Z',
      maxTeams: 16,
      entryFee: null,
      status: over.tournamentStatus ?? 'PUBLISHED',
      confirmedCount: 4,
      waitlistCount: 0,
      club: { slug: 'padel-arena', name: 'Padel Arena', timezone: over.timezone ?? 'Europe/Paris' },
    },
  };
}

function makeEventReg(over: {
  id?: string;
  status?: MyEventRegistration['status'];
  startTime?: string;
  endTime?: string | null;
  eventStatus?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  timezone?: string;
} = {}): MyEventRegistration {
  return {
    id: over.id ?? 'evt-1',
    status: over.status ?? 'CONFIRMED',
    event: {
      id: 'ev-1',
      clubId: 'club-demo',
      name: 'Mêlée du vendredi',
      kind: 'MELEE',
      description: null,
      startTime: over.startTime ?? '2026-06-13T17:00:00.000Z',
      endTime: over.endTime === undefined ? '2026-06-13T20:00:00.000Z' : over.endTime,
      registrationDeadline: '2026-06-13T12:00:00.000Z',
      capacity: 16,
      price: null,
      memberOnly: false,
      status: over.eventStatus ?? 'PUBLISHED',
      confirmedCount: 6,
      waitlistCount: 0,
      club: { slug: 'padel-arena', name: 'Padel Arena', timezone: over.timezone ?? 'Europe/Paris' },
    },
  };
}

function makeLessonEnrollment(over: {
  enrollmentId?: string;
  status?: string;
  lessonId?: string;
  startTime?: string;
  endTime?: string;
  coachName?: string;
  resourceName?: string;
  timezone?: string;
  clubSlug?: string;
} = {}): MyLessonEnrollment {
  return {
    enrollmentId: over.enrollmentId ?? 'enroll-1',
    status: over.status ?? 'CONFIRMED',
    lesson: {
      id: over.lessonId ?? 'lesson-1',
      clubId: 'club-demo',
      lessonKind: 'COLLECTIVE',
      allowSelfEnroll: true,
      capacity: 4,
      confirmedCount: 2,
      waitlistCount: 0,
      seriesId: null,
      coach: { name: over.coachName ?? 'Coach X', photoUrl: null },
      reservation: {
        startTime: over.startTime ?? '2026-06-15T17:00:00.000Z',
        endTime: over.endTime ?? '2026-06-15T18:00:00.000Z',
        resource: { name: over.resourceName ?? 'Court 1' },
      },
      club: { slug: over.clubSlug ?? 'padel-arena', name: 'Padel Arena', timezone: over.timezone ?? 'Europe/Paris' },
    },
  };
}

const NOW = new Date('2026-06-10T12:00:00.000Z');

describe('dayKeyInTz', () => {
  it('convertit un instant UTC dans le fuseau du club', () => {
    // 23h30 UTC = 01h30 le lendemain à Paris (été, UTC+2)
    expect(dayKeyInTz('2026-06-10T23:30:00.000Z', 'Europe/Paris')).toBe('2026-06-11');
    expect(dayKeyInTz('2026-06-10T23:30:00.000Z', 'UTC')).toBe('2026-06-10');
  });
});

describe('monthGrid', () => {
  it('juin 2026 commence un lundi : pas de jours du mois précédent', () => {
    const grid = monthGrid(2026, 6);
    expect(grid[0][0]).toEqual({ key: '2026-06-01', day: 1, inMonth: true });
    expect(grid.length).toBe(5); // 30 jours à partir d'un lundi = 5 semaines
    expect(grid[4][6]).toEqual({ key: '2026-07-05', day: 5, inMonth: false });
  });

  it('novembre 2026 commence un dimanche : 6 jours de lead du mois précédent', () => {
    const grid = monthGrid(2026, 11);
    expect(grid[0][0]).toEqual({ key: '2026-10-26', day: 26, inMonth: false });
    expect(grid[0][6]).toEqual({ key: '2026-11-01', day: 1, inMonth: true });
  });

  it('chaque semaine compte exactement 7 cellules', () => {
    for (const week of monthGrid(2026, 2)) expect(week.length).toBe(7);
  });
});

describe('addMonths', () => {
  it('gère les bornes d année dans les deux sens', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 6, 1)).toEqual({ year: 2026, month: 7 });
  });
});

describe('monthLabel', () => {
  it('libellé français du mois', () => {
    expect(monthLabel(2026, 6).toLowerCase()).toContain('juin');
    expect(monthLabel(2026, 6)).toContain('2026');
  });
});

describe('enumerateDayKeys', () => {
  it('énumère les jours inclusivement', () => {
    expect(enumerateDayKeys('2026-06-13', '2026-06-15')).toEqual(['2026-06-13', '2026-06-14', '2026-06-15']);
    expect(enumerateDayKeys('2026-06-13', '2026-06-13')).toEqual(['2026-06-13']);
  });

  it('traverse le changement d heure de mars sans sauter de jour', () => {
    // Passage à l'heure d'été en Europe : dernier dimanche de mars 2026 = le 29
    expect(enumerateDayKeys('2026-03-28', '2026-03-30')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });
});

describe('buildCalendarEntries', () => {
  it('masque les réservations annulées et les inscriptions/tournois annulés', () => {
    const entries = buildCalendarEntries(
      [makeReservation(), makeReservation({ id: 'res-2', status: 'CANCELLED' })],
      [
        makeRegistration(),
        makeRegistration({ id: 'reg-2', status: 'CANCELLED' }),
        makeRegistration({ id: 'reg-3', tournamentStatus: 'CANCELLED' }),
      ],
      [],
      [],
      NOW,
    );
    expect(entries.map((e) => e.id).sort()).toEqual(['reg-1', 'res-1']);
  });

  it('place la réservation sur son jour dans le fuseau du club', () => {
    // 22h30 UTC la veille = 00h30 à Paris le 13
    const entries = buildCalendarEntries(
      [makeReservation({ startTime: '2026-06-12T22:30:00.000Z', endTime: '2026-06-12T23:30:00.000Z' })],
      [], [], [], NOW,
    );
    expect(entries[0]).toMatchObject({ kind: 'reservation', dayKey: '2026-06-13', past: false });
  });

  it('étale un tournoi multi-jours sur toutes ses journées', () => {
    const entries = buildCalendarEntries([], [makeRegistration({
      startTime: '2026-06-13T07:00:00.000Z', endTime: '2026-06-15T16:00:00.000Z',
    })], [], [], NOW);
    expect(entries[0]).toMatchObject({
      kind: 'tournament',
      startKey: '2026-06-13',
      endKey: '2026-06-15',
      dayKeys: ['2026-06-13', '2026-06-14', '2026-06-15'],
    });
  });

  it('un tournoi sans endTime tient sur un seul jour', () => {
    const entries = buildCalendarEntries([], [makeRegistration({ endTime: null })], [], [], NOW);
    expect(entries[0]).toMatchObject({ startKey: '2026-06-13', endKey: '2026-06-13', dayKeys: ['2026-06-13'] });
  });

  it('marque past les entrées terminées avant now', () => {
    const entries = buildCalendarEntries(
      [makeReservation({ startTime: '2026-06-01T16:00:00.000Z', endTime: '2026-06-01T17:00:00.000Z' })],
      [makeRegistration({ startTime: '2026-06-02T07:00:00.000Z', endTime: '2026-06-03T16:00:00.000Z' })],
      [],
      [],
      NOW,
    );
    expect(entries.every((e) => e.past)).toBe(true);
  });

  it('masque les events annulés (inscription OU event sous-jacent)', () => {
    const entries = buildCalendarEntries([], [], [
      makeEventReg(),
      makeEventReg({ id: 'evt-2', status: 'CANCELLED' }),
      makeEventReg({ id: 'evt-3', eventStatus: 'CANCELLED' }),
    ], [], NOW);
    expect(entries.map((e) => e.id)).toEqual(['evt-1']);
  });

  it('place l event sur son jour au fuseau du club (mono-jour si pas d endTime)', () => {
    // 22h30 UTC la veille = 00h30 à Paris le 13
    const entries = buildCalendarEntries([], [], [
      makeEventReg({ startTime: '2026-06-12T22:30:00.000Z', endTime: null }),
    ], [], NOW);
    expect(entries[0]).toMatchObject({ kind: 'event', startKey: '2026-06-13', endKey: '2026-06-13', dayKeys: ['2026-06-13'], past: false });
  });

  it('étale un event multi-jours sur toutes ses journées et marque past si terminé', () => {
    const entries = buildCalendarEntries([], [], [
      makeEventReg({ startTime: '2026-06-01T17:00:00.000Z', endTime: '2026-06-03T20:00:00.000Z' }),
    ], [], NOW);
    expect(entries[0]).toMatchObject({
      kind: 'event', dayKeys: ['2026-06-01', '2026-06-02', '2026-06-03'], past: true,
    });
  });
});

describe('entriesByDay', () => {
  it('indexe le tournoi multi-jours sur chacun de ses jours, tournois avant réservations', () => {
    const entries: CalendarEntry[] = buildCalendarEntries(
      [makeReservation({ startTime: '2026-06-14T08:00:00.000Z', endTime: '2026-06-14T09:00:00.000Z' })],
      [makeRegistration({ startTime: '2026-06-13T07:00:00.000Z', endTime: '2026-06-15T16:00:00.000Z' })],
      [],
      [],
      NOW,
    );
    const byDay = entriesByDay(entries);
    expect(byDay.get('2026-06-13')!.map((e) => e.kind)).toEqual(['tournament']);
    expect(byDay.get('2026-06-14')!.map((e) => e.kind)).toEqual(['tournament', 'reservation']);
    expect(byDay.get('2026-06-15')!.map((e) => e.kind)).toEqual(['tournament']);
    expect(byDay.get('2026-06-12')).toBeUndefined();
  });

  it('ordonne un jour cumulant les 3 types : tournoi, event, réservation', () => {
    const byDay = entriesByDay(buildCalendarEntries(
      [makeReservation({ startTime: '2026-06-14T08:00:00.000Z', endTime: '2026-06-14T09:00:00.000Z' })],
      [makeRegistration({ startTime: '2026-06-13T07:00:00.000Z', endTime: '2026-06-15T16:00:00.000Z' })],
      [makeEventReg({ startTime: '2026-06-14T15:00:00.000Z', endTime: '2026-06-14T18:00:00.000Z' })],
      [],
      NOW,
    ));
    expect(byDay.get('2026-06-14')!.map((e) => e.kind)).toEqual(['tournament', 'event', 'reservation']);
  });

  it('trie les réservations d un même jour par heure de début', () => {
    const byDay = entriesByDay(buildCalendarEntries(
      [
        makeReservation({ id: 'r-soir', startTime: '2026-06-12T18:00:00.000Z', endTime: '2026-06-12T19:00:00.000Z' }),
        makeReservation({ id: 'r-matin', startTime: '2026-06-12T08:00:00.000Z', endTime: '2026-06-12T09:00:00.000Z' }),
      ],
      [], [], [], NOW,
    ));
    expect(byDay.get('2026-06-12')!.map((e) => e.id)).toEqual(['r-matin', 'r-soir']);
  });
});

describe('buildAgendaList', () => {
  it('fusionne les 3 types triés chronologiquement par instant de début', () => {
    const list = buildAgendaList(
      [makeReservation({ id: 'res-1', startTime: '2026-06-14T08:00:00.000Z', endTime: '2026-06-14T09:00:00.000Z' })],
      [makeRegistration({ id: 'reg-1', startTime: '2026-06-13T07:00:00.000Z', endTime: '2026-06-15T16:00:00.000Z' })],
      [makeEventReg({ id: 'evt-1', startTime: '2026-06-13T17:00:00.000Z', endTime: '2026-06-13T20:00:00.000Z' })],
      [],
      NOW,
    );
    expect(list.map((i) => i.id)).toEqual(['reg-1', 'evt-1', 'res-1']);
  });

  it('exclut tout ce qui est annulé (5 chemins)', () => {
    const list = buildAgendaList(
      [makeReservation(), makeReservation({ id: 'res-x', status: 'CANCELLED' })],
      [makeRegistration(), makeRegistration({ id: 'reg-x', status: 'CANCELLED' }), makeRegistration({ id: 'reg-y', tournamentStatus: 'CANCELLED' })],
      [makeEventReg(), makeEventReg({ id: 'evt-x', status: 'CANCELLED' }), makeEventReg({ id: 'evt-y', eventStatus: 'CANCELLED' })],
      [],
      NOW,
    );
    expect(list.map((i) => i.id).sort()).toEqual(['evt-1', 'reg-1', 'res-1']);
  });

  it('calcule past sur la fin (repli sur le début si pas d endTime)', () => {
    const list = buildAgendaList(
      [makeReservation({ id: 'r-past', startTime: '2026-06-01T16:00:00.000Z', endTime: '2026-06-01T17:00:00.000Z' })],
      [],
      [makeEventReg({ id: 'e-future', startTime: '2026-06-20T17:00:00.000Z', endTime: null })],
      [],
      NOW,
    );
    expect(list.find((i) => i.id === 'r-past')!.past).toBe(true);
    expect(list.find((i) => i.id === 'e-future')!.past).toBe(false);
  });

  it('trie par instant réel même quand les fuseaux diffèrent, tie-break stable par id', () => {
    // Même instant de début : l'ordre est déterministe (par id).
    const list = buildAgendaList(
      [],
      [makeRegistration({ id: 'b', startTime: '2026-06-20T10:00:00.000Z', endTime: '2026-06-20T16:00:00.000Z' })],
      [makeEventReg({ id: 'a', startTime: '2026-06-20T10:00:00.000Z', endTime: '2026-06-20T12:00:00.000Z' })],
      [],
      NOW,
    );
    expect(list.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('agendaKindMeta', () => {
  it('associe une couleur ACCENTS et un libellé à chaque type', () => {
    expect(agendaKindMeta('reservation')).toEqual({ color: ACCENTS.blue, label: 'Réservation' });
    expect(agendaKindMeta('tournament')).toEqual({ color: ACCENTS.apricot, label: 'Tournoi' });
    expect(agendaKindMeta('event')).toEqual({ color: ACCENTS.emerald, label: 'Event' });
    expect(agendaKindMeta('lesson')).toEqual({ color: ACCENTS.violet, label: 'Cours' });
  });
});

describe('agendaItemClubSlug', () => {
  it('renvoie le slug du club selon le type d item (les 4 types)', () => {
    const list = buildAgendaList([makeReservation()], [makeRegistration()], [makeEventReg()], [makeLessonEnrollment()], NOW);
    // Les fixtures utilisent toutes le slug 'padel-arena' ; on vérifie chaque branche du switch.
    for (const kind of ['reservation', 'tournament', 'event', 'lesson'] as const) {
      const item = list.find((i) => i.kind === kind)!;
      expect(agendaItemClubSlug(item)).toBe('padel-arena');
    }
  });
});

describe('cours (lessons)', () => {
  it('buildCalendarEntries inclut les cours (single-day)', () => {
    const lessons = [makeLessonEnrollment()];
    const entries = buildCalendarEntries([], [], [], lessons, NOW);
    expect(entries.some((e) => e.kind === 'lesson')).toBe(true);
  });

  it('buildCalendarEntries masque les cours annulés', () => {
    const lessons = [
      makeLessonEnrollment(),
      makeLessonEnrollment({ enrollmentId: 'enroll-2', status: 'CANCELLED' }),
    ];
    const entries = buildCalendarEntries([], [], [], lessons, NOW);
    expect(entries.map((e) => e.id)).toEqual(['enroll-1']);
  });

  it('buildCalendarEntries marque past les cours terminés avant now', () => {
    const past = makeLessonEnrollment({ startTime: '2026-06-01T10:00:00.000Z', endTime: '2026-06-01T11:00:00.000Z' });
    const future = makeLessonEnrollment({ enrollmentId: 'enroll-2', startTime: '2026-06-20T10:00:00.000Z', endTime: '2026-06-20T11:00:00.000Z' });
    const entries = buildCalendarEntries([], [], [], [past, future], NOW);
    expect(entries.find((e) => e.id === 'enroll-1')!.past).toBe(true);
    expect(entries.find((e) => e.id === 'enroll-2')!.past).toBe(false);
  });

  it('buildAgendaList inclut les cours triés chronologiquement', () => {
    const list = buildAgendaList(
      [],
      [],
      [],
      [makeLessonEnrollment({ enrollmentId: 'l1', startTime: '2026-06-15T17:00:00.000Z', endTime: '2026-06-15T18:00:00.000Z' })],
      NOW,
    );
    expect(list.some((i) => i.kind === 'lesson')).toBe(true);
    expect(list.find((i) => i.kind === 'lesson')!.id).toBe('l1');
  });

  it('buildAgendaList exclut les cours annulés', () => {
    const list = buildAgendaList(
      [], [], [],
      [makeLessonEnrollment({ status: 'CANCELLED' })],
      NOW,
    );
    expect(list.filter((i) => i.kind === 'lesson')).toHaveLength(0);
  });

  it('dayKey cours au fuseau du club — 22h30 UTC = lendemain à Paris (Europe/Paris)', () => {
    // 2026-06-13T22:30:00Z = 2026-06-14T00:30:00 en heure d'été Paris (UTC+2)
    const lessons = [makeLessonEnrollment({
      startTime: '2026-06-13T22:30:00.000Z',
      endTime: '2026-06-13T23:30:00.000Z',
      timezone: 'Europe/Paris',
    })];
    const entries = buildCalendarEntries([], [], [], lessons, NOW);
    expect(entries[0]).toMatchObject({ kind: 'lesson', dayKey: '2026-06-14' });
  });

  it('dayKey cours UTC — 22h30 UTC reste le même jour en UTC', () => {
    const lessons = [makeLessonEnrollment({
      startTime: '2026-06-13T22:30:00.000Z',
      endTime: '2026-06-13T23:30:00.000Z',
      timezone: 'UTC',
    })];
    const entries = buildCalendarEntries([], [], [], lessons, NOW);
    expect(entries[0]).toMatchObject({ kind: 'lesson', dayKey: '2026-06-13' });
  });
});

describe('todayKey', () => {
  it('retourne une clé YYYY-MM-DD', () => {
    expect(todayKey(new Date('2026-06-10T12:00:00.000Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('addDaysKey', () => {
  it('avance et recule d\'un nombre de jours (arithmétique UTC, sans décalage DST)', () => {
    expect(addDaysKey('2026-07-10', 1)).toBe('2026-07-11');
    expect(addDaysKey('2026-07-10', -1)).toBe('2026-07-09');
    expect(addDaysKey('2026-07-10', -7)).toBe('2026-07-03');
  });
  it('franchit les bornes de mois et d\'année', () => {
    expect(addDaysKey('2026-07-01', -1)).toBe('2026-06-30');
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('frLongLabel / frWeekday', () => {
  it('libellé long français sans passer par un fuseau local', () => {
    expect(frLongLabel('2026-07-10')).toBe('vendredi 10 juillet');
    expect(frWeekday('2026-07-10')).toBe('vendredi');
  });
});
