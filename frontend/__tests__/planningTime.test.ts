import {
  parseTimeInput,
  snapMinutes,
  toMinutes,
  fromMinutes,
  findOverlap,
  nextFreeStart,
  hingeHourChips,
  smartChips,
  pxToMinutes,
  localMinutesOfDay,
  weekdayOf,
  type BusySlot,
} from '@/lib/planningTime';

describe('parseTimeInput', () => {
  it('accepte "HH:MM"', () => {
    expect(parseTimeInput('17:30')).toBe('17:30');
    expect(parseTimeInput('09:05')).toBe('09:05');
  });
  it('accepte 4 chiffres collés "HHMM"', () => {
    expect(parseTimeInput('1730')).toBe('17:30');
    expect(parseTimeInput('0800')).toBe('08:00');
  });
  it('accepte 3 chiffres collés "HMM" (heure à 1 chiffre)', () => {
    expect(parseTimeInput('930')).toBe('09:30');
  });
  it('accepte 1-2 chiffres = heure ronde', () => {
    expect(parseTimeInput('9')).toBe('09:00');
    expect(parseTimeInput('17')).toBe('17:00');
  });
  it('rejette une heure ou minute hors bornes', () => {
    expect(parseTimeInput('25:00')).toBeNull();
    expect(parseTimeInput('2400')).toBeNull();
    expect(parseTimeInput('17:60')).toBeNull();
  });
  it('rejette du texte non numérique ou vide', () => {
    expect(parseTimeInput('abc')).toBeNull();
    expect(parseTimeInput('')).toBeNull();
    expect(parseTimeInput('  ')).toBeNull();
  });
});

describe('snapMinutes', () => {
  it('arrondit au pas le plus proche', () => {
    expect(snapMinutes(17, 15)).toBe(15);
    expect(snapMinutes(23, 15)).toBe(30);
    expect(snapMinutes(7, 15)).toBe(0);
  });
});

describe('toMinutes / fromMinutes', () => {
  it('convertit "HH:MM" ↔ minutes depuis minuit', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(fromMinutes(570)).toBe('09:30');
  });
  it('fromMinutes replie modulo 24h (négatif ou > 1440)', () => {
    expect(fromMinutes(-30)).toBe('23:30');
    expect(fromMinutes(1470)).toBe('00:30');
  });
});

const busy = (over: Partial<BusySlot> = {}): BusySlot => ({
  id: over.id ?? 'r1',
  resourceId: over.resourceId ?? 'court-1',
  startMin: over.startMin ?? 17 * 60,
  endMin: over.endMin ?? 18 * 60,
});

describe('findOverlap', () => {
  it('détecte un chevauchement sur le même terrain', () => {
    const list = [busy()];
    expect(findOverlap(list, 'court-1', 17 * 60 + 30, 60)).toBe(list[0]);
  });
  it('aucun chevauchement sur un autre terrain', () => {
    const list = [busy({ resourceId: 'court-2' })];
    expect(findOverlap(list, 'court-1', 17 * 60, 60)).toBeNull();
  });
  it('aucun chevauchement si adjacent (fin == début)', () => {
    const list = [busy()]; // 17:00-18:00
    expect(findOverlap(list, 'court-1', 18 * 60, 60)).toBeNull();
    expect(findOverlap(list, 'court-1', 16 * 60, 60)).toBeNull();
  });
  it('exclut un id donné (déplacer une résa sur son propre créneau)', () => {
    const list = [busy({ id: 'self' })];
    expect(findOverlap(list, 'court-1', 17 * 60, 60, 'self')).toBeNull();
  });
});

describe('nextFreeStart', () => {
  it('retourne fromMin si déjà libre', () => {
    expect(nextFreeStart([], 'court-1', 17 * 60, 60, 22 * 60)).toBe(17 * 60);
  });
  it('avance par pas de 15 min jusqu\'au premier créneau libre', () => {
    const list = [busy({ startMin: 17 * 60, endMin: 18 * 60 })];
    expect(nextFreeStart(list, 'court-1', 17 * 60, 60, 22 * 60)).toBe(18 * 60);
  });
  it('null si aucun créneau ne tient avant la fermeture', () => {
    expect(nextFreeStart([], 'court-1', 21 * 60 + 45, 60, 22 * 60)).toBeNull();
  });
});

