import '../../__mocks__/prisma';
import { Prisma } from '@prisma/client';
import { prismaMock } from '../../__mocks__/prisma';
import { RefundService } from '../refund.service';

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
