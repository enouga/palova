import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { OfferService } from '../offer.service';

describe('OfferService.listPublicOffers', () => {
  let service: OfferService;
  beforeEach(() => { service = new OfferService(); });

  it('opt-out → listes vides sans énumération', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', showOffersPublicly: false, stripeAccountId: null, stripeAccountStatus: 'NONE' } as any);
    expect(await service.listPublicOffers('slug')).toEqual({ plans: [], packages: [], onlinePurchase: false });
  });

  it('opt-in → plans + packages actifs, onlinePurchase reflète Stripe ACTIVE', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', showOffersPublicly: true, stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE' } as any);
    prismaMock.subscriptionPlan.findMany.mockResolvedValue([{ id: 'pl1', name: 'Or', monthlyPrice: '39', commitmentMonths: 12 }] as any);
    prismaMock.packageTemplate.findMany.mockResolvedValue([{ id: 'tp1', name: 'Carnet 10', kind: 'ENTRIES', price: '90' }] as any);
    const r = await service.listPublicOffers('slug');
    expect(r.plans).toHaveLength(1);
    expect(r.packages).toHaveLength(1);
    expect(r.onlinePurchase).toBe(true);
    expect(prismaMock.subscriptionPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clubId: 'c1', isActive: true } }));
  });

  it('club suspendu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'SUSPENDED' } as any);
    await expect(service.listPublicOffers('slug')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});

describe('OfferService.fulfillPaidIntent', () => {
  let service: OfferService;
  beforeEach(() => {
    service = new OfferService();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  });
  const meta = { offerPlanId: 'pl1', offerUserId: 'u1', clubId: 'c1' };

  it('crée Subscription (snapshot) + Payment ONLINE avec receiptNo', async () => {
    prismaMock.payment.findFirst.mockResolvedValue(null as any);
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'pl1', clubId: 'c1', isActive: true, name: 'Or', monthlyPrice: '39',
      commitmentMonths: 12, sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED',
      discountPercent: null, dailyCap: null, weeklyCap: null,
    } as any);
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 7 } as any);
    prismaMock.subscription.create.mockResolvedValue({ id: 'sub1' } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay1' } as any);
    const r = await service.fulfillPaidIntent(meta, 'pi_1', 3900);
    expect(r).toEqual({ kind: 'plan', id: 'sub1' });
    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: 'pi_1', receiptNo: 7, subscriptionId: 'sub1' }),
    }));
  });

  it('idempotent : Payment existant pour ce PaymentIntent → null, rien créé', async () => {
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay1' } as any);
    expect(await service.fulfillPaidIntent(meta, 'pi_1', 3900)).toBeNull();
    expect(prismaMock.subscription.create).not.toHaveBeenCalled();
  });

  it('carnet : crée MemberPackage avec crédits + expiration validityDays', async () => {
    prismaMock.payment.findFirst.mockResolvedValue(null as any);
    prismaMock.packageTemplate.findUnique.mockResolvedValue({
      id: 'tp1', clubId: 'c1', isActive: true, name: 'Carnet 10', kind: 'ENTRIES',
      price: '90', entriesCount: 10, walletAmount: null, validityDays: 365,
    } as any);
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 8 } as any);
    prismaMock.memberPackage.create.mockResolvedValue({ id: 'pkg1' } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay2' } as any);
    const r = await service.fulfillPaidIntent({ offerPackageTemplateId: 'tp1', offerUserId: 'u1', clubId: 'c1' }, 'pi_2', 9000);
    expect(r).toEqual({ kind: 'package', id: 'pkg1' });
    expect(prismaMock.memberPackage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ creditsTotal: 10, creditsRemaining: 10 }),
    }));
  });

  it('plan désactivé entre intent et confirm → OFFER_NOT_FOUND', async () => {
    prismaMock.payment.findFirst.mockResolvedValue(null as any);
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({ id: 'pl1', clubId: 'c1', isActive: false } as any);
    await expect(service.fulfillPaidIntent(meta, 'pi_3', 3900)).rejects.toThrow('OFFER_NOT_FOUND');
  });
});
