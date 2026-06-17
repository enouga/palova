import { mergeAgenda, filterAgenda, eventPlacesLabel, KIND_LABEL, agendaFacets, applyAgendaFilters, emptyFilterState } from '@/lib/events';
import type { Tournament, ClubEvent, LessonSummary } from '@/lib/api';

const NOW = new Date('2026-06-11T12:00:00Z');

const tournoi = (over: Partial<Tournament> = {}): Tournament => ({
  id: 't1', clubId: 'c1', clubSportId: 'cs1', name: 'P100', category: 'P100', gender: 'MEN',
  description: null, startTime: '2026-06-20T08:00:00.000Z', endTime: null,
  registrationDeadline: '2026-06-18T08:00:00.000Z', maxTeams: 8, entryFee: null,
  status: 'PUBLISHED', confirmedCount: 2, waitlistCount: 0, ...over,
} as Tournament);

const anim = (over: Partial<ClubEvent> = {}): ClubEvent => ({
  id: 'e1', clubId: 'c1', name: 'Melee du vendredi', kind: 'MELEE', description: null,
  startTime: '2026-06-15T18:00:00.000Z', endTime: null, registrationDeadline: '2026-06-15T12:00:00.000Z',
  capacity: 12, price: null, memberOnly: true, status: 'PUBLISHED', confirmedCount: 4, waitlistCount: 0, ...over,
});

describe('mergeAgenda', () => {
  it('fusionne et trie par date de debut, PUBLISHED a venir seulement', () => {
    const items = mergeAgenda([tournoi()], [anim()], [], NOW);
    expect(items.map((i) => i.source)).toEqual(['event', 'tournament']); // 15/06 avant 20/06
  });
  it('exclut le passe et les non-PUBLISHED', () => {
    const past = anim({ startTime: '2026-06-01T18:00:00.000Z' });
    const draft = tournoi({ status: 'DRAFT' });
    expect(mergeAgenda([draft], [past], [], NOW)).toHaveLength(0);
  });
  it('expose endTime de chaque source', () => {
    const items = mergeAgenda(
      [tournoi({ endTime: '2026-06-20T12:00:00.000Z' })],
      [anim({ endTime: null })],
      [],
      NOW,
    );
    expect(items[0].endTime).toBeNull(); // event (15/06)
    expect(items[1].endTime).toBe('2026-06-20T12:00:00.000Z'); // tournoi (20/06)
  });
});

describe('filterAgenda', () => {
  const items = mergeAgenda([tournoi()], [anim()], [], NOW);
  it('competitions = tournois seulement, animations = events seulement', () => {
    expect(filterAgenda(items, 'competitions').every((i) => i.source === 'tournament')).toBe(true);
    expect(filterAgenda(items, 'animations').every((i) => i.source === 'event')).toBe(true);
    expect(filterAgenda(items, 'tout')).toHaveLength(2);
  });
});

describe('eventPlacesLabel', () => {
  it('capacite limitee : restantes / urgence / complet', () => {
    expect(eventPlacesLabel(anim({ capacity: 12, confirmedCount: 4 }))).toEqual({ text: '8 places restantes', urgent: false });
    expect(eventPlacesLabel(anim({ capacity: 12, confirmedCount: 9 }))).toEqual({ text: 'Plus que 3 places', urgent: true });
    expect(eventPlacesLabel(anim({ capacity: 12, confirmedCount: 12 }))).toEqual({ text: "Complet · liste d'attente possible", urgent: false });
  });
  it('sans capacite : nombre d inscrits', () => {
    expect(eventPlacesLabel(anim({ capacity: null, confirmedCount: 5 }))).toEqual({ text: '5 inscrits', urgent: false });
    expect(eventPlacesLabel(anim({ capacity: null, confirmedCount: 1 }))).toEqual({ text: '1 inscrit', urgent: false });
  });
});

describe('KIND_LABEL', () => {
  it('couvre tous les kinds', () => {
    expect(KIND_LABEL).toEqual({ MELEE: 'Mêlée', STAGE: 'Stage', SOIREE: 'Soirée', INITIATION: 'Initiation', AUTRE: 'Événement' });
  });
});

describe('agendaFacets', () => {
  const items = mergeAgenda(
    [
      tournoi({ id: 't1', category: 'P500', gender: 'MIXED', startTime: '2026-06-20T08:00:00.000Z' }),
      tournoi({ id: 't2', category: 'P100', gender: 'MEN', startTime: '2026-06-21T08:00:00.000Z' }),
      tournoi({ id: 't3', category: 'P500', gender: 'MEN', startTime: '2026-06-22T08:00:00.000Z' }),
    ],
    [
      anim({ id: 'e1', kind: 'SOIREE', memberOnly: false, startTime: '2026-06-16T18:00:00.000Z' }),
      anim({ id: 'e2', kind: 'MELEE', memberOnly: true, startTime: '2026-06-17T18:00:00.000Z' }),
    ],
    [],
    NOW,
  );

  it('ne renvoie que les valeurs presentes, dedupliquees', () => {
    const f = agendaFacets(items);
    expect(f.categories).toEqual(['P100', 'P500']); // triees P25->P2000, dedup
    expect(f.kinds).toEqual(['MELEE', 'SOIREE']); // triees selon KIND_LABEL
  });

  it('trie les genres MEN, WOMEN, MIXED et expose hasMemberOnly', () => {
    const f = agendaFacets(items);
    expect(f.genders).toEqual(['MEN', 'MIXED']);
    expect(f.hasMemberOnly).toBe(true);
  });

  it('hasMemberOnly = false si aucune animation reservee aux membres', () => {
    const f = agendaFacets(mergeAgenda([], [anim({ memberOnly: false })], [], NOW));
    expect(f.hasMemberOnly).toBe(false);
  });
});

