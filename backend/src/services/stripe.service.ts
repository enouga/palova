import { stripe } from '../db/stripe';
import { prisma } from '../db/prisma';
import { Prisma } from '@prisma/client';

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

  /**
   * Crée une CustomerSession pour ré-afficher la carte enregistrée du joueur
   * (pré-sélectionnée) dans le PaymentElement. Le filtre allow_redisplay inclut
   * 'unspecified' pour faire apparaître les cartes déjà enregistrées sans muter
   * le PaymentMethod. Best-effort : tout échec renvoie null → le PaymentElement
   * retombe sur le formulaire vierge, le paiement n'échoue jamais.
   */
  private async buildCustomerSession(
    stripeAccountId: string,
    stripeCustomerId: string,
  ): Promise<string | null> {
    try {
      const cs = await stripe.customerSessions.create(
        {
          customer: stripeCustomerId,
          components: {
            payment_element: {
              enabled: true,
              features: {
                payment_method_redisplay: 'enabled',
                payment_method_allow_redisplay_filters: ['always', 'limited', 'unspecified'],
              },
            },
          },
        },
        { stripeAccount: stripeAccountId },
      );
      return cs.client_secret ?? null;
    } catch {
      return null;
    }
  }

  async createPaymentIntent(params: {
    clubId: string;
    userId: string;
    reservationId: string;
    amountCents: number;
  }): Promise<{ clientSecret: string; customerSessionClientSecret: string | null }> {
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
        // Carte bancaire uniquement : la carte enregistrée sert d'empreinte anti no-show
        // et de moyen de débit off-session (liste d'attente). Les portefeuilles type Link
        // n'exposent pas de marque/4 chiffres/expiration et sont peu fiables off-session.
        payment_method_types: ['card'],
        metadata: { reservationId: params.reservationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );

    if (!pi.client_secret) throw new Error('STRIPE_ERROR');
    const customerSessionClientSecret = await this.buildCustomerSession(
      club.stripeAccountId, customer.stripeCustomerId,
    );
    return { clientSecret: pi.client_secret, customerSessionClientSecret };
  }

  async createSetupIntent(params: {
    clubId: string;
    userId: string;
    reservationId: string;
  }): Promise<{ clientSecret: string; customerSessionClientSecret: string | null }> {
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
    return { clientSecret: si.client_secret, customerSessionClientSecret: null };
  }

  private regMetaKey(kind: 'tournament' | 'event'): 'tournamentRegistrationId' | 'eventRegistrationId' {
    return kind === 'tournament' ? 'tournamentRegistrationId' : 'eventRegistrationId';
  }

  async createRegistrationPaymentIntent(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event'; amountCents: number;
  }): Promise<{ clientSecret: string; customerSessionClientSecret: string | null }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId }, select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') throw new Error('STRIPE_NOT_CONFIGURED');
    const customer = await this.createOrGetCustomer(params.clubId, params.userId);
    const pi = await stripe.paymentIntents.create(
      {
        amount: params.amountCents, currency: 'eur', customer: customer.stripeCustomerId,
        setup_future_usage: 'off_session',
        // Carte bancaire uniquement (cf. createPaymentIntent) : la carte enregistrée
        // sert d'empreinte + de débit off-session à la promotion depuis la liste d'attente.
        payment_method_types: ['card'],
        metadata: { [this.regMetaKey(params.kind)]: params.registrationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );
    if (!pi.client_secret) throw new Error('STRIPE_ERROR');
    const customerSessionClientSecret = await this.buildCustomerSession(
      club.stripeAccountId, customer.stripeCustomerId,
    );
    return { clientSecret: pi.client_secret, customerSessionClientSecret };
  }

  async createRegistrationSetupIntent(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event';
  }): Promise<{ clientSecret: string; customerSessionClientSecret: string | null }> {
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
    return { clientSecret: si.client_secret, customerSessionClientSecret: null };
  }

  async chargeRegistrationOffSession(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event'; amountCents: number; idempotencyKey?: string;
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
        { stripeAccount: club.stripeAccountId, ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}) },
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

  /**
   * Délie le compte Stripe connecté du club pour permettre un nouvel onboarding.
   * Garde-fou : refuse tant qu'il reste un paiement ONLINE non totalement remboursé
   * sur une réservation À VENIR (remboursement encore plausible). Les paiements sur
   * réservations passées ne bloquent pas (condition finie qui se purge d'elle-même).
   * Purge les ClubStripeCustomer (cartes liées à l'ancien compte, inutilisables ailleurs)
   * et désactive les 2 réglages de paiement (sinon des réservations seraient bloquées).
   */
  async disconnectAccount(clubId: string): Promise<void> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { stripeAccountId: true },
    });
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');

    const candidates = await prisma.payment.findMany({
      where: {
        clubId,
        method: 'ONLINE',
        stripePaymentIntentId: { not: null },
        reservation: { is: { startTime: { gt: new Date() } } },
      },
      select: { amount: true, refundedAmount: true },
    });
    const pending = candidates.filter((p) => Number(p.amount) > Number(p.refundedAmount)).length;
    if (pending > 0) {
      throw Object.assign(new Error('STRIPE_HAS_PENDING_ONLINE_PAYMENTS'), { count: pending });
    }

    await prisma.$transaction(async (tx) => {
      await tx.club.update({
        where: { id: clubId },
        data: {
          stripeAccountId: null,
          stripeAccountStatus: 'NONE',
          requireOnlinePayment: false,
          requireCardFingerprint: false,
        },
      });
      await tx.clubStripeCustomer.deleteMany({ where: { clubId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** Détails (marque/4 chiffres/expiration) d'une carte enregistrée, lus sur le compte connecté. */
  async getCardDetails(clubId: string, paymentMethodId: string): Promise<{ brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } | null> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountId: true } });
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId, undefined, { stripeAccount: club.stripeAccountId });
    const card = pm.card;
    if (!card) return null;
    return { brand: card.brand ?? null, last4: card.last4 ?? null, expMonth: card.exp_month ?? null, expYear: card.exp_year ?? null };
  }

  /** Délie une carte du Customer (compte connecté). À appeler avant de nullifier defaultPaymentMethodId. */
  async detachCard(clubId: string, paymentMethodId: string): Promise<void> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountId: true } });
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
    await stripe.paymentMethods.detach(paymentMethodId, undefined, { stripeAccount: club.stripeAccountId });
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
