import { BILLING_STATE_LABEL, invoiceStatusLabel, intervalLabel, formatPeriod } from '@/lib/platformBilling';

describe('BILLING_STATE_LABEL', () => {
  it('couvre les 5 états', () => {
    expect(BILLING_STATE_LABEL.OK).toBe('Actif');
    expect(BILLING_STATE_LABEL.TO_REGULARIZE).toBe('À régulariser');
    expect(BILLING_STATE_LABEL.PAST_DUE).toBe('Impayé');
    expect(BILLING_STATE_LABEL.FREE).toBe('Gratuit');
    expect(BILLING_STATE_LABEL.EXEMPT).toBe('Exonéré');
  });
});

describe('invoiceStatusLabel', () => {
  it('traduit les statuts connus, repli sur la clé brute', () => {
    expect(invoiceStatusLabel('paid')).toBe('Payée');
    expect(invoiceStatusLabel('failed')).toBe('Échec');
    expect(invoiceStatusLabel('open')).toBe('En attente');
    expect(invoiceStatusLabel('mystere')).toBe('mystere');
  });
});

describe('intervalLabel', () => {
  it('mensuel/annuel/—', () => {
    expect(intervalLabel('month')).toBe('mensuel');
    expect(intervalLabel('year')).toBe('annuel');
    expect(intervalLabel(null)).toBe('—');
  });
});

describe('formatPeriod', () => {
  it('rend une plage, ou — si vide', () => {
    expect(formatPeriod(null, null)).toBe('—');
    const p = formatPeriod('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');
    expect(p).toContain('→');
  });
});
