import { Prisma, PaymentMethod } from '@prisma/client';
import { prisma } from '../db/prisma';
import { stripe } from '../db/stripe';

const cents = (v: unknown) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) ? n : 0; };

const PREPAID_METHODS: string[] = ['PACK_CREDIT', 'WALLET'];
const VALID_METHODS: string[] = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER', 'PACK_CREDIT', 'WALLET', 'MEMBER'];

export class RefundService {
  /**
   * Rembourse (total ou partiel) un Payment. Montant positif, ≤ (payé − déjà remboursé).
   * Transaction Serializable : incrément conditionnel de refundedAmount (anti-double /
   * anti-course, count===0 → ALREADY_REFUNDED), création du Refund, recalcul du status,
   * et recrédit du MemberPackage si le paiement source était du prépayé.
   */
  async refund(params: {
    paymentId: string;
    clubId: string;
    amount: number;
    reason?: string;
    method?: string;
    createdByUserId?: string;
  }) {
    if (typeof params.amount !== 'number' || isNaN(params.amount) || params.amount <= 0) {
      throw new Error('VALIDATION_ERROR');
    }

    const payment = await prisma.payment.findUnique({ where: { id: params.paymentId } });
    if (!payment || payment.clubId !== params.clubId) throw new Error('PAYMENT_NOT_FOUND');

    const amountCents     = cents(params.amount);
    const paidCents       = cents(payment.amount);
    const alreadyCents    = cents(payment.refundedAmount);
    const refundableCents = paidCents - alreadyCents;
    if (amountCents > refundableCents) throw new Error('REFUND_EXCEEDS_PAID');

    const newRefundedCents = alreadyCents + amountCents;
    const newStatus = newRefundedCents >= paidCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const amount = new Prisma.Decimal(params.amount);

    const refundMethod = (VALID_METHODS.includes(params.method ?? '')
      ? params.method
      : payment.method) as PaymentMethod;

    const pkg = PREPAID_METHODS.includes(payment.method) && payment.sourcePackageId
      ? await prisma.memberPackage.findUnique({ where: { id: payment.sourcePackageId } })
      : null;

    if (payment.method === 'ONLINE' && payment.stripePaymentIntentId) {
      const club = await prisma.club.findUnique({
        where: { id: params.clubId },
        select: { stripeAccountId: true },
      });
      if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
      await stripe.refunds.create(
        { payment_intent: payment.stripePaymentIntentId, amount: amountCents },
        {
          stripeAccount: club.stripeAccountId,
          // Idempotence anti-double-remboursement : deux demandes concurrentes lisent le même
          // refundedAmount (alreadyCents) → même clé → Stripe ne rembourse qu'une fois. Deux
          // remboursements partiels légitimes successifs ont un alreadyCents différent → clés
          // distinctes → les deux passent bien.
          idempotencyKey: `refund:${payment.id}:${alreadyCents}:${amountCents}`,
        },
      );
    }

    return prisma.$transaction(async (tx) => {
      const res = await tx.payment.updateMany({
        where: { id: payment.id, refundedAmount: payment.refundedAmount },
        data: { refundedAmount: { increment: amount } },
      });
      if (res.count === 0) throw new Error('ALREADY_REFUNDED');

      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          clubId: params.clubId,
          amount,
          reason: params.reason?.trim() || null,
          method: refundMethod,
          createdByUserId: params.createdByUserId ?? null,
        },
      });

      await tx.payment.update({ where: { id: payment.id }, data: { status: newStatus } });

      if (pkg) {
        await tx.memberPackage.update({
          where: { id: pkg.id },
          data: pkg.kind === 'ENTRIES'
            ? { creditsRemaining: { increment: 1 } }
            : { amountRemaining: { increment: amount } },
        });
      }

      return refund;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
