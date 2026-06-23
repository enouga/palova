import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { SubscriptionService } from '../subscription.service';

const SPORTS = [{ key: 'padel' }, { key: 'squash' }];

describe('SubscriptionService — createPlan', () => {
  let service: SubscriptionService;
  beforeEach(() => {
    service = new SubscriptionService();
    prismaMock.sport.findMany.mockResolvedValue(SPORTS as any);
  });

  it('crée un plan INCLUDED valide', async () => {
    prismaMock.subscriptionPlan.create.mockResolvedValue({ id: 'plan-1' } as any);
    await service.createPlan('club-1', {
      name: 'Abo Padel', sportKeys: ['padel'], monthlyPrice: 69, commitmentMonths: 12,
      offPeakOnly: true, benefit: 'INCLUDED',
    });
    expect(prismaMock.subscriptionPlan.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clubId: 'club-1', sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null,
      }),
    }));
  });

  it('exige discountPercent (1..100) si DISCOUNT', async () => {
    await expect(service.createPlan('club-1', {
      name: 'x', sportKeys: ['padel'], monthlyPrice: 69, commitmentMonths: 12, benefit: 'DISCOUNT',
    })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.createPlan('club-1', {
      name: 'x', sportKeys: ['padel'], monthlyPrice: 69, commitmentMonths: 12, benefit: 'DISCOUNT', discountPercent: 150,
    })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse un sportKey hors catalogue', async () => {
    await expect(service.createPlan('club-1', {
      name: 'x', sportKeys: ['tennis'], monthlyPrice: 69, commitmentMonths: 12, benefit: 'INCLUDED',
    })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse sportKeys vide, prix ≤ 0, engagement < 1, cap ≤ 0', async () => {
    const base = { name: 'x', sportKeys: ['padel'], monthlyPrice: 69, commitmentMonths: 12, benefit: 'INCLUDED' as const };
    await expect(service.createPlan('club-1', { ...base, sportKeys: [] })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.createPlan('club-1', { ...base, monthlyPrice: 0 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.createPlan('club-1', { ...base, commitmentMonths: 0 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.createPlan('club-1', { ...base, dailyCap: 0 })).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('SubscriptionService — updatePlan', () => {
  let service: SubscriptionService;
  beforeEach(() => {
    service = new SubscriptionService();
    prismaMock.sport.findMany.mockResolvedValue(SPORTS as any);
  });

  it('refuse un plan d\'un autre club', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan-1', clubId: 'autre' } as any);
    await expect(service.updatePlan('plan-1', 'club-1', { isActive: false })).rejects.toThrow('PLAN_NOT_FOUND');
  });

  it('met à jour les champs fournis (avec revalidation)', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'plan-1', clubId: 'club-1', name: 'Abo', sportKeys: ['padel'], monthlyPrice: 69,
      commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null,
    } as any);
    prismaMock.subscriptionPlan.update.mockResolvedValue({ id: 'plan-1' } as any);
    await service.updatePlan('plan-1', 'club-1', { monthlyPrice: 75, isActive: false });
    const data = prismaMock.subscriptionPlan.update.mock.calls[0][0].data as any;
    expect(Number(data.monthlyPrice)).toBe(75);
    expect(data.isActive).toBe(false);
  });
});

describe('SubscriptionService — sellSubscription', () => {
  let service: SubscriptionService;
  const plan = {
    id: 'plan-1', clubId: 'club-1', name: 'Abo Padel', sportKeys: ['padel'], monthlyPrice: 69,
    commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null,
    dailyCap: null, weeklyCap: null, isActive: true,
  };
  beforeEach(() => {
    service = new SubscriptionService();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
  });

  it('crée la Subscription (snapshot figé) + le Payment de vente = 1re mensualité', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue(plan as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1' } as any);
    prismaMock.subscription.create.mockResolvedValue({ id: 'sub-1' } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);

    const out = await service.sellSubscription('club-1', 'user-1', { planId: 'plan-1', method: 'CARD', createdByUserId: 'admin-1' });

    const subData = prismaMock.subscription.create.mock.calls[0][0].data as any;
    expect(subData).toEqual(expect.objectContaining({
      clubId: 'club-1', userId: 'user-1', planId: 'plan-1', status: 'ACTIVE',
      sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null,
    }));
    expect(subData.expiresAt).toBeInstanceOf(Date);
    expect(Number(subData.monthlyPriceSnapshot)).toBe(69);

    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubId: 'club-1', subscriptionId: 'sub-1', method: 'CARD', receiptNo: 1 }),
    }));
    expect(out.subscription.id).toBe('sub-1');
  });

  it('refuse un plan inactif / autre club', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({ ...plan, isActive: false } as any);
    await expect(service.sellSubscription('club-1', 'user-1', { planId: 'plan-1' })).rejects.toThrow('PLAN_NOT_FOUND');
  });

  it('refuse un non-membre', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue(plan as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null);
    await expect(service.sellSubscription('club-1', 'user-1', { planId: 'plan-1' })).rejects.toThrow('MEMBER_NOT_FOUND');
  });
});
