import { Prisma, PaymentMethod, SubscriptionBenefit } from '@prisma/client';
import { prisma } from '../db/prisma';
import { PackageService } from './package.service';

/** Méthodes acceptées pour encaisser la VENTE d'un abonnement (1re mensualité). */
const SALE_METHODS = ['CASH', 'CARD', 'TRANSFER', 'VOUCHER', 'OTHER'] as const;

type PlanBody = {
  name?: string; sportKeys?: string[]; monthlyPrice?: number; commitmentMonths?: number;
  offPeakOnly?: boolean; benefit?: string; discountPercent?: number | null;
  dailyCap?: number | null; weeklyCap?: number | null;
};

export class SubscriptionService {
  /** Valide un corps de plan (création/màj). Lève VALIDATION_ERROR. */
  private async validatePlan(body: PlanBody): Promise<void> {
    const { name, sportKeys, monthlyPrice, commitmentMonths, benefit, discountPercent, dailyCap, weeklyCap } = body;
    if (!name?.trim())                                                   throw new Error('VALIDATION_ERROR');
    if (!Array.isArray(sportKeys) || sportKeys.length === 0)             throw new Error('VALIDATION_ERROR');
    const known = await prisma.sport.findMany({ where: { key: { in: sportKeys } }, select: { key: true } });
    const knownKeys = new Set(known.map(s => s.key));
    if (!sportKeys.every(k => knownKeys.has(k)))                        throw new Error('VALIDATION_ERROR');
    if (typeof monthlyPrice !== 'number' || isNaN(monthlyPrice) || monthlyPrice <= 0) throw new Error('VALIDATION_ERROR');
    if (!Number.isInteger(commitmentMonths) || (commitmentMonths as number) < 1)      throw new Error('VALIDATION_ERROR');
    if (benefit !== 'INCLUDED' && benefit !== 'DISCOUNT')                throw new Error('VALIDATION_ERROR');
    if (benefit === 'DISCOUNT' && (!Number.isInteger(discountPercent) || (discountPercent as number) < 1 || (discountPercent as number) > 100))
                                                                        throw new Error('VALIDATION_ERROR');
    for (const cap of [dailyCap, weeklyCap]) {
      if (cap != null && (!Number.isInteger(cap) || cap < 1))           throw new Error('VALIDATION_ERROR');
    }
  }

  async listPlans(clubId: string) {
    return prisma.subscriptionPlan.findMany({ where: { clubId }, orderBy: { createdAt: 'asc' } });
  }

  async createPlan(clubId: string, body: PlanBody) {
    await this.validatePlan(body);
    return prisma.subscriptionPlan.create({
      data: {
        clubId,
        name: body.name!.trim(),
        sportKeys: body.sportKeys!,
        monthlyPrice: new Prisma.Decimal(body.monthlyPrice!),
        commitmentMonths: body.commitmentMonths!,
        offPeakOnly: body.offPeakOnly ?? true,
        benefit: body.benefit as SubscriptionBenefit,
        discountPercent: body.benefit === 'DISCOUNT' ? body.discountPercent! : null,
        dailyCap: body.dailyCap ?? null,
        weeklyCap: body.weeklyCap ?? null,
      },
    });
  }

  async updatePlan(id: string, clubId: string, body: PlanBody & { isActive?: boolean }) {
    const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!existing || existing.clubId !== clubId) throw new Error('PLAN_NOT_FOUND');

    // Revalide sur l'état fusionné (les champs omis gardent l'existant).
    const merged: PlanBody = {
      name: body.name ?? existing.name,
      sportKeys: body.sportKeys ?? existing.sportKeys,
      monthlyPrice: body.monthlyPrice ?? Number(existing.monthlyPrice),
      commitmentMonths: body.commitmentMonths ?? existing.commitmentMonths,
      benefit: body.benefit ?? existing.benefit,
      discountPercent: body.discountPercent !== undefined ? body.discountPercent : existing.discountPercent,
      dailyCap: body.dailyCap !== undefined ? body.dailyCap : existing.dailyCap,
      weeklyCap: body.weeklyCap !== undefined ? body.weeklyCap : existing.weeklyCap,
    };
    await this.validatePlan(merged);

