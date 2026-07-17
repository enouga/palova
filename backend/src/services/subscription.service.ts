import fs from 'fs';
import path from 'path';
import { Prisma, PaymentMethod, SubscriptionBenefit } from '@prisma/client';
import { prisma } from '../db/prisma';
import { PackageService } from './package.service';
import { OFFERS_DIR } from '../utils/uploads';
import { serializableTx } from '../db/serializable';

/** Méthodes acceptées pour encaisser la VENTE d'un abonnement (1re mensualité). */
const SALE_METHODS = ['CASH', 'CARD', 'TRANSFER', 'VOUCHER', 'OTHER'] as const;

/** Supprime le fichier d'image uploadé d'un plan (best-effort, jamais bloquant). */
function deleteUploadedPlanImage(imageUrl: string | null | undefined): void {
  if (imageUrl?.startsWith('/uploads/offers/')) {
    fs.promises.unlink(path.join(OFFERS_DIR, path.basename(imageUrl))).catch(() => {});
  }
}

type PlanBody = {
  name?: string; description?: string | null; imageUrl?: string | null; sportKeys?: string[]; monthlyPrice?: number; commitmentMonths?: number;
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
        description: body.description?.trim() || null,
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
    if (body.description !== undefined)      data.description = body.description?.trim() || null;
    if (body.imageUrl !== undefined) {
      const next = body.imageUrl?.trim() || null;
      if (next !== existing.imageUrl) deleteUploadedPlanImage(existing.imageUrl);
      data.imageUrl = next;
    }
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

  /** Pose l'URL du fichier uploadé sur le plan (supprime l'ancien fichier). */
  async setImage(id: string, clubId: string, imageUrl: string) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan || plan.clubId !== clubId) throw new Error('PLAN_NOT_FOUND');
    deleteUploadedPlanImage(plan.imageUrl);
    return prisma.subscriptionPlan.update({ where: { id }, data: { imageUrl } });
  }

  /** Valide/normalise le moyen d'une VENTE d'abonnement (whitelist SALE_METHODS ; VOUCHER ⇒ réf.). */
  private buildSaleMethod(body: { method?: string; voucherRef?: string }): PaymentMethod {
    const method = (SALE_METHODS.includes(body.method as typeof SALE_METHODS[number]) ? body.method : 'CASH') as PaymentMethod;
    if (method === 'VOUCHER' && !body.voucherRef?.trim()) throw new Error('VALIDATION_ERROR');
    return method;
  }

  /** Crée une période d'abonnement (snapshot du plan) + son paiement, dans une transaction fournie. */
  private async createPeriodTx(
    tx: Prisma.TransactionClient,
    args: {
      clubId: string; userId: string;
      plan: { id: string; name: string; monthlyPrice: Prisma.Decimal; sportKeys: string[]; offPeakOnly: boolean; benefit: SubscriptionBenefit; discountPercent: number | null; dailyCap: number | null; weeklyCap: number | null };
      method: PaymentMethod; body: { payerName?: string; voucherRef?: string; voucherIssuer?: string; createdByUserId?: string }; expiresAt: Date; note: string;
    },
  ) {
    const { clubId, userId, plan, method, body, expiresAt, note } = args;
    const membership = await tx.clubMembership.findUnique({ where: { userId_clubId: { userId, clubId } } });
    if (!membership) throw new Error('MEMBER_NOT_FOUND');
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
        clubId, amount: plan.monthlyPrice, method, subscriptionId: sub.id,
        payerName: body.payerName?.trim() || null, note,
        voucherRef:    method === 'VOUCHER' ? body.voucherRef!.trim() : null,
        voucherIssuer: method === 'VOUCHER' ? body.voucherIssuer?.trim() || null : null,
        voucherStatus: method === 'VOUCHER' ? 'PENDING_REIMBURSEMENT' : null,
        createdByUserId: body.createdByUserId ?? null, receiptNo,
      },
    });
    return { subscription: sub, payment };
  }

  async sellSubscription(clubId: string, userId: string, body: {
    planId?: string; method?: string; payerName?: string;
    voucherRef?: string; voucherIssuer?: string; createdByUserId?: string;
  }) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId ?? '' } });
    if (!plan || plan.clubId !== clubId || !plan.isActive) throw new Error('PLAN_NOT_FOUND');
    const method = this.buildSaleMethod(body);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + plan.commitmentMonths);
    return prisma.$transaction((tx) =>
      this.createPeriodTx(tx, { clubId, userId, plan, method, body, expiresAt, note: `Vente abonnement ${plan.name} — 1re mensualité` }),
    );
  }

  /** Pilotage : KPIs, forfaits (avec compteur d'abonnés actifs), registre complet des abonnements. */
  async overview(clubId: string) {
    const [subs, plans] = await Promise.all([
      prisma.subscription.findMany({
        where: { clubId },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          plan: { select: { name: true } },
        },
        orderBy: { expiresAt: 'asc' },
      }),
      prisma.subscriptionPlan.findMany({ where: { clubId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const now = Date.now();
    const isActive = (s: { status: string; expiresAt: Date }) => s.status === 'ACTIVE' && s.expiresAt.getTime() > now;
    const active = subs.filter(isActive);
    const countByPlan = new Map<string, number>();
    for (const s of active) countByPlan.set(s.planId, (countByPlan.get(s.planId) ?? 0) + 1);
    return {
      kpis: {
        activeCount: new Set(active.map((s) => s.userId)).size,
        monthlyRevenueCents: active.reduce((sum, s) => sum + Math.round(Number(s.monthlyPriceSnapshot) * 100), 0),
        expiringSoonCount: active.filter((s) => s.expiresAt.getTime() <= now + 30 * 86_400_000).length,
      },
      plans: plans.map((p) => ({
        id: p.id, name: p.name, monthlyPrice: p.monthlyPrice.toString(), benefit: p.benefit,
        discountPercent: p.discountPercent, sportKeys: p.sportKeys, isActive: p.isActive,
        activeCount: countByPlan.get(p.id) ?? 0,
      })),
      subscribers: subs.map((s) => ({
        id: s.id, user: s.user, planId: s.planId, planName: s.plan.name, status: s.status,
        startedAt: s.startedAt.toISOString(), expiresAt: s.expiresAt.toISOString(),
        monthlyPriceSnapshot: s.monthlyPriceSnapshot.toString(), sportKeys: s.sportKeys,
      })),
    };
  }

  /** Renouvellement : prolonge LA MÊME période au tarif snapshot du membre (pas de trou si expiré). */
  async renewSubscription(id: string, clubId: string, body: {
    method?: string; payerName?: string; voucherRef?: string; voucherIssuer?: string; createdByUserId?: string;
  }) {
    const sub = await prisma.subscription.findUnique({ where: { id }, include: { plan: { select: { name: true, commitmentMonths: true } } } });
    if (!sub || sub.clubId !== clubId) throw new Error('SUBSCRIPTION_NOT_FOUND');
    if (sub.status !== 'ACTIVE')       throw new Error('SUBSCRIPTION_NOT_RENEWABLE');
    const method = this.buildSaleMethod(body);
    const newExpiry = new Date(Math.max(Date.now(), sub.expiresAt.getTime()));
    newExpiry.setMonth(newExpiry.getMonth() + sub.plan.commitmentMonths);
    return serializableTx(async (tx) => {
      const updated = await tx.subscription.update({ where: { id }, data: { expiresAt: newExpiry } });
      const receiptNo = await PackageService.nextReceiptNo(tx, clubId);
      const payment = await tx.payment.create({
        data: {
          clubId, amount: sub.monthlyPriceSnapshot, method, subscriptionId: sub.id,
          payerName: body.payerName?.trim() || null,
          note: `Renouvellement abonnement ${sub.plan.name} — mensualité`,
          voucherRef:    method === 'VOUCHER' ? body.voucherRef!.trim() : null,
          voucherIssuer: method === 'VOUCHER' ? body.voucherIssuer?.trim() || null : null,
          voucherStatus: method === 'VOUCHER' ? 'PENDING_REIMBURSEMENT' : null,
          createdByUserId: body.createdByUserId ?? null, receiptNo,
        },
      });
      return { subscription: updated, payment };
    });
  }

  /** Changement de forfait : résilie l'actuel + vend le nouveau (snapshot, plein tarif, pas de prorata), 1 transaction. */
  async changeSubscription(id: string, clubId: string, body: {
    planId?: string; method?: string; payerName?: string; voucherRef?: string; voucherIssuer?: string; createdByUserId?: string;
  }) {
    const current = await prisma.subscription.findUnique({ where: { id }, select: { id: true, clubId: true, userId: true } });
    if (!current || current.clubId !== clubId) throw new Error('SUBSCRIPTION_NOT_FOUND');
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId ?? '' } });
    if (!plan || plan.clubId !== clubId || !plan.isActive) throw new Error('PLAN_NOT_FOUND');
    const method = this.buildSaleMethod(body);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + plan.commitmentMonths);
    return serializableTx(async (tx) => {
      await tx.subscription.update({ where: { id }, data: { status: 'CANCELLED' } });
      return this.createPeriodTx(tx, { clubId, userId: current.userId, plan, method, body, expiresAt, note: `Changement d'abonnement → ${plan.name} — 1re mensualité` });
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
