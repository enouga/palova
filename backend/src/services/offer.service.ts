import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { PackageService } from './package.service';
import { StripeService } from './stripe.service';

/** Metadata posée sur les PaymentIntents d'achat d'offre (plan ou carnet). */
export interface OfferIntentMeta {
  offerPlanId?: string;
  offerPackageTemplateId?: string;
  offerUserId?: string;
  clubId?: string;
}

export class OfferService {
  /** Vitrine publique : formules actives si le club a opté, drapeau achat en ligne. */
  async listPublicOffers(slug: string) {
    const club = await prisma.club.findUnique({
      where: { slug },
      select: { id: true, status: true, showOffersPublicly: true, stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    if (!club.showOffersPublicly) return { plans: [], packages: [], onlinePurchase: false };
    const [plans, packages] = await Promise.all([
      prisma.subscriptionPlan.findMany({
        where: { clubId: club.id, isActive: true },
        orderBy: { monthlyPrice: 'asc' },
        select: { id: true, name: true, monthlyPrice: true, commitmentMonths: true, offPeakOnly: true, benefit: true, discountPercent: true, dailyCap: true, weeklyCap: true, sportKeys: true },
      }),
      prisma.packageTemplate.findMany({
        where: { clubId: club.id, isActive: true },
        orderBy: { price: 'asc' },
        select: { id: true, name: true, kind: true, price: true, entriesCount: true, walletAmount: true, validityDays: true, sportKeys: true },
      }),
    ]);
    const onlinePurchase = !!club.stripeAccountId && club.stripeAccountStatus === 'ACTIVE';
    return { plans, packages, onlinePurchase };
  }

  /** Crée l'achat (Subscription ou MemberPackage + Payment ONLINE) depuis un PaymentIntent réussi.
   *  Idempotent par stripePaymentIntentId — appelé par le client ET le webhook. */
  async fulfillPaidIntent(meta: OfferIntentMeta, stripePaymentIntentId: string, amountCents: number) {
    const userId = meta.offerUserId;
    const clubId = meta.clubId;
    if (!userId || !clubId || (!meta.offerPlanId && !meta.offerPackageTemplateId)) throw new Error('VALIDATION_ERROR');
    return prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findFirst({ where: { stripePaymentIntentId }, select: { id: true } });
      if (existing) return null; // déjà traité (client OU webhook)
      const amount = new Prisma.Decimal(amountCents).div(100);

      if (meta.offerPlanId) {
        const plan = await tx.subscriptionPlan.findUnique({ where: { id: meta.offerPlanId } });
        if (!plan || plan.clubId !== clubId || !plan.isActive) throw new Error('OFFER_NOT_FOUND');
        const receiptNo = await PackageService.nextReceiptNo(tx, clubId);
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + plan.commitmentMonths);
        const sub = await tx.subscription.create({
          data: {
            clubId, userId, planId: plan.id, status: 'ACTIVE', expiresAt,
            monthlyPriceSnapshot: plan.monthlyPrice,
            sportKeys: plan.sportKeys, offPeakOnly: plan.offPeakOnly, benefit: plan.benefit,
            discountPercent: plan.discountPercent, dailyCap: plan.dailyCap, weeklyCap: plan.weeklyCap,
          },
        });
        await tx.payment.create({
          data: {
            clubId, subscriptionId: sub.id, amount, method: 'ONLINE', status: 'CAPTURED',
            stripePaymentIntentId, receiptNo, note: `Vente abonnement ${plan.name} — 1re mensualité (en ligne)`,
          },
        });
        return { kind: 'plan' as const, id: sub.id };
      }

      const tpl = await tx.packageTemplate.findUnique({ where: { id: meta.offerPackageTemplateId! } });
      if (!tpl || tpl.clubId !== clubId || !tpl.isActive) throw new Error('OFFER_NOT_FOUND');
      const receiptNo = await PackageService.nextReceiptNo(tx, clubId);
      const expiresAt = tpl.validityDays ? new Date(Date.now() + tpl.validityDays * 86_400_000) : null;
      const pkg = await tx.memberPackage.create({
        data: {
          clubId, userId, templateId: tpl.id, kind: tpl.kind,
          creditsTotal: tpl.kind === 'ENTRIES' ? tpl.entriesCount : null,
          creditsRemaining: tpl.kind === 'ENTRIES' ? tpl.entriesCount : null,
          amountTotal: tpl.kind === 'WALLET' ? tpl.walletAmount : null,
          amountRemaining: tpl.kind === 'WALLET' ? tpl.walletAmount : null,
          expiresAt,
        },
      });
      await tx.payment.create({
        data: {
          clubId, memberPackageId: pkg.id, amount, method: 'ONLINE', status: 'CAPTURED',
          stripePaymentIntentId, receiptNo, note: `Vente ${tpl.name} (en ligne)`,
        },
      });
      return { kind: 'package' as const, id: pkg.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  }

  /** Confirmation côté client : vérifie le PaymentIntent auprès de Stripe puis délègue. */
  async confirmFromClient(slug: string, userId: string, stripePaymentIntentId: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true, stripeAccountId: true } });
    if (!club || club.status !== 'ACTIVE' || !club.stripeAccountId) throw new Error('CLUB_NOT_FOUND');
    const pi = await new StripeService().retrievePaymentIntent(stripePaymentIntentId, club.stripeAccountId);
    if (!pi || pi.status !== 'succeeded') throw new Error('NOT_PAYABLE');
    const meta = (pi.metadata ?? {}) as OfferIntentMeta;
    if (meta.offerUserId !== userId || meta.clubId !== club.id) throw new Error('UNAUTHORIZED');
    await this.fulfillPaidIntent(meta, pi.id, pi.amount);
    return { ok: true };
  }
}
