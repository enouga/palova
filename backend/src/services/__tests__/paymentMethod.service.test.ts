import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const getCardDetails = jest.fn();
const detachCard = jest.fn();
jest.mock('../stripe.service', () => ({
  StripeService: jest.fn().mockImplementation(() => ({ getCardDetails, detachCard })),
}));

import { PaymentMethodService } from '../paymentMethod.service';

const ACTIVE = { id: 'club-1', status: 'ACTIVE' };

beforeEach(() => { getCardDetails.mockReset(); detachCard.mockReset(); });

describe('PaymentMethodService.getMyPaymentMethod', () => {
  it('null si aucune carte (defaultPaymentMethodId null)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: null } as any);
    expect(await new PaymentMethodService().getMyPaymentMethod('demo', 'u1')).toBeNull();
  });

  it('renvoie les détails stockés sans appeler Stripe', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({
      defaultPaymentMethodId: 'pm_1', cardBrand: 'visa', cardLast4: '4242', cardExpMonth: 4, cardExpYear: 2027,
    } as any);
    const res = await new PaymentMethodService().getMyPaymentMethod('demo', 'u1');
    expect(res).toEqual({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2027 });
    expect(getCardDetails).not.toHaveBeenCalled();
  });

  it('backfill depuis Stripe quand last4 absent (carte legacy)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: 'pm_1', cardLast4: null } as any);
    getCardDetails.mockResolvedValue({ brand: 'mastercard', last4: '1111', expMonth: 1, expYear: 2030 });
    prismaMock.clubStripeCustomer.update.mockResolvedValue({} as any);
    const res = await new PaymentMethodService().getMyPaymentMethod('demo', 'u1');
    expect(getCardDetails).toHaveBeenCalledWith('club-1', 'pm_1');
    expect(prismaMock.clubStripeCustomer.update).toHaveBeenCalled();
    expect(res).toEqual({ brand: 'mastercard', last4: '1111', expMonth: 1, expYear: 2030 });
  });

  it('forme dégradée non bloquante si Stripe échoue au backfill', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: 'pm_1', cardLast4: null } as any);
    getCardDetails.mockRejectedValue(new Error('stripe down'));
    const res = await new PaymentMethodService().getMyPaymentMethod('demo', 'u1');
    expect(res).toEqual({ brand: null, last4: null, expMonth: null, expYear: null });
  });

  it('CLUB_NOT_FOUND si club inexistant ou suspendu', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(new PaymentMethodService().getMyPaymentMethod('demo', 'u1')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});

describe('PaymentMethodService.removeMyPaymentMethod', () => {
  it('détache puis nullifie la carte', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: 'pm_1' } as any);
    detachCard.mockResolvedValue(undefined);
    prismaMock.clubStripeCustomer.update.mockResolvedValue({} as any);
    const res = await new PaymentMethodService().removeMyPaymentMethod('demo', 'u1');
    expect(detachCard).toHaveBeenCalledWith('club-1', 'pm_1');
    expect(prismaMock.clubStripeCustomer.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { defaultPaymentMethodId: null, cardBrand: null, cardLast4: null, cardExpMonth: null, cardExpYear: null },
    }));
    expect(res).toEqual({ ok: true });
  });

  it('nullifie même si le détachement Stripe échoue (best-effort)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: 'pm_1' } as any);
    detachCard.mockRejectedValue(new Error('already detached'));
    prismaMock.clubStripeCustomer.update.mockResolvedValue({} as any);
    const res = await new PaymentMethodService().removeMyPaymentMethod('demo', 'u1');
    expect(prismaMock.clubStripeCustomer.update).toHaveBeenCalled();
    expect(res).toEqual({ ok: true });
  });

  it('ok:true sans rien faire si aucune carte', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: null } as any);
    const res = await new PaymentMethodService().removeMyPaymentMethod('demo', 'u1');
    expect(detachCard).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true });
  });
});
