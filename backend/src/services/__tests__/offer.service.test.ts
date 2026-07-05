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
