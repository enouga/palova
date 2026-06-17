import { weeklyOccurrences, MAX_OCCURRENCES } from '../recurrence';

const base = { weekday: 2, startLocal: '18:00', durationMin: 90, tz: 'Europe/Paris' }; // mardi

describe('weeklyOccurrences', () => {
  it('génère une occurrence par semaine entre startDate et endDate (bornes incluses)', () => {
    // 2026-06-02 = mardi. Du 02/06 au 16/06 → 3 mardis (02, 09, 16).
    const occ = weeklyOccurrences({ ...base, startDate: '2026-06-02', endDate: '2026-06-16' });
    expect(occ).toHaveLength(3);
  });

  it('avance jusqu au premier weekday si startDate ne tombe pas dessus', () => {
    // 2026-06-01 = lundi ; 1er mardi = 02/06.
    const occ = weeklyOccurrences({ ...base, startDate: '2026-06-01', endDate: '2026-06-02' });
    expect(occ).toHaveLength(1);
    expect(occ[0].startUtc.toISOString()).toBe('2026-06-02T16:00:00.000Z'); // 18:00 Paris (été = UTC+2)
  });

  it('calcule la fin via durationMin', () => {
    const occ = weeklyOccurrences({ ...base, startDate: '2026-06-02', endDate: '2026-06-02' });
    expect(occ[0].endUtc.toISOString()).toBe('2026-06-02T17:30:00.000Z'); // +90 min
  });

  it('reste à l heure locale à travers un changement d heure (DST)', () => {
    // Bascule heure d'hiver France : dim 25/10/2026. Vendredi (weekday 5) 10:00.
    const occ = weeklyOccurrences({ weekday: 5, startLocal: '10:00', durationMin: 60, tz: 'Europe/Paris', startDate: '2026-10-23', endDate: '2026-10-30' });
    expect(occ).toHaveLength(2);
    expect(occ[0].startUtc.toISOString()).toBe('2026-10-23T08:00:00.000Z'); // été UTC+2
    expect(occ[1].startUtc.toISOString()).toBe('2026-10-30T09:00:00.000Z'); // hiver UTC+1
  });

  it('rejette VALIDATION_ERROR si endDate < startDate', () => {
    expect(() => weeklyOccurrences({ ...base, startDate: '2026-06-16', endDate: '2026-06-02' })).toThrow('VALIDATION_ERROR');
  });

  it('rejette VALIDATION_ERROR si aucune occurrence dans l intervalle', () => {
    // 2026-06-03 = mercredi, 2026-06-04 = jeudi : aucun mardi.
    expect(() => weeklyOccurrences({ ...base, startDate: '2026-06-03', endDate: '2026-06-04' })).toThrow('VALIDATION_ERROR');
  });

  it('rejette VALIDATION_ERROR sur weekday/heure/durée invalides', () => {
    expect(() => weeklyOccurrences({ ...base, weekday: 0, startDate: '2026-06-02', endDate: '2026-06-09' })).toThrow('VALIDATION_ERROR');
    expect(() => weeklyOccurrences({ ...base, startLocal: '25:00', startDate: '2026-06-02', endDate: '2026-06-09' })).toThrow('VALIDATION_ERROR');
    expect(() => weeklyOccurrences({ ...base, durationMin: 0, startDate: '2026-06-02', endDate: '2026-06-09' })).toThrow('VALIDATION_ERROR');
  });

  it('rejette SERIES_TOO_LONG au-delà de MAX_OCCURRENCES', () => {
    // 61 semaines de mardis.
    const end = '2027-08-10'; // > 60 mardis après 2026-06-02
    expect(() => weeklyOccurrences({ ...base, startDate: '2026-06-02', endDate: end })).toThrow('SERIES_TOO_LONG');
    expect(MAX_OCCURRENCES).toBe(60);
  });
});
