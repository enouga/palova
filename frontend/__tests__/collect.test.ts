import { overlapsHourWindow, statusFilter, matchesQuery, presetWindow, hasAnyMethod, isUpcoming, nextSlotWindow, isNextSlot } from '@/lib/collect';

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

describe('statusFilter', () => {
  it('all : garde toutes les non-annulées, exclut les annulées', () => {
    expect(statusFilter('all', 5200, 0, false)).toBe(true);
    expect(statusFilter('all', 5200, 5200, false)).toBe(true);
    expect(statusFilter('all', 5200, 0, true)).toBe(false);     // annulée masquée par défaut
  });
  it('unpaid : dû > 0 et rien encaissé', () => {
    expect(statusFilter('unpaid', 5200, 0, false)).toBe(true);
    expect(statusFilter('unpaid', 5200, 1000, false)).toBe(false);  // acompte → partiel, pas « non payé »
    expect(statusFilter('unpaid', 5200, 5200, false)).toBe(false);  // soldé → non
    expect(statusFilter('unpaid', 0, 0, false)).toBe(false);        // rien à payer → non
    expect(statusFilter('unpaid', 5200, 0, true)).toBe(false);      // annulée → jamais
  });
  it('partial : un acompte mais reste dû', () => {
    expect(statusFilter('partial', 5200, 1000, false)).toBe(true);
    expect(statusFilter('partial', 5200, 0, false)).toBe(false);    // rien payé → non
    expect(statusFilter('partial', 5200, 5200, false)).toBe(false); // soldé → non
  });
  it('paid : payant et soldé', () => {
    expect(statusFilter('paid', 5200, 5200, false)).toBe(true);
    expect(statusFilter('paid', 5200, 6000, false)).toBe(true);     // trop-perçu = soldé
    expect(statusFilter('paid', 5200, 1000, false)).toBe(false);    // partiel → non
    expect(statusFilter('paid', 0, 0, false)).toBe(false);          // rien à payer → non
  });
  it('cancelled : uniquement les annulées', () => {
    expect(statusFilter('cancelled', 5200, 0, true)).toBe(true);
    expect(statusFilter('cancelled', 5200, 0, false)).toBe(false);
  });
});

describe('presetWindow', () => {
  it('matin = ouverture → 12h', () => {
    expect(presetWindow('morning', 8, 22, 14)).toEqual([8, 12]);
  });
  it('après-midi = 12h → 18h', () => {
    expect(presetWindow('afternoon', 8, 22, 14)).toEqual([12, 18]);
  });
  it('soir = 18h → fermeture', () => {
    expect(presetWindow('evening', 8, 22, 14)).toEqual([18, 22]);
  });
  it('maintenant = créneau courant [h, h+1], borné aux horaires', () => {
    expect(presetWindow('now', 8, 22, 14)).toEqual([14, 15]);
    expect(presetWindow('now', 8, 22, 6)).toEqual([8, 9]);    // avant ouverture → ouverture
    expect(presetWindow('now', 8, 22, 23)).toEqual([21, 22]); // après fermeture → dernier créneau
  });
});

describe('hasAnyMethod', () => {
  const pays = [{ method: 'CARD' }, { method: 'CASH' }];
  it('ensemble vide = aucun filtre, tout passe', () => {
    expect(hasAnyMethod([], new Set())).toBe(true);
    expect(hasAnyMethod(pays, new Set())).toBe(true);
  });
  it('garde si au moins un paiement correspond', () => {
    expect(hasAnyMethod(pays, new Set(['CARD']))).toBe(true);
    expect(hasAnyMethod(pays, new Set(['VOUCHER']))).toBe(false);
  });
  it('aucun paiement → faux dès qu’un moyen est demandé', () => {
    expect(hasAnyMethod([], new Set(['CARD']))).toBe(false);
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
  it('cherche aussi dans les joueurs ajoutés (participants)', () => {
    const withParts = { title: null, user: { firstName: 'Jean', lastName: 'Titulaire', email: 'j@x.fr' },
      participants: [{ firstName: 'Sophie', lastName: 'Durand' }, { firstName: 'Karim', lastName: 'Benali' }] };
    expect(matchesQuery(withParts, 'durand')).toBe(true);
    expect(matchesQuery(withParts, 'karim')).toBe(true);
    expect(matchesQuery(withParts, 'inconnu')).toBe(false);
  });
});

describe('isUpcoming', () => {
  const NOW = Date.parse('2026-06-24T16:00:00.000Z');
  it('garde un créneau dont la fin est dans le futur', () => {
    expect(isUpcoming({ endTime: '2026-06-24T17:00:00.000Z' }, NOW)).toBe(true);
  });
  it('garde un créneau EN COURS (commencé mais pas fini)', () => {
    expect(isUpcoming({ endTime: '2026-06-24T16:30:00.000Z' }, NOW)).toBe(true);
  });
  it('masque un créneau déjà terminé', () => {
    expect(isUpcoming({ endTime: '2026-06-24T15:00:00.000Z' }, NOW)).toBe(false);
  });
  it("garde tout quand l'heure courante est inconnue (null)", () => {
    expect(isUpcoming({ endTime: '2020-01-01T00:00:00.000Z' }, null)).toBe(true);
  });
});

describe('nextSlotWindow', () => {
  const NOW = Date.parse('2026-06-24T16:10:00.000Z');   // 16:10 UTC
  const at = (iso: string) => Date.parse(iso);
  it('borne haute = prochain départ ≥ now ; borne basse = now − 20 min', () => {
    const starts = [at('2026-06-24T16:00:00.000Z'), at('2026-06-24T16:30:00.000Z'), at('2026-06-24T17:30:00.000Z')];
    expect(nextSlotWindow(starts, NOW)).toEqual([NOW - 20 * 60_000, at('2026-06-24T16:30:00.000Z')]);
  });
  it('aucun départ futur → borne haute = now', () => {
    expect(nextSlotWindow([at('2026-06-24T15:00:00.000Z')], NOW)).toEqual([NOW - 20 * 60_000, NOW]);
  });
  it('liste vide → [now − 20 min, now]', () => {
    expect(nextSlotWindow([], NOW)).toEqual([NOW - 20 * 60_000, NOW]);
  });
  it('marge paramétrable', () => {
    expect(nextSlotWindow([], NOW, 5)).toEqual([NOW - 5 * 60_000, NOW]);
  });
});

describe('isNextSlot', () => {
  const NOW = Date.parse('2026-06-24T16:10:00.000Z');
  const win: [number, number] = [NOW - 20 * 60_000, Date.parse('2026-06-24T16:30:00.000Z')];
  it('start dans la fenêtre → true (bornes incluses)', () => {
    expect(isNextSlot({ startTime: '2026-06-24T16:00:00.000Z' }, win)).toBe(true);   // retardataire ≤ 20 min
    expect(isNextSlot({ startTime: '2026-06-24T16:30:00.000Z' }, win)).toBe(true);   // prochain départ (borne haute)
    expect(isNextSlot({ startTime: '2026-06-24T15:50:00.000Z' }, win)).toBe(true);   // borne basse exacte
  });
  it('start hors fenêtre → false', () => {
    expect(isNextSlot({ startTime: '2026-06-24T15:40:00.000Z' }, win)).toBe(false);  // > 20 min de retard
    expect(isNextSlot({ startTime: '2026-06-24T17:30:00.000Z' }, win)).toBe(false);  // après le prochain départ
  });
  it('window null → true (pré-hydratation)', () => {
    expect(isNextSlot({ startTime: '2000-01-01T00:00:00.000Z' }, null)).toBe(true);
  });
});
