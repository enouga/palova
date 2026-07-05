import { prisma } from '../db/prisma';

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
        select: { id: true, name: true, kind: true, price: true, entriesCount: true, walletAmount: true, validityDays: true },
      }),
    ]);
    const onlinePurchase = !!club.stripeAccountId && club.stripeAccountStatus === 'ACTIVE';
    return { plans, packages, onlinePurchase };
  }
}
