import fs from 'fs';
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

  it('stocke la description complète (trim), null si absente', async () => {
    prismaMock.subscriptionPlan.create.mockResolvedValue({ id: 'plan-2' } as any);
    await service.createPlan('club-1', {
      name: 'Abo Padel', sportKeys: ['padel'], monthlyPrice: 69, commitmentMonths: 12, benefit: 'INCLUDED',
      description: '  Accès illimité en heures creuses.  ',
    });
    expect(prismaMock.subscriptionPlan.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: 'Accès illimité en heures creuses.' }),
    }));
    await service.createPlan('club-1', { name: 'x', sportKeys: ['padel'], monthlyPrice: 69, commitmentMonths: 12, benefit: 'INCLUDED' });
    expect(prismaMock.subscriptionPlan.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: null }),
    }));
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

  it('met à jour la description (efface si chaîne vide)', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'plan-1', clubId: 'club-1', name: 'Abo', sportKeys: ['padel'], monthlyPrice: 69,
      commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null,
    } as any);
    prismaMock.subscriptionPlan.update.mockResolvedValue({ id: 'plan-1' } as any);
    await service.updatePlan('plan-1', 'club-1', { description: 'Nouveau texte' });
    expect(prismaMock.subscriptionPlan.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: 'Nouveau texte' }),
    }));
    await service.updatePlan('plan-1', 'club-1', { description: '   ' });
    expect(prismaMock.subscriptionPlan.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: null }),
    }));
  });

  it('updatePlan avec imageUrl:null supprime le fichier existant', async () => {
    const unlink = jest.spyOn(fs.promises, 'unlink').mockResolvedValue();
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'plan-1', clubId: 'club-1', name: 'Abo', sportKeys: ['padel'], monthlyPrice: 69,
      commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null,
      imageUrl: '/uploads/offers/plan-1-111.jpg',
    } as any);
    prismaMock.subscriptionPlan.update.mockResolvedValue({ id: 'plan-1' } as any);
    await service.updatePlan('plan-1', 'club-1', { imageUrl: null });
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('plan-1-111.jpg'));
    expect(prismaMock.subscriptionPlan.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageUrl: null }),
    }));
    unlink.mockRestore();
  });

  it('setImage pose la nouvelle URL et supprime l’ancien fichier uploadé', async () => {
    const unlink = jest.spyOn(fs.promises, 'unlink').mockResolvedValue();
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan-1', clubId: 'club-1', imageUrl: '/uploads/offers/plan-1-111.jpg' } as any);
    prismaMock.subscriptionPlan.update.mockResolvedValue({ id: 'plan-1', imageUrl: '/uploads/offers/plan-1-222.jpg' } as any);
    await service.setImage('plan-1', 'club-1', '/uploads/offers/plan-1-222.jpg');
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('plan-1-111.jpg'));
    expect(prismaMock.subscriptionPlan.update).toHaveBeenCalledWith({ where: { id: 'plan-1' }, data: { imageUrl: '/uploads/offers/plan-1-222.jpg' } });
    unlink.mockRestore();
  });

  it('setImage refuse un plan d’un autre club', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan-1', clubId: 'autre' } as any);
    await expect(service.setImage('plan-1', 'club-1', '/uploads/offers/x.jpg')).rejects.toThrow('PLAN_NOT_FOUND');
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

describe('SubscriptionService — listes & cancel', () => {
  let service: SubscriptionService;
  beforeEach(() => { service = new SubscriptionService(); });

  it('listMySubscriptionsBySlug : club ACTIVE, abos ACTIVE non expirés', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.subscription.findMany.mockResolvedValue([{ id: 'sub-1' }] as any);
    const out = await service.listMySubscriptionsBySlug('mon-club', 'user-1');
    expect(out).toHaveLength(1);
    const where = prismaMock.subscription.findMany.mock.calls[0]![0]!.where as any;
    expect(where.clubId).toBe('club-1');
    expect(where.userId).toBe('user-1');
    expect(where.status).toBe('ACTIVE');
    expect(where.expiresAt).toHaveProperty('gt');
  });

  it('listMySubscriptionsBySlug : club inconnu/suspendu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'SUSPENDED' } as any);
    await expect(service.listMySubscriptionsBySlug('x', 'user-1')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('cancelSubscription : passe en CANCELLED', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: 'sub-1', clubId: 'club-1' } as any);
    prismaMock.subscription.update.mockResolvedValue({ id: 'sub-1', status: 'CANCELLED' } as any);
    await service.cancelSubscription('sub-1', 'club-1');
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({ where: { id: 'sub-1' }, data: { status: 'CANCELLED' } });
  });

  it('cancelSubscription : autre club → SUBSCRIPTION_NOT_FOUND', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: 'sub-1', clubId: 'autre' } as any);
    await expect(service.cancelSubscription('sub-1', 'club-1')).rejects.toThrow('SUBSCRIPTION_NOT_FOUND');
  });
});

describe('SubscriptionService.coverageFor', () => {
  const incl = { sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED' as const, discountPercent: null };
  const disc = { sportKeys: ['padel'], offPeakOnly: true, benefit: 'DISCOUNT' as const, discountPercent: 50 };

  it('INCLUDED creux → couvert, coverCents = dû', () => {
    expect(SubscriptionService.coverageFor(incl, { sportKey: 'padel', isOffPeak: true, dueCents: 1300 }))
      .toEqual({ covered: true, coverCents: 1300 });
  });

  it('offPeakOnly + créneau plein → non couvert', () => {
    expect(SubscriptionService.coverageFor(incl, { sportKey: 'padel', isOffPeak: false, dueCents: 1300 }))
      .toEqual({ covered: false, coverCents: 0 });
  });

  it('sport hors liste → non couvert', () => {
    expect(SubscriptionService.coverageFor(incl, { sportKey: 'squash', isOffPeak: true, dueCents: 1300 }))
      .toEqual({ covered: false, coverCents: 0 });
  });

  it('DISCOUNT 50 % → coverCents = moitié (arrondi)', () => {
    expect(SubscriptionService.coverageFor(disc, { sportKey: 'padel', isOffPeak: true, dueCents: 1300 }))
      .toEqual({ covered: true, coverCents: 650 });
  });
});
