import { announcementExpired, fullSectionSettings, hiddenSectionKeys, kiosqueSlides, matchSeats, offerIsActive, resolveSections, SECTION_DEFS, SECTION_KEYS, tournamentPlacesLabel, todayISO } from '../lib/clubhouse';
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
  pinned: false, kind: 'INFO', validUntil: null, sortOrder: 0, createdAt: '', updatedAt: '', ...over,
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
  it('config null → ordres adaptatifs historiques (membre ≠ visiteur), kiosque en tête, sponsors en fin', () => {
    expect(resolveSections(null, true).order).toEqual(['kiosk', 'matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors']);
    expect(resolveSections(null, false).order).toEqual(['kiosk', 'matches', 'clubCard', 'agenda', 'offers', 'top', 'sponsors']);
    expect(resolveSections(undefined, false).order).toContain('sponsors');
  });

  it('config custom → même ordre pour tous, sections masquées exclues (sponsors compris)', () => {
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
    expect(member.order[0]).toBe('kiosk'); // kiosque absent de la config → préfixé
    expect(member.order[1]).toBe('top');
    expect(member.order).not.toContain('matches');
    expect(member.order).not.toContain('sponsors');
  });

  it('sponsors réordonnable : peut être placé en tête ou au milieu, pas seulement en fin', () => {
    const front = resolveSections([
      { key: 'sponsors', visible: true },
      { key: 'matches', visible: true },
      { key: 'agenda', visible: true },
      { key: 'top', visible: true },
      { key: 'offers', visible: true },
      { key: 'clubCard', visible: true },
    ], true);
    expect(front.order[1]).toBe('sponsors'); // [0] = kiosque préfixé

    const middle = resolveSections([
      { key: 'matches', visible: true },
      { key: 'sponsors', visible: true },
      { key: 'agenda', visible: true },
      { key: 'top', visible: true },
      { key: 'offers', visible: true },
      { key: 'clubCard', visible: true },
    ], true);
    expect(middle.order[2]).toBe('sponsors'); // [0] = kiosque préfixé
  });

  it('clé connue absente de la config → ajoutée en fin, visible (tolérance versions)', () => {
    const { order } = resolveSections([{ key: 'clubCard', visible: true }], true);
    expect(order[0]).toBe('kiosk'); // kiosque préfixé
    expect(order[1]).toBe('clubCard');
    expect(order).toHaveLength(7);
  });

  it('clé inconnue (dont anciennes posters/announcements) ignorée', () => {
    const { order } = resolveSections([{ key: 'posters', visible: true } as never, { key: 'top', visible: true }], true);
    expect(order[1]).toBe('top'); // [0] = kiosque préfixé
    expect(order).not.toContain('posters');
  });

  it('kiosk absent d\'une config complète → inséré en tête (rétro-compat clubs déjà personnalisés)', () => {
    const { order } = resolveSections([
      { key: 'matches', visible: true }, { key: 'agenda', visible: true }, { key: 'top', visible: true },
      { key: 'offers', visible: true }, { key: 'clubCard', visible: true }, { key: 'sponsors', visible: true },
    ], true);
    expect(order[0]).toBe('kiosk');
    expect(order).toHaveLength(7);
  });

  it('kiosk placé au milieu → respecté ; masqué explicitement → exclu', () => {
    const moved = resolveSections([
      { key: 'matches', visible: true }, { key: 'kiosk', visible: true }, { key: 'agenda', visible: true },
      { key: 'top', visible: true }, { key: 'offers', visible: true }, { key: 'clubCard', visible: true },
      { key: 'sponsors', visible: true },
    ], true);
    expect(moved.order[1]).toBe('kiosk');

    const hiddenKiosk = resolveSections([{ key: 'kiosk', visible: false }, { key: 'matches', visible: true }], true);
    expect(hiddenKiosk.order).not.toContain('kiosk');
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
  it('null → 7 entrées visibles, kiosque en tête, sponsors en fin', () => {
    const full = fullSectionSettings(null);
    expect(full).toHaveLength(7);
    expect(full[0]).toEqual({ key: 'kiosk', visible: true });
    expect(full[1]).toEqual({ key: 'matches', visible: true });
    expect(full[6].key).toBe('sponsors');
    expect(full.every((e) => e.visible)).toBe(true);
  });

  it('config partielle → complétée sans doublon, 1re occurrence gagne, kiosque préfixé', () => {
    const full = fullSectionSettings([{ key: 'top', visible: false }, { key: 'top', visible: true }]);
    expect(full).toHaveLength(7);
    expect(full[0]).toEqual({ key: 'kiosk', visible: true });
    expect(full[1]).toEqual({ key: 'top', visible: false });
  });

  it('kiosk masqué dans la config → conservé masqué dans l\'éditeur', () => {
    const full = fullSectionSettings([{ key: 'kiosk', visible: false }, { key: 'matches', visible: true }]);
    expect(full[0]).toEqual({ key: 'kiosk', visible: false });
    expect(full).toHaveLength(7);
  });

  it('SECTION_DEFS couvre exactement SECTION_KEYS (sponsors compris)', () => {
    expect(SECTION_DEFS.map((d) => d.key).sort()).toEqual([...SECTION_KEYS].sort());
  });
});