describe('hingeHourChips', () => {
  it('ne garde que les heures charnières dans la plage d\'ouverture', () => {
    expect(hingeHourChips(8 * 60, 22 * 60)).toEqual([8 * 60, 12 * 60, 18 * 60, 20 * 60]);
  });
  it('exclut les heures charnières hors plage', () => {
    expect(hingeHourChips(9 * 60, 19 * 60)).toEqual([12 * 60, 18 * 60]);
  });
});

describe('smartChips', () => {
  // `fromMin` = ancre de recherche de « Prochain libre » (le début actuellement choisi par
  // l'utilisateur, PAS l'heure d'ouverture) ; `nowMin` ne sert qu'à la chip « Maintenant ».
  it('inclut « Maintenant » arrondi au ¼ d\'heure quand nowMin est fourni', () => {
    // 16h37 : le plus proche des deux quarts d'heure encadrants est 16h30 (7 min contre 8).
    const chips = smartChips({ nowMin: 16 * 60 + 37, fromMin: 16 * 60 + 37, openMin: 8 * 60, closeMin: 22 * 60, durationMin: 60, busy: [], resourceId: 'court-1' });
    expect(chips.find((c) => c.key === 'now')).toEqual({ key: 'now', label: expect.stringContaining('16:30'), startMin: 16 * 60 + 30 });
  });
  it('omet « Maintenant » quand nowMin est null (jour ≠ aujourd\'hui)', () => {
    const chips = smartChips({ nowMin: null, fromMin: 17 * 60, openMin: 8 * 60, closeMin: 22 * 60, durationMin: 60, busy: [], resourceId: 'court-1' });
    expect(chips.find((c) => c.key === 'now')).toBeUndefined();
  });
  it('inclut « Prochain libre » qui cherche depuis fromMin (pas depuis l\'ouverture) et saute par-dessus un créneau occupé', () => {
    const list = [busy({ startMin: 17 * 60, endMin: 18 * 60 })];
    const chips = smartChips({ nowMin: null, fromMin: 17 * 60, openMin: 8 * 60, closeMin: 22 * 60, durationMin: 60, busy: list, resourceId: 'court-1' });
    expect(chips.find((c) => c.key === 'free')?.startMin).toBe(18 * 60);
  });
  it('dédoublonne : si "Maintenant" == "Prochain libre", une seule chip', () => {
    const chips = smartChips({ nowMin: 17 * 60, fromMin: 17 * 60, openMin: 8 * 60, closeMin: 22 * 60, durationMin: 60, busy: [], resourceId: 'court-1' });
    const starts = chips.map((c) => c.startMin);
    expect(starts.filter((s) => s === 17 * 60)).toHaveLength(1);
  });
  it('inclut les heures charnières restantes', () => {
    const chips = smartChips({ nowMin: null, fromMin: 8 * 60, openMin: 8 * 60, closeMin: 22 * 60, durationMin: 60, busy: [], resourceId: 'court-1' });
    expect(chips.map((c) => c.startMin)).toEqual(expect.arrayContaining([8 * 60, 12 * 60, 18 * 60, 20 * 60]));
  });
});

describe('localMinutesOfDay', () => {
  it('convertit un instant ISO en minutes depuis minuit, au fuseau donné', () => {
    // 14:00Z = 16h00 à Paris (été, UTC+2)
    expect(localMinutesOfDay('2026-06-11T14:00:00.000Z', 'Europe/Paris')).toBe(16 * 60);
  });
});

describe('weekdayOf', () => {
  it('renvoie le jour de semaine convention Luxon (1=lundi..7=dimanche)', () => {
    expect(weekdayOf('2026-07-12')).toBe(7); // dimanche
    expect(weekdayOf('2026-07-13')).toBe(1); // lundi
  });
});

describe('pxToMinutes', () => {
  it('convertit une position Y en minutes, alignées sur le pas', () => {
    // HOUR_H=68, minOpen=8h : y=68 → 9h00 pile
    expect(pxToMinutes(68, 68, 8 * 60)).toBe(9 * 60);
  });
  it('aligne sur le pas donné (15 min par défaut)', () => {
    // y=34 → +30min → 8h30 (déjà sur le pas)
    expect(pxToMinutes(34, 68, 8 * 60)).toBe(8 * 60 + 30);
  });
});
