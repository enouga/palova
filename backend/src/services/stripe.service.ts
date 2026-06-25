import { stripe } from '../db/stripe';
import { prisma } from '../db/prisma';

export class StripeService {
  async createConnectedAccount(clubId: string, refreshUrl: string, returnUrl: string): Promise<string> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountId: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');

    let accountId = club.stripeAccountId;

    if (!accountId) {
      const account = await stripe.accounts.create({
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
      : account.details_submitted ? 'RESTRICTED'
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

    const link = await stripe.accounts.createLoginLink(club.stripeAccountId);
    return link.url;
  }

  async createOrGetCustomer(clubId: string, userId: string) {
    const existing = await prisma.clubStripeCustomer.findUnique({
      where: { clubId_userId: { clubId, userId } },
    });
    if (existing) return existing;

    const [club, user] = await Promise.all([
      prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountId: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
    if (!user) throw new Error('USER_NOT_FOUND');

    const customer = await stripe.customers.create(
      { email: user.email ?? undefined },
      { stripeAccount: club.stripeAccountId },
    );

    return prisma.clubStripeCustomer.create({
      data: { clubId, userId, stripeCustomerId: customer.id },
    });
  }

  async createPaymentIntent(params: {
    clubId: string;
    userId: string;
    reservationId: string;
    amountCents: number;
  }): Promise<{ clientSecret: string }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId },
      select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') {
      throw new Error('STRIPE_NOT_CONFIGURED');
    }

    const customer = await this.createOrGetCustomer(params.clubId, params.userId);

    const pi = await stripe.paymentIntents.create(
      {
        amount: params.amountCents,
        currency: 'eur',
        customer: customer.stripeCustomerId,
        setup_future_usage: 'off_session',
        metadata: { reservationId: params.reservationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );

    if (!pi.client_secret) throw new Error('STRIPE_ERROR');
    return { clientSecret: pi.client_secret };
  }

  async createSetupIntent(params: {
    clubId: string;
    userId: string;
    reservationId: string;
  }): Promise<{ clientSecret: string }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId },
      select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') {
      throw new Error('STRIPE_NOT_CONFIGURED');
    }

    const customer = await this.createOrGetCustomer(params.clubId, params.userId);

    const si = await stripe.setupIntents.create(
      {
        customer: customer.stripeCustomerId,
        usage: 'off_session',
        payment_method_types: ['card'],
        metadata: { reservationId: params.reservationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );

    if (!si.client_secret) throw new Error('STRIPE_ERROR');
    return { clientSecret: si.client_secret };
  }

  private regMetaKey(kind: 'tournament' | 'event'): 'tournamentRegistrationId' | 'eventRegistrationId' {
    return kind === 'tournament' ? 'tournamentRegistrationId' : 'eventRegistrationId';
  }

  async createRegistrationPaymentIntent(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event'; amountCents: number;
  }): Promise<{ clientSecret: string }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId }, select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') throw new Error('STRIPE_NOT_CONFIGURED');
    const customer = await this.createOrGetCustomer(params.clubId, params.userId);
    const pi = await stripe.paymentIntents.create(
      {
        amount: params.amountCents, currency: 'eur', customer: customer.stripeCustomerId,
        setup_future_usage: 'off_session',
        metadata: { [this.regMetaKey(params.kind)]: params.registrationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );
    if (!pi.client_secret) throw new Error('STRIPE_ERROR');
    return { clientSecret: pi.client_secret };
  }

  async createRegistrationSetupIntent(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event';
  }): Promise<{ clientSecret: string }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId }, select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') throw new Error('STRIPE_NOT_CONFIGURED');
    const customer = await this.createOrGetCustomer(params.clubId, params.userId);
    const si = await stripe.setupIntents.create(
      {
        customer: customer.stripeCustomerId, usage: 'off_session', payment_method_types: ['card'],
        metadata: { [this.regMetaKey(params.kind)]: params.registrationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );
    if (!si.client_secret) throw new Error('STRIPE_ERROR');
    return { clientSecret: si.client_secret };
  }

  async chargeRegistrationOffSession(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event'; amountCents: number;
  }): Promise<string> {
    const [club, sc] = await Promise.all([
      prisma.club.findUnique({ where: { id: params.clubId }, select: { stripeAccountId: true } }),
      prisma.clubStripeCustomer.findUnique({ where: { clubId_userId: { clubId: params.clubId, userId: params.userId } } }),
    ]);
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
    if (!sc?.defaultPaymentMethodId) throw new Error('NO_CARD_ON_FILE');
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: params.amountCents, currency: 'eur', customer: sc.stripeCustomerId,
          payment_method: sc.defaultPaymentMethodId, off_session: true, confirm: true,
          metadata: { [this.regMetaKey(params.kind)]: params.registrationId, clubId: params.clubId },
        },
        { stripeAccount: club.stripeAccountId },
      );
      return pi.id;
    } catch (err: any) {
      if (err?.code === 'card_declined' || err?.code === 'authentication_required') throw new Error('CARD_DECLINED');
      throw err;
    }
  }

  async chargeNoShow(params: {
    clubId: string;
    userId: string;
    reservationId: string;
    amountCents: number;
    note?: string;
    createdByUserId?: string;
  }): Promise<string> {
    const [club, stripeCustomer] = await Promise.all([
      prisma.club.findUnique({ where: { id: params.clubId }, select: { stripeAccountId: true } }),
      prisma.clubStripeCustomer.findUnique({
        where: { clubId_userId: { clubId: params.clubId, userId: params.userId } },
      }),
    ]);

    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
    if (!stripeCustomer?.defaultPaymentMethodId) throw new Error('NO_CARD_ON_FILE');

    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: params.amountCents,
          currency: 'eur',
          customer: stripeCustomer.stripeCustomerId,
          payment_method: stripeCustomer.defaultPaymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            reservationId: params.reservationId,
            clubId: params.clubId,
            noShow: 'true',
          },
        },
        { stripeAccount: club.stripeAccountId },
      );
      return pi.id;
    } catch (err: any) {
      if (err?.code === 'card_declined' || err?.code === 'authentication_required') {
        throw new Error('CARD_DECLINED');
      }
      throw err;
    }
  }

  async refundPaymentIntent(params: {
    stripeAccountId: string;
    paymentIntentId: string;
    amountCents: number;
  }): Promise<void> {
    await stripe.refunds.create(
      { payment_intent: params.paymentIntentId, amount: params.amountCents },
      { stripeAccount: params.stripeAccountId },
    );
  }
}
