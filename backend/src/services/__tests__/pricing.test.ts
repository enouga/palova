import { splitOffPeakMinutes, slotPriceCents, classifySlot, effectiveSlotPriceCents, ActivePromo } from '../pricing';

// Lundi : creuses 9h–12h et 14h–17h, le reste en pleines.
const OFF = { 1: [{ start: 9, end: 12 }, { start: 14, end: 17 }] };
// Lundi (minutes) : creuses 9h30–12h15
const OFF_MIN = { 1: [{ start: 9, startMin: 30, end: 12, endMin: 15 }] };

// Vecteurs numériques PARTAGÉS avec frontend/__tests__/caisse.test.ts (anti-drift).
// Lundi 8 juin 2026, Europe/Paris (UTC+2 en juin) : 16h locale = 14:00Z.
const TZ = 'Europe/Paris';
const d = (iso: string) => new Date(iso);

describe('splitOffPeakMinutes', () => {
  it('tout plein : lundi 12h-13h30 (entre les plages)', () => {
    expect(splitOffPeakMinutes(OFF, d('2026-06-08T10:00:00Z'), d('2026-06-08T11:30:00Z'), TZ))
      .toEqual({ offPeakMin: 0, peakMin: 90 });
  });
  it('tout creux : lundi 9h-11h', () => {
    expect(splitOffPeakMinutes(OFF, d('2026-06-08T07:00:00Z'), d('2026-06-08T09:00:00Z'), TZ))
      .toEqual({ offPeakMin: 120, peakMin: 0 });
  });
  it('à cheval : lundi 16h-18h (creuses jusqu à 17h)', () => {
    expect(splitOffPeakMinutes(OFF, d('2026-06-08T14:00:00Z'), d('2026-06-08T16:00:00Z'), TZ))
      .toEqual({ offPeakMin: 60, peakMin: 60 });
  });
  it('multi-plages : lundi 11h30-14h30 (creux 30 + plein 120 + creux 30)', () => {
    expect(splitOffPeakMinutes(OFF, d('2026-06-08T09:30:00Z'), d('2026-06-08T12:30:00Z'), TZ))
      .toEqual({ offPeakMin: 60, peakMin: 120 });
  });
  it('précision minute : 9h-10h avec creuses 9h30-12h15', () => {
    expect(splitOffPeakMinutes(OFF_MIN, d('2026-06-08T07:00:00Z'), d('2026-06-08T08:00:00Z'), TZ))
      .toEqual({ offPeakMin: 30, peakMin: 30 });
  });
  it('franchissement de minuit : lundi 23h → mardi 1h (creuses lundi 22h-24h seulement)', () => {
    const NIGHT = { 1: [{ start: 22, end: 24 }] };
    expect(splitOffPeakMinutes(NIGHT, d('2026-06-08T21:00:00Z'), d('2026-06-08T23:00:00Z'), TZ))
      .toEqual({ offPeakMin: 60, peakMin: 60 });
  });
  it('rien de configuré → tout plein', () => {
    expect(splitOffPeakMinutes(null, d('2026-06-08T14:00:00Z'), d('2026-06-08T16:00:00Z'), TZ))
      .toEqual({ offPeakMin: 0, peakMin: 120 });
  });
});

describe('slotPriceCents', () => {
  // 25 € le créneau plein (2500 c), 18 € le créneau creux (1800 c).
  it('créneau entièrement creux → tarif creux, quelle que soit la durée', () => {
    expect(slotPriceCents(OFF, d('2026-06-08T07:00:00Z'), d('2026-06-08T09:00:00Z'), TZ, 2500, 1800)).toBe(1800); // 2h
    expect(slotPriceCents(OFF, d('2026-06-08T07:00:00Z'), d('2026-06-08T08:00:00Z'), TZ, 2500, 1800)).toBe(1800); // 1h
  });
  it('créneau plein ou à cheval → tarif plein, quelle que soit la durée', () => {
    expect(slotPriceCents(OFF, d('2026-06-08T10:00:00Z'), d('2026-06-08T11:30:00Z'), TZ, 2500, 1800)).toBe(2500); // tout plein 1h30
    expect(slotPriceCents(OFF, d('2026-06-08T14:00:00Z'), d('2026-06-08T16:00:00Z'), TZ, 2500, 1800)).toBe(2500); // à cheval
  });
  it('pas de tarif creux → tarif plein, sans walk', () => {
    expect(slotPriceCents(OFF, d('2026-06-08T07:00:00Z'), d('2026-06-08T09:00:00Z'), TZ, 2500, null)).toBe(2500);
  });
  it('rien de configuré → tarif plein', () => {
    expect(slotPriceCents(null, d('2026-06-08T07:00:00Z'), d('2026-06-08T09:00:00Z'), TZ, 2500, 1800)).toBe(2500);
  });
});

