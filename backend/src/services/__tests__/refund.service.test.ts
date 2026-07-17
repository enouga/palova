import '../../__mocks__/prisma';
import { Prisma } from '@prisma/client';
import { prismaMock } from '../../__mocks__/prisma';
import { RefundService } from '../refund.service';

jest.mock('../../db/stripe', () => ({
  stripe: {
    refunds: { create: jest.fn() },
  },
}));

import { stripe } from '../../db/stripe';

describe('RefundService.refund', () => {
  let service: RefundService;
  beforeEach(() => {
    service = new RefundService();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  });

  const cashPayment = {
    id: 'pay-1', clubId: 'club-1', amount: new Prisma.Decimal(25),
    refundedAmount: new Prisma.Decimal(0), method: 'CASH', sourcePackageId: null,
  };

  it('refuse un paiement inconnu ou d\'un autre club', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null as any);
    await expect(service.refund({ paymentId: 'x', clubId: 'club-1', amount: 5 })).rejects.toThrow('PAYMENT_NOT_FOUND');
    prismaMock.payment.findUnique.mockResolvedValue({ ...cashPayment, clubId: 'autre' } as any);
    await expect(service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 5 })).rejects.toThrow('PAYMENT_NOT_FOUND');
  });

  it('refuse un montant <= 0 ou supérieur au remboursable', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(cashPayment as any);
    await expect(service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 0 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 30 })).rejects.toThrow('REFUND_EXCEEDS_PAID');
  });

  it('remboursement partiel : updateMany conditionnel + Refund + status PARTIALLY_REFUNDED', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(cashPayment as any);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.refund.create.mockResolvedValue({ id: 'ref-1' } as any);
    prismaMock.payment.update.mockResolvedValue({ id: 'pay-1' } as any);
    await service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 10, createdByUserId: 'staff-1' });
    expect(prismaMock.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pay-1' }),
      data: { refundedAmount: { increment: new Prisma.Decimal(10) } },
    }));
    expect(prismaMock.refund.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentId: 'pay-1', clubId: 'club-1', createdByUserId: 'staff-1' }),
    }));
    expect(prismaMock.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pay-1' }, data: { status: 'PARTIALLY_REFUNDED' },
    }));
  });

  it('remboursement total : status REFUNDED', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(cashPayment as any);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.refund.create.mockResolvedValue({ id: 'ref-1' } as any);
    prismaMock.payment.update.mockResolvedValue({ id: 'pay-1' } as any);
    await service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 25 });
    expect(prismaMock.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'REFUNDED' } }));
  });

  it('course concurrente : count===0 → ALREADY_REFUNDED', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(cashPayment as any);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 0 } as any);
    await expect(service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 10 })).rejects.toThrow('ALREADY_REFUNDED');
  });

  it('paiement prépayé (PACK_CREDIT) : recrédite le MemberPackage', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({ ...cashPayment, method: 'PACK_CREDIT', sourcePackageId: 'pkg-1' } as any);
    prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', kind: 'ENTRIES' } as any);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.memberPackage.update.mockResolvedValue({ id: 'pkg-1' } as any);
    prismaMock.refund.create.mockResolvedValue({ id: 'ref-1' } as any);
    prismaMock.payment.update.mockResolvedValue({ id: 'pay-1' } as any);
    await service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 25 });
    expect(prismaMock.memberPackage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pkg-1' }, data: { creditsRemaining: { increment: 1 } },
    }));
  });
});

describe('RefundService.refund — paiements ONLINE', () => {
  let service: RefundService;
  beforeEach(() => {
    service = new RefundService();
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  });

  const onlinePayment = {
    id: 'pay-online-1',
    clubId: 'club-1',
    amount: new Prisma.Decimal(25),
    refundedAmount: new Prisma.Decimal(0),
    method: 'ONLINE',
    status: 'CAPTURED',
    sourcePackageId: null,
    stripePaymentIntentId: 'pi_1',
  };

  it('appelle stripe.refunds.create pour un paiement ONLINE', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(onlinePayment as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountId: 'acct_1' } as any);
    (stripe.refunds.create as jest.Mock).mockResolvedValue({ id: 'ref_1' });
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.refund.create.mockResolvedValue({ id: 'rf-1' } as any);
    prismaMock.payment.update.mockResolvedValue({ id: 'pay-online-1' } as any);

    await service.refund({ paymentId: 'pay-online-1', clubId: 'club-1', amount: 25 });

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 2500 },
      { stripeAccount: 'acct_1', idempotencyKey: 'refund:pay-online-1:0:2500' },
    );
  });

  it('idempotencyKey déterministe qui varie selon le déjà-remboursé (anti-double / non-collision)', async () => {
    // Remboursement partiel de 5 € sur un paiement déjà remboursé de 10 € → alreadyCents=1000.
    prismaMock.payment.findUnique.mockResolvedValue({
      ...onlinePayment, refundedAmount: new Prisma.Decimal(10),
    } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountId: 'acct_1' } as any);
    (stripe.refunds.create as jest.Mock).mockResolvedValue({ id: 'ref_2' });
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.refund.create.mockResolvedValue({ id: 'rf-2' } as any);
    prismaMock.payment.update.mockResolvedValue({ id: 'pay-online-1' } as any);

    await service.refund({ paymentId: 'pay-online-1', clubId: 'club-1', amount: 5 });

    // Clé distincte du remboursement initial (0:2500) → deux remboursements légitimes ne se collapsent pas.
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 500 },
      { stripeAccount: 'acct_1', idempotencyKey: 'refund:pay-online-1:1000:500' },
    );
  });

  it('ne pas appeler stripe.refunds.create pour un paiement CASH', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      ...onlinePayment, method: 'CASH', stripePaymentIntentId: null,
    } as any);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.refund.create.mockResolvedValue({ id: 'rf-1' } as any);
    prismaMock.payment.update.mockResolvedValue({ id: 'pay-online-1' } as any);

    await service.refund({ paymentId: 'pay-online-1', clubId: 'club-1', amount: 25 });

    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('ne crée pas le Refund DB si stripe.refunds.create échoue', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(onlinePayment as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountId: 'acct_1' } as any);
    (stripe.refunds.create as jest.Mock).mockRejectedValue(new Error('stripe error'));

    await expect(
      service.refund({ paymentId: 'pay-online-1', clubId: 'club-1', amount: 25 })
    ).rejects.toThrow('stripe error');

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('lève STRIPE_NOT_CONFIGURED si le club n\'a pas de compte Stripe', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(onlinePayment as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountId: null } as any);

    await expect(
      service.refund({ paymentId: 'pay-online-1', clubId: 'club-1', amount: 25 })
    ).rejects.toThrow('STRIPE_NOT_CONFIGURED');

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
