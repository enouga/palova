import { eurosFromCents, eurosFromString, eurosCompact, eurosTrim, paymentMethodLabel, cardLabel } from '@/lib/payments';

describe('eurosFromCents', () => {
  it('formate en euros virgule', () => {
    expect(eurosFromCents(2500)).toBe('25,00 €');
    expect(eurosFromCents(0)).toBe('0,00 €');
    expect(eurosFromCents(1234)).toBe('12,34 €');
  });
});

describe('eurosFromString', () => {
  it('formate une chaîne décimale (Decimal Prisma sérialisé)', () => {
    expect(eurosFromString('25.00')).toBe('25,00 €');
    expect(eurosFromString('12.5')).toBe('12,50 €');
  });
});

describe('eurosCompact', () => {
  it('sans décimales inutiles + séparateur de milliers', () => {
    expect(eurosCompact(2900)).toBe('29 €');
    expect(eurosCompact(101000)).toBe('1 010 €');
    expect(eurosCompact(2950)).toBe('29,50 €');
  });
});

describe('eurosTrim', () => {
  it('sans le signe €, entier ou virgule selon le cas', () => {
    expect(eurosTrim(25)).toBe('25');
    expect(eurosTrim('25')).toBe('25');
    expect(eurosTrim(25.5)).toBe('25,50');
    expect(eurosTrim('25.5')).toBe('25,50');
  });
});

describe('paymentMethodLabel', () => {
  it('libellés FR', () => {
    expect(paymentMethodLabel('CARD')).toBe('Carte');
    expect(paymentMethodLabel('CASH')).toBe('Espèces');
    expect(paymentMethodLabel('VOUCHER')).toBe('Ticket CE');
    expect(paymentMethodLabel('ONLINE')).toBe('Carte en ligne');
  });
});

describe('cardLabel', () => {
  it('marque + 4 chiffres + expiration', () => {
    expect(cardLabel({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2027 })).toBe('Visa •••• 4242 · exp 04/2027');
  });
  it('repli quand détails partiels', () => {
    expect(cardLabel({ brand: null, last4: null, expMonth: null, expYear: null })).toBe('Carte enregistrée');
  });
});