describe('classifySlot', () => {
  it('OFF_PEAK ssi 100 % des minutes en creuses', () => {
    expect(classifySlot(OFF, d('2026-06-08T07:00:00Z'), d('2026-06-08T09:00:00Z'), TZ)).toBe('OFF_PEAK');
    expect(classifySlot(OFF, d('2026-06-08T14:00:00Z'), d('2026-06-08T16:00:00Z'), TZ)).toBe('PEAK'); // à cheval
    expect(classifySlot(OFF, d('2026-06-08T10:00:00Z'), d('2026-06-08T11:30:00Z'), TZ)).toBe('PEAK');
    expect(classifySlot(null, d('2026-06-08T07:00:00Z'), d('2026-06-08T09:00:00Z'), TZ)).toBe('PEAK');
  });
  it('précision minute : 9h30-12h15 creux → 9h30-10h30 OFF_PEAK, 9h-10h PEAK', () => {
    expect(classifySlot(OFF_MIN, d('2026-06-08T07:30:00Z'), d('2026-06-08T08:30:00Z'), TZ)).toBe('OFF_PEAK');
    expect(classifySlot(OFF_MIN, d('2026-06-08T07:00:00Z'), d('2026-06-08T08:00:00Z'), TZ)).toBe('PEAK');
  });
});

describe('effectiveSlotPriceCents', () => {
  const promo = (p: Partial<ActivePromo>): ActivePromo => ({
    name: 'P', kind: 'PERCENT', percentOff: null, fixedPriceCents: null,
    windowStart: null, windowEnd: null, resourceIds: [], ...p,
  });
  const S = d('2026-07-15T16:00:00Z'), E = d('2026-07-15T17:00:00Z'); // 18:00–19:00 Paris

  it('sans promo → prix de base, pas de nom', () => {
    expect(effectiveSlotPriceCents(2500, [], 'court-1', S, E, TZ)).toEqual({ priceCents: 2500 });
  });
  it('pourcentage → base × (100−p)/100 + nom', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ name: 'Été', percentOff: 20 })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 2000, promoName: 'Été' });
  });
  it('prix fixe → écrase la base', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ name: 'Fixe', kind: 'FIXED', fixedPriceCents: 1500 })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 1500, promoName: 'Fixe' });
  });
  it('prix fixe supérieur à la base → ignoré (min)', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ name: 'Cher', kind: 'FIXED', fixedPriceCents: 3000 })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 2500 });
  });
  it('ciblage : promo restreinte à un autre terrain → ignorée', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ percentOff: 50, resourceIds: ['court-2'] })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 2500 });
  });
  it('ciblage : promo restreinte au terrain courant → appliquée', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ name: 'C1', percentOff: 50, resourceIds: ['court-1'] })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 1250, promoName: 'C1' });
  });
  it('fenêtre : créneau entièrement dedans → appliquée', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ name: 'HH', percentOff: 20, windowStart: 1020, windowEnd: 1200 })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 2000, promoName: 'HH' });
  });
  it('fenêtre : créneau qui déborde → ignorée', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ percentOff: 20, windowStart: 1110, windowEnd: 1200 })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 2500 });
  });
  it('chevauchement → meilleur prix (le plus bas) gagne', () => {
    const promos = [promo({ name: 'A', percentOff: 20 }), promo({ name: 'B', kind: 'FIXED', fixedPriceCents: 1200 })];
    expect(effectiveSlotPriceCents(2500, promos, 'court-1', S, E, TZ)).toEqual({ priceCents: 1200, promoName: 'B' });
  });
});
