import { announcementExpired, fullSectionSettings, hiddenSectionKeys, kiosqueSlides, matchSeats, offerIsActive, resolveSections, SECTION_DEFS, SECTION_KEYS, SPONSORS_DEF, tournamentPlacesLabel, todayISO } from '../lib/clubhouse';
import { Announcement, ClubHouseSectionSetting, Tournament } from '../lib/api';

const NOW = new Date('2026-06-10T12:00:00Z');

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

describe('announcementExpired', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  it('null = jamais expirée ; date passée = expirée', () => {
    expect(announcementExpired({ validUntil: null }, now)).toBe(false);
    expect(announcementExpired({ validUntil: '2026-07-01T23:59:59.999Z' }, now)).toBe(true);
    expect(announcementExpired({ validUntil: '2026-08-01T23:59:59.999Z' }, now)).toBe(false);
  });
});

describe('kiosqueSlides', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  it('garde les annonces actives (avec ou sans image), ordre conservé, exclut les expirées, plafond 6', () => {
    const list = [
      ann({ id: 'a1' }),                                              // texte seul
      ann({ id: 'a2', imageUrl: '/u/2.jpg' }),                        // avec affiche
      ann({ id: 'expired', validUntil: '2026-07-01T23:59:59.999Z' }), // exclue
      ...[3, 4, 5, 6, 7, 8].map((i) => ann({ id: `a${i}` })),
    ];
    expect(kiosqueSlides(list, now).map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  });
  it('aucune annonce → []', () => {
    expect(kiosqueSlides([], now)).toEqual([]);
  });
});

describe('matchSeats', () => {
  it('sièges vides = maxPlayers - inscrits, borné à 0 et capé à 6 de capacité', () => {
    expect(matchSeats({ maxPlayers: 4, players: [{}, {}] })).toBe(2);
    expect(matchSeats({ maxPlayers: 4, players: [{}, {}, {}, {}, {}] })).toBe(0);
    expect(matchSeats({ maxPlayers: 12, players: [{}] })).toBe(5);
  });
});

describe('resolveSections', () => {
  it('config null → ordres adaptatifs historiques (membre ≠ visiteur), sponsors visibles', () => {
    expect(resolveSections(null, true).order).toEqual(['matches', 'agenda', 'top', 'offers', 'clubCard']);
    expect(resolveSections(null, false).order).toEqual(['matches', 'clubCard', 'agenda', 'offers', 'top']);
    expect(resolveSections(undefined, false).sponsorsVisible).toBe(true);
  });

  it('config custom → même ordre pour tous, sections masquées exclues, sponsorsVisible', () => {
    const config: ClubHouseSectionSetting[] = [
      { key: 'top', visible: true },
      { key: 'matches', visible: false },
      { key: 'agenda', visible: true },
      { key: 'offers', visible: true },
      { key: 'clubCard', visible: true },
      { key: 'sponsors', visible: false },
    ];
    const member = resolveSections(config, true);
    const visitor = resolveSections(config, false);
    expect(member.order).toEqual(visitor.order);
    expect(member.order[0]).toBe('top');
    expect(member.order).not.toContain('matches');
    expect(member.order).not.toContain('sponsors');
    expect(member.sponsorsVisible).toBe(false);
  });

  it('clé connue absente de la config → ajoutée en fin, visible (tolérance versions)', () => {
    const { order } = resolveSections([{ key: 'clubCard', visible: true }], true);
    expect(order[0]).toBe('clubCard');
    expect(order).toHaveLength(5);
  });

  it('clé inconnue (dont anciennes posters/announcements) ignorée', () => {
    const { order } = resolveSections([{ key: 'posters', visible: true } as never, { key: 'top', visible: true }], true);
    expect(order[0]).toBe('top');
    expect(order).not.toContain('posters');
  });
});

describe('hiddenSectionKeys', () => {
  it('null → rien de masqué', () => {
    expect(hiddenSectionKeys(null).size).toBe(0);
  });

  it('sections masquées + sponsors ; clés complétées = visibles', () => {
    const hidden = hiddenSectionKeys([
      { key: 'top', visible: false },
      { key: 'sponsors', visible: false },
    ]);
    expect(hidden.has('top')).toBe(true);
    expect(hidden.has('sponsors')).toBe(true);
    expect(hidden.has('matches')).toBe(false);
  });
});

describe('fullSectionSettings / SECTION_DEFS', () => {
  it('null → 6 entrées visibles, ordre par défaut membre + sponsors en fin', () => {
    const full = fullSectionSettings(null);
    expect(full).toHaveLength(6);
    expect(full[0]).toEqual({ key: 'matches', visible: true });
    expect(full[5].key).toBe('sponsors');
    expect(full.every((e) => e.visible)).toBe(true);
  });

  it('config partielle → complétée sans doublon, 1re occurrence gagne', () => {
    const full = fullSectionSettings([{ key: 'top', visible: false }, { key: 'top', visible: true }]);
    expect(full).toHaveLength(6);
    expect(full[0]).toEqual({ key: 'top', visible: false });
  });

  it('SECTION_DEFS + sponsors couvrent exactement SECTION_KEYS', () => {
    expect([...SECTION_DEFS.map((d) => d.key), SPONSORS_DEF.key].sort()).toEqual([...SECTION_KEYS].sort());
  });
});
