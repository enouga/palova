import { eurosFromCents, paymentMethodLabel, cardLabel } from '@/lib/payments';

describe('eurosFromCents', () => {
  it('formate en euros virgule', () => {
    expect(eurosFromCents(2500)).toBe('25,00 €');
    expect(eurosFromCents(0)).toBe('0,00 €');
    expect(eurosFromCents(1234)).toBe('12,34 €');
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
