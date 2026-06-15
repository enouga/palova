import { stripe } from '../db/stripe';
import { prisma } from '../db/prisma';

export class StripeService {
  async createConnectedAccount(clubId: string, refreshUrl: string, returnUrl: string): Promise<string> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountId: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');

    let accountId = club.stripeAccountId;

    if (!accountId) {
      const account = await (stripe.accounts.create as any)({
        type: 'express',
        country: 'FR',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      });
      accountId = account.id;
      await prisma.club.update({
        where: { id: clubId },
        data: { stripeAccountId: accountId, stripeAccountStatus: 'PENDING' },
      });
    }

    const link = await stripe.accountLinks.create({
      account: accountId!,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    return link.url;
  }

  async syncAccountStatus(clubId: string): Promise<string> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { stripeAccountId: true },
    });
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');

    const account = await stripe.accounts.retrieve(club.stripeAccountId);
    const status = account.charges_enabled ? 'ACTIVE'
      : (account as any).details_submitted ? 'RESTRICTED'
      : 'PENDING';

    await prisma.club.update({ where: { id: clubId }, data: { stripeAccountStatus: status as any } });
    return status;
  }

  async createLoginLink(clubId: string): Promise<string> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') throw new Error('STRIPE_NOT_CONFIGURED');

    const link = await (stripe.accounts as any).createLoginLink(club.stripeAccountId);
    return link.url;
  }
}