    const data: Prisma.SubscriptionPlanUpdateInput = {};
    if (body.name !== undefined)             data.name = body.name.trim();
    if (body.sportKeys !== undefined)        data.sportKeys = body.sportKeys;
    if (body.monthlyPrice !== undefined)     data.monthlyPrice = new Prisma.Decimal(body.monthlyPrice);
    if (body.commitmentMonths !== undefined) data.commitmentMonths = body.commitmentMonths;
    if (body.offPeakOnly !== undefined)      data.offPeakOnly = body.offPeakOnly;
    if (body.benefit !== undefined)          data.benefit = body.benefit as SubscriptionBenefit;
    if (body.benefit !== undefined || body.discountPercent !== undefined) {
      data.discountPercent = merged.benefit === 'DISCOUNT' ? (merged.discountPercent ?? null) : null;
    }
    if (body.dailyCap !== undefined)         data.dailyCap = body.dailyCap;
    if (body.weeklyCap !== undefined)        data.weeklyCap = body.weeklyCap;
    if (body.isActive !== undefined)         data.isActive = body.isActive;

    return prisma.subscriptionPlan.update({ where: { id }, data });
  }

  async sellSubscription(clubId: string, userId: string, body: {
    planId?: string; method?: string; payerName?: string;
    voucherRef?: string; voucherIssuer?: string; createdByUserId?: string;
  }) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId ?? '' } });
    if (!plan || plan.clubId !== clubId || !plan.isActive) throw new Error('PLAN_NOT_FOUND');

    const membership = await prisma.clubMembership.findUnique({ where: { userId_clubId: { userId, clubId } } });
    if (!membership) throw new Error('MEMBER_NOT_FOUND');

    const method = (SALE_METHODS.includes(body.method as typeof SALE_METHODS[number]) ? body.method : 'CASH') as PaymentMethod;
    if (method === 'VOUCHER' && !body.voucherRef?.trim()) throw new Error('VALIDATION_ERROR');

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + plan.commitmentMonths);

    return prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: {
          clubId, userId, planId: plan.id, status: 'ACTIVE', expiresAt,
          monthlyPriceSnapshot: plan.monthlyPrice,
          sportKeys: plan.sportKeys, offPeakOnly: plan.offPeakOnly, benefit: plan.benefit,
          discountPercent: plan.discountPercent, dailyCap: plan.dailyCap, weeklyCap: plan.weeklyCap,
        },
      });
      const receiptNo = await PackageService.nextReceiptNo(tx, clubId);
      const payment = await tx.payment.create({
        data: {
          clubId,
          amount: plan.monthlyPrice,
          method,
          subscriptionId: sub.id,
          payerName: body.payerName?.trim() || null,
          note: `Vente abonnement ${plan.name} — 1re mensualité`,
          voucherRef:    method === 'VOUCHER' ? body.voucherRef!.trim() : null,
          voucherIssuer: method === 'VOUCHER' ? body.voucherIssuer?.trim() || null : null,
          voucherStatus: method === 'VOUCHER' ? 'PENDING_REIMBURSEMENT' : null,
          createdByUserId: body.createdByUserId ?? null,
          receiptNo,
        },
      });
      return { subscription: sub, payment };
    });
  }

  async listMySubscriptionsBySlug(slug: string, userId: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return prisma.subscription.findMany({
      where: { clubId: club.id, userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      orderBy: { startedAt: 'desc' },
      include: { plan: { select: { name: true } } },
    });
  }

  async listMemberSubscriptions(clubId: string, userId: string) {
    return prisma.subscription.findMany({
      where: { clubId, userId },
      orderBy: { startedAt: 'desc' },
      include: { plan: { select: { name: true } } },
    });
  }

  async cancelSubscription(id: string, clubId: string) {
    const sub = await prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.clubId !== clubId) throw new Error('SUBSCRIPTION_NOT_FOUND');
    return prisma.subscription.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  /** Décision pure de couverture d'un créneau par un abonnement (snapshot). */
  static coverageFor(
    sub: { sportKeys: string[]; offPeakOnly: boolean; benefit: SubscriptionBenefit; discountPercent: number | null },
    ctx: { sportKey: string; isOffPeak: boolean; dueCents: number },
  ): { covered: boolean; coverCents: number } {
    const covered = sub.sportKeys.includes(ctx.sportKey) && (!sub.offPeakOnly || ctx.isOffPeak);
    if (!covered) return { covered: false, coverCents: 0 };
    const coverCents = sub.benefit === 'INCLUDED'
      ? ctx.dueCents
      : Math.round(ctx.dueCents * (sub.discountPercent ?? 0) / 100);
    return { covered: true, coverCents };
  }
}
