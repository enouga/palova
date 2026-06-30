import { prisma } from '../db/prisma';
import { StripeService } from './stripe.service';

export interface MyPaymentMethod {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}

/** Carte enregistrée du joueur sur un club (compte Stripe connecté). Lecture + retrait. */
export class PaymentMethodService {
  private stripe = new StripeService();

  private async clubActive(slug: string): Promise<{ id: string }> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return { id: club.id };
  }

  async getMyPaymentMethod(slug: string, userId: string): Promise<MyPaymentMethod | null> {
    const club = await this.clubActive(slug);
    const sc = await prisma.clubStripeCustomer.findUnique({
      where: { clubId_userId: { clubId: club.id, userId } },
      select: { defaultPaymentMethodId: true, cardBrand: true, cardLast4: true, cardExpMonth: true, cardExpYear: true },
    });
    if (!sc?.defaultPaymentMethodId) return null;
    if (sc.cardLast4) {
      return { brand: sc.cardBrand, last4: sc.cardLast4, expMonth: sc.cardExpMonth, expYear: sc.cardExpYear };
    }
    // Carte « legacy » (enregistrée avant le stockage des détails) : backfill paresseux, best-effort.
    try {
      const details = await this.stripe.getCardDetails(club.id, sc.defaultPaymentMethodId);
      if (details) {
        await prisma.clubStripeCustomer.update({
          where: { clubId_userId: { clubId: club.id, userId } },
          data: { cardBrand: details.brand, cardLast4: details.last4, cardExpMonth: details.expMonth, cardExpYear: details.expYear },
        });
        return details;
      }
    } catch {
      // Jamais bloquant : on renvoie une forme dégradée plutôt que de casser le profil.
    }
    return { brand: null, last4: null, expMonth: null, expYear: null };
  }

  async removeMyPaymentMethod(slug: string, userId: string): Promise<{ ok: true }> {
    const club = await this.clubActive(slug);
    const sc = await prisma.clubStripeCustomer.findUnique({
      where: { clubId_userId: { clubId: club.id, userId } },
      select: { defaultPaymentMethodId: true },
    });
    if (!sc?.defaultPaymentMethodId) return { ok: true };
    try {
      await this.stripe.detachCard(club.id, sc.defaultPaymentMethodId);
    } catch {
      // Best-effort : carte déjà détachée / erreur transitoire ne doit pas bloquer le retrait local.
    }
    await prisma.clubStripeCustomer.update({
      where: { clubId_userId: { clubId: club.id, userId } },
      data: { defaultPaymentMethodId: null, cardBrand: null, cardLast4: null, cardExpMonth: null, cardExpYear: null },
    });
    return { ok: true };
  }
}
