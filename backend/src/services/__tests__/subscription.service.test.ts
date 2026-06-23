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