describe('applyAgendaFilters', () => {
  const t500 = tournoi({ id: 't1', category: 'P500', gender: 'MIXED', startTime: '2026-06-20T08:00:00.000Z' });
  const t100 = tournoi({ id: 't2', category: 'P100', gender: 'MEN', startTime: '2026-06-21T08:00:00.000Z' });
  const eSoiree = anim({ id: 'e1', kind: 'SOIREE', memberOnly: false, startTime: '2026-06-16T18:00:00.000Z' });
  const eMelee = anim({ id: 'e2', kind: 'MELEE', memberOnly: true, startTime: '2026-06-17T18:00:00.000Z' });
  const items = mergeAgenda([t500, t100], [eSoiree, eMelee], [], NOW);
  const ids = (xs: typeof items) => xs.map((i) => (i.source === 'tournament' ? i.tournament.id : i.source === 'event' ? i.event.id : i.lesson.id)).sort();

  it('etat vide = tout passe', () => {
    expect(applyAgendaFilters(items, emptyFilterState()).length).toBe(4);
  });

  it('OU intra-dimension sur la categorie', () => {
    const out = applyAgendaFilters(items, { ...emptyFilterState(), categories: new Set(['P500', 'P100']) });
    // les deux tournois passent ; les animations passent (categorie ne les contraint pas)
    expect(ids(out)).toEqual(['e1', 'e2', 't1', 't2']);
  });

  it('une facette ne contraint que sa source (categorie laisse passer les animations)', () => {
    const out = applyAgendaFilters(items, { ...emptyFilterState(), categories: new Set(['P500']) });
    expect(ids(out)).toEqual(['e1', 'e2', 't1']); // t100 exclu, animations gardees
  });

  it('ET inter-dimensions : categorie + genre', () => {
    const out = applyAgendaFilters(items, { ...emptyFilterState(), categories: new Set(['P500']), genders: new Set(['MEN']) });
    // t500 est MIXED -> exclu ; animations gardees
    expect(ids(out)).toEqual(['e1', 'e2']);
  });

  it('kind et memberOnly contraignent les animations', () => {
    const out = applyAgendaFilters(items, { ...emptyFilterState(), kinds: new Set(['MELEE']) });
    expect(ids(out)).toEqual(['e2', 't1', 't2']); // eSoiree exclu
    const mem = applyAgendaFilters(items, { ...emptyFilterState(), memberOnly: true });
    expect(ids(mem)).toEqual(['e2', 't1', 't2']); // eSoiree (memberOnly false) exclu
  });

  it('combine avec la source', () => {
    const out = applyAgendaFilters(items, { ...emptyFilterState(), source: 'animations', kinds: new Set(['SOIREE']) });
    expect(ids(out)).toEqual(['e1']);
  });
});

// ---- Cours (source 'lesson') ----

const lesson = (over: Partial<LessonSummary> = {}): LessonSummary => ({
  id: 'l1',
  clubId: 'c1',
  lessonKind: 'COLLECTIVE',
  allowSelfEnroll: true,
  capacity: 4,
  confirmedCount: 1,
  waitlistCount: 0,
  seriesId: null,
  coach: { name: 'Coach X', photoUrl: null },
  reservation: { startTime: '2026-07-01T17:00:00.000Z', endTime: '2026-07-01T18:00:00.000Z', resource: { name: 'Court 1' } },
  series: null,
  ...over,
} as LessonSummary);

describe('mergeAgenda avec cours', () => {
  it('inclut les cours (source lesson) tries par date', () => {
    const merged = mergeAgenda([], [], [lesson()], NOW);
    expect(merged.some((i) => i.source === 'lesson')).toBe(true);
  });

  it('le cours expose startTime et endTime de la reservation', () => {
    const merged = mergeAgenda([], [], [lesson()], NOW);
    const l = merged.find((i) => i.source === 'lesson')!;
    expect(l.startTime).toBe('2026-07-01T17:00:00.000Z');
    expect(l.endTime).toBe('2026-07-01T18:00:00.000Z');
  });

  it('mergeAgenda sans cours (tableau vide) fonctionne toujours', () => {
    const merged = mergeAgenda([tournoi()], [anim()], [], NOW);
    expect(merged.length).toBe(2);
  });
});

describe("applyAgendaFilters : filtre Cours", () => {
  const lessonItem = { source: 'lesson' as const, startTime: '2026-07-01T17:00:00.000Z', endTime: '2026-07-01T18:00:00.000Z', lesson: lesson() };
  const eventItem = { source: 'event' as const, startTime: '2026-06-15T18:00:00.000Z', endTime: null, event: anim() };
  const mixed = [lessonItem, eventItem];

  it("filtre cours ne garde que les cours", () => {
    const out = applyAgendaFilters(mixed as any, { ...emptyFilterState(), source: 'cours' });
    expect(out.length).toBe(1);
    expect(out[0].source).toBe('lesson');
  });

  it("filtre tout inclut les cours", () => {
    const out = applyAgendaFilters(mixed as any, emptyFilterState());
    expect(out.some((i) => i.source === 'lesson')).toBe(true);
  });
});

describe('agendaFacets : resistance aux cours', () => {
  it('ne crashe pas sur un item de source lesson', () => {
    const lessonItem = { source: 'lesson' as const, startTime: '2026-07-01T17:00:00.000Z', endTime: '2026-07-01T18:00:00.000Z', lesson: lesson() };
    expect(() => agendaFacets([lessonItem] as any)).not.toThrow();
  });
});
