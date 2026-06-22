import { overlapsHourWindow, outstandingFilter, matchesQuery } from '@/lib/collect';

const TZ = 'Europe/Paris';
// jeudi 22/06/2026 18h-19h Paris (UTC+2) = 16:00Z-17:00Z
const rv = { startTime: '2026-06-22T16:00:00.000Z', endTime: '2026-06-22T17:00:00.000Z' };

describe('overlapsHourWindow', () => {
  it('vrai si le créneau recoupe la fenêtre', () => {
    expect(overlapsHourWindow(rv, 18, 22, TZ)).toBe(true);  // créneau 18-19 ⊂ [18,22)
    expect(overlapsHourWindow(rv, 17, 22, TZ)).toBe(true);  // [17,22) couvre 18-19
  });
  it('faux si la fenêtre est entièrement avant ou après', () => {
    expect(overlapsHourWindow(rv, 8, 12, TZ)).toBe(false);  // fenêtre avant le créneau
    expect(overlapsHourWindow(rv, 19, 22, TZ)).toBe(false); // créneau finit à 19 = borne basse exclue
  });
});

describe('outstandingFilter', () => {
  it('mode "due" garde les restes dus non annulés', () => {
    expect(outstandingFilter('due', 5200, 0, false)).toBe(true);
    expect(outstandingFilter('due', 5200, 5200, false)).toBe(false);
    expect(outstandingFilter('due', 5200, 0, true)).toBe(false);
  });
  it('mode "paid" garde les soldés payants', () => {
    expect(outstandingFilter('paid', 5200, 5200, false)).toBe(true);
    expect(outstandingFilter('paid', 0, 0, false)).toBe(false);
  });
  it('mode "all" garde tout', () => {
    expect(outstandingFilter('all', 0, 0, true)).toBe(true);
  });
});

describe('matchesQuery', () => {
  const r = { title: null, user: { firstName: 'Élodie', lastName: 'Martin', email: 'e@x.fr' } };
  it('insensible casse/accents sur nom', () => {
    expect(matchesQuery(r, 'elodie')).toBe(true);
    expect(matchesQuery(r, 'MARTIN')).toBe(true);
  });
  it('cherche aussi dans l\'intitulé et vide = tout', () => {
    expect(matchesQuery({ title: 'Tournoi P100', user: null }, 'p100')).toBe(true);
    expect(matchesQuery(r, '')).toBe(true);
  });
});
