import { shiftDatesToNextFuture } from '../lib/duplicateAgenda';

// `now` et les chaînes sont interprétés dans le fuseau local du runner ; le
// round-trip local→Date→local s'annule, donc jour de semaine et heure (HH:MM)
// sont préservés indépendamment du fuseau.

describe('shiftDatesToNextFuture', () => {
  it('source récente : décale d’une seule semaine (même jour, même heure)', () => {
    const now = new Date('2026-07-20T10:00');
    const res = shiftDatesToNextFuture(
      { startTime: '2026-07-18T20:00', endTime: '2026-07-18T23:00', registrationDeadline: '2026-07-16T18:00' },
      now,
    );
    expect(res.registrationDeadline).toBe('2026-07-23T18:00');
    expect(res.startTime).toBe('2026-07-25T20:00');
    expect(res.endTime).toBe('2026-07-25T23:00');
  });

  it('source ancienne : tombe à la PROCHAINE occurrence future, même jour de semaine', () => {
    const now = new Date('2026-07-20T10:00');
    const src = { startTime: '2025-03-15T14:00', endTime: null, registrationDeadline: '2025-03-15T12:00' };
    const res = shiftDatesToNextFuture(src, now);
    const shifted = new Date(res.registrationDeadline);
    // futur
    expect(shifted.getTime()).toBeGreaterThan(now.getTime());
    // même jour de semaine que la source
    expect(shifted.getDay()).toBe(new Date('2025-03-15T12:00').getDay());
    // heure locale préservée
    expect(res.registrationDeadline.endsWith('T12:00')).toBe(true);
    // « la plus proche » : reculer d’une semaine repasse dans le passé
    const earlier = new Date(shifted);
    earlier.setDate(earlier.getDate() - 7);
    expect(earlier.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('pivote sur la limite d’inscription : le début seul serait déjà futur mais la limite non', () => {
    const now = new Date('2026-07-20T10:00');
    // début à J-1 (bientôt futur avec +7), mais limite 14 j avant le début → doit décaler plus
    const src = { startTime: '2026-07-19T20:00', endTime: null, registrationDeadline: '2026-07-05T18:00' };
    const res = shiftDatesToNextFuture(src, now);
    // limite : 05→12 (<20), 12→19 (<20), 19→26 (>20) ⇒ N=3
    expect(res.registrationDeadline).toBe('2026-07-26T18:00');
    // même N=3 sur le début : 19 juillet + 21 j = 9 août
    expect(res.startTime).toBe('2026-08-09T20:00');
    // écart limite→début (14 j) préservé
    const gap = (new Date(res.startTime).getTime() - new Date(res.registrationDeadline).getTime()) / 86_400_000;
    expect(Math.round(gap)).toBe(14);
  });

  it('endTime absent (null) est laissé tel quel', () => {
    const now = new Date('2026-07-20T10:00');
    const res = shiftDatesToNextFuture(
      { startTime: '2026-07-18T20:00', endTime: null, registrationDeadline: '2026-07-16T18:00' },
      now,
    );
    expect(res.endTime).toBeNull();
  });

  it('endTime vide ("") est laissé tel quel', () => {
    const now = new Date('2026-07-20T10:00');
    const res = shiftDatesToNextFuture(
      { startTime: '2026-07-18T20:00', endTime: '', registrationDeadline: '2026-07-16T18:00' },
      now,
    );
    expect(res.endTime).toBe('');
  });
});
