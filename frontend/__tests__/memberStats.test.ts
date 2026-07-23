import {
  methodLabel, monthShort, weekdayLabel, winRate, lastVisitLabel, cancellationLabel, tenureLabel,
  revenueChartModel, heatmapModel, donutSegments,
  memberAlerts, reservationPaymentBadge, matchOutcome,
} from '@/lib/memberStats';

describe('libellés', () => {
  it('monthShort parse "yyyy-MM" sans Date', () => {
    expect(monthShort('2026-06')).toBe('juin');
    expect(monthShort('2026-01')).toBe('janv.');
  });
  it('weekdayLabel : 1=lundi … 7=dimanche', () => {
    expect(weekdayLabel(1)).toBe('lundi');
    expect(weekdayLabel(7)).toBe('dimanche');
  });
  it('methodLabel : connu → FR, inconnu → clé brute', () => {
    expect(methodLabel('CASH')).toBe('Espèces');
    expect(methodLabel('PACK_CREDIT')).toBe('Carnet');
    expect(methodLabel('ZZZ')).toBe('ZZZ');
  });
  it('winRate : null si aucun match', () => {
    expect(winRate(3, 1)).toBe(75);
    expect(winRate(0, 0)).toBeNull();
  });
  it('lastVisitLabel', () => {
    expect(lastVisitLabel(null)).toBeNull();
    expect(lastVisitLabel(0)).toBe("Vu aujourd'hui");
    expect(lastVisitLabel(1)).toBe('Vu hier');
    expect(lastVisitLabel(5)).toBe('Vu il y a 5 j');
  });
  it('cancellationLabel + tenureLabel', () => {
    expect(cancellationLabel(0.5)).toBe('50 %');
    expect(tenureLabel(800)).toBe('2 ans');
    expect(tenureLabel(400)).toBe('1 an');
    expect(tenureLabel(90)).toBe('3 mois');
    expect(tenureLabel(10)).toBe('10 j');
  });
});

describe('revenueChartModel', () => {
  it('auto-zoom : la plus grande barre fait toute la hauteur, les autres au prorata', () => {
    const m = revenueChartModel([{ month: '2026-05', net: '10.00' }, { month: '2026-06', net: '20.00' }], 100, 100);
    expect(m.max).toBe(2000);
    expect(m.bars).toHaveLength(2);
    expect(m.bars[1].h).toBeCloseTo(100);
    expect(m.bars[0].h).toBeCloseTo(50);
    expect(m.bars[0].label).toBe('mai');
  });
  it('série vide → max 0, aucune barre', () => {
    const m = revenueChartModel([], 100, 100);
    expect(m.max).toBe(0);
    expect(m.bars).toHaveLength(0);
  });
});

describe('heatmapModel', () => {
  it('trouve le max et la cellule de pointe', () => {
    const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
    matrix[0][10] = 2;
    matrix[2][18] = 5;
    const m = heatmapModel(matrix);
    expect(m.max).toBe(5);
    expect(m.peak).toEqual({ weekday: 3, hour: 18, count: 5 });
  });
  it('matrice vide → max 0, peak null', () => {
    const m = heatmapModel(Array.from({ length: 7 }, () => new Array(24).fill(0)));
    expect(m.max).toBe(0);
    expect(m.peak).toBeNull();
  });
});

describe('donutSegments', () => {
  it('fractions triées décroissantes, somme = 1, tirets couvrant le périmètre', () => {
    const { total, circumference, segments } = donutSegments({ CASH: '30.00', CARD: '10.00' }, 52);
    expect(total).toBe(4000);
    expect(segments).toHaveLength(2);
    expect(segments[0].key).toBe('CASH');
    expect(segments[0].fraction).toBeCloseTo(0.75);
    expect(segments[1].fraction).toBeCloseTo(0.25);
    expect(segments.reduce((s, x) => s + x.fraction, 0)).toBeCloseTo(1);
    expect(segments[0].dashOffset).toBe(-0);
    expect(segments[1].dashOffset).toBeCloseTo(-0.75 * circumference);
  });
  it('ignore les méthodes à 0 et le vide', () => {
    expect(donutSegments({}, 52).segments).toHaveLength(0);
    expect(donutSegments({ CASH: '0.00' }, 52).segments).toHaveLength(0);
  });
});

describe('memberAlerts', () => {
  const base = { outstandingCents: 0, balances: [], subscriptionExpiresAt: null as string | null };
  const now = new Date('2026-07-23T10:00:00Z');
  it('reste dû → alerte coral', () => {
    expect(memberAlerts({ ...base, outstandingCents: 1200 }, now)).toContainEqual(
      expect.objectContaining({ key: 'outstanding', label: '12,00 € dus' }));
  });
  it('carnet presque vide (≤ 2 entrées)', () => {
    const balances = [{ kind: 'ENTRIES' as const, name: 'Carnet 10', creditsRemaining: 2, amountRemaining: null, expiresAt: null }];
    expect(memberAlerts({ ...base, balances }, now).map((a) => a.key)).toContain('lowPackage');
  });
  it('abonnement qui expire sous 30 jours', () => {
    expect(memberAlerts({ ...base, subscriptionExpiresAt: '2026-08-10T00:00:00Z' }, now).map((a) => a.key)).toContain('subExpiring');
    expect(memberAlerts({ ...base, subscriptionExpiresAt: '2026-12-01T00:00:00Z' }, now)).toEqual([]);
  });
});

describe('reservationPaymentBadge / matchOutcome', () => {
  it('payé / reste dû / annulée', () => {
    expect(reservationPaymentBadge({ status: 'CONFIRMED', attributedCents: 2500, dueCents: 2500 })).toEqual({ label: 'Payé 25,00 € ✓', tone: 'ok' });
    expect(reservationPaymentBadge({ status: 'CONFIRMED', attributedCents: 1300, dueCents: 2500 })).toEqual({ label: 'Reste 12,00 €', tone: 'due' });
    expect(reservationPaymentBadge({ status: 'CANCELLED', attributedCents: 0, dueCents: 2500 })).toEqual({ label: 'Annulée', tone: 'off' });
  });
  it('résultat V/D depuis le match', () => {
    expect(matchOutcome({ winningTeam: 1, myTeam: 1, sets: [[6, 3], [6, 4]], competitive: true })).toEqual({ won: true, score: '6-3 6-4' });
    expect(matchOutcome({ winningTeam: 2, myTeam: 1, sets: [[4, 6]], competitive: true })).toEqual({ won: false, score: '4-6' });
    expect(matchOutcome(null)).toBeNull();
  });
});
