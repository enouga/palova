import '../../__mocks__/prisma';
import { Prisma } from '@prisma/client';
import { prismaMock } from '../../__mocks__/prisma';
import { PackageService } from '../package.service';

describe('PackageService — offres (templates)', () => {
  let service: PackageService;
  beforeEach(() => { service = new PackageService(); });

  it('crée une offre carnet (ENTRIES) avec entriesCount', async () => {
    prismaMock.packageTemplate.create.mockResolvedValue({ id: 'tpl-1' } as any);
    await service.createTemplate('club-1', { kind: 'ENTRIES', name: '10 entrées', price: 200, entriesCount: 10 });
    expect(prismaMock.packageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubId: 'club-1', kind: 'ENTRIES', entriesCount: 10, walletAmount: null }),
    }));
  });

  it('crée une offre porte-monnaie (WALLET) avec walletAmount', async () => {
    prismaMock.packageTemplate.create.mockResolvedValue({ id: 'tpl-2' } as any);
    await service.createTemplate('club-1', { kind: 'WALLET', name: 'Avoir 200 €', price: 180, walletAmount: 200, validityDays: 365 });
    expect(prismaMock.packageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'WALLET', entriesCount: null, validityDays: 365 }),
    }));
  });

  it('refuse un carnet sans entriesCount', async () => {
    await expect(service.createTemplate('club-1', { kind: 'ENTRIES', name: 'x', price: 200 }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse un porte-monnaie sans walletAmount', async () => {
    await expect(service.createTemplate('club-1', { kind: 'WALLET', name: 'x', price: 180 }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse un prix nul ou négatif', async () => {
    await expect(service.createTemplate('club-1', { kind: 'ENTRIES', name: 'x', price: 0, entriesCount: 10 }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('updateTemplate refuse une offre d’un autre club', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'autre-club' } as any);
    await expect(service.updateTemplate('tpl-1', 'club-1', { isActive: false }))
      .rejects.toThrow('TEMPLATE_NOT_FOUND');
  });

  it('updateTemplate ne modifie que name/price/validityDays/isActive', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1' } as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-1' } as any);
    await service.updateTemplate('tpl-1', 'club-1', { name: 'Nouveau nom', isActive: false });
    const data = prismaMock.packageTemplate.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('kind');
    expect(data).not.toHaveProperty('entriesCount');
  });
});

describe('PackageService — nextReceiptNo', () => {
  it('upsert le compteur RECEIPT et retourne la valeur', async () => {
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 7 } as any);
    const result = await PackageService.nextReceiptNo(prismaMock as any, 'club-1');
    expect(prismaMock.clubCounter.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId_kind: { clubId: 'club-1', kind: 'RECEIPT' } },
    }));
    expect(result).toBe(7);
  });
});

describe('PackageService — vente en caisse', () => {
  let service: PackageService;
  beforeEach(() => {
    service = new PackageService();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
  });

  const tplEntries = { id: 'tpl-1', clubId: 'club-1', kind: 'ENTRIES', name: '10 entrées', price: 200, entriesCount: 10, walletAmount: null, validityDays: null, isActive: true };

  it('vend un carnet : crée le MemberPackage + le Payment de vente dans une transaction', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue(tplEntries as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1' } as any);
    prismaMock.memberPackage.create.mockResolvedValue({ id: 'pkg-1', kind: 'ENTRIES' } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);

    const out = await service.sellPackage('club-1', 'user-1', { templateId: 'tpl-1', method: 'CARD' });

    expect(prismaMock.memberPackage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubId: 'club-1', userId: 'user-1', creditsTotal: 10, creditsRemaining: 10, amountTotal: null }),
    }));
    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubId: 'club-1', memberPackageId: 'pkg-1', method: 'CARD', receiptNo: 1 }),
    }));
    expect(out.package.id).toBe('pkg-1');
  });

  it('vend un porte-monnaie avec expiration : amountRemaining = walletAmount, expiresAt posé', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ ...tplEntries, id: 'tpl-2', kind: 'WALLET', entriesCount: null, walletAmount: 200, validityDays: 365 } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1' } as any);
    prismaMock.memberPackage.create.mockResolvedValue({ id: 'pkg-2', kind: 'WALLET' } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-2' } as any);

    await service.sellPackage('club-1', 'user-1', { templateId: 'tpl-2' });

    const data = prismaMock.memberPackage.create.mock.calls[0][0].data as any;
    expect(data.creditsTotal).toBeNull();
    expect(Number(data.amountRemaining)).toBe(200);
    expect(data.expiresAt).toBeInstanceOf(Date);
  });

  it('vente payée en ticket CE : exige voucherRef et pose voucherStatus', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue(tplEntries as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1' } as any);

    await expect(service.sellPackage('club-1', 'user-1', { templateId: 'tpl-1', method: 'VOUCHER' }))
      .rejects.toThrow('VALIDATION_ERROR');

    prismaMock.memberPackage.create.mockResolvedValue({ id: 'pkg-1' } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);
    await service.sellPackage('club-1', 'user-1', { templateId: 'tpl-1', method: 'VOUCHER', voucherRef: 'ANCV-123', voucherIssuer: 'ANCV' });
    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: 'VOUCHER', voucherRef: 'ANCV-123', voucherStatus: 'PENDING_REIMBURSEMENT' }),
    }));
  });

  it('refuse une offre inactive ou d’un autre club', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ ...tplEntries, isActive: false } as any);
    await expect(service.sellPackage('club-1', 'user-1', { templateId: 'tpl-1' }))
      .rejects.toThrow('TEMPLATE_NOT_FOUND');
  });

  it('refuse si l’acheteur n’est pas membre du club', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue(tplEntries as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.sellPackage('club-1', 'user-1', { templateId: 'tpl-1' }))
      .rejects.toThrow('MEMBER_NOT_FOUND');
  });
});

describe('PackageService — consommation & soldes', () => {
  let service: PackageService;
  beforeEach(() => { service = new PackageService(); });

  it('consume ENTRIES : décrément conditionnel creditsRemaining >= 1', async () => {
    prismaMock.memberPackage.updateMany.mockResolvedValue({ count: 1 } as any);
    await PackageService.consume(prismaMock as any, { id: 'pkg-1', kind: 'ENTRIES' }, new Prisma.Decimal(25));
    expect(prismaMock.memberPackage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pkg-1', creditsRemaining: { gte: 1 } }),
      data: { creditsRemaining: { decrement: 1 } },
    }));
  });

  it('consume WALLET : décrément conditionnel amountRemaining >= montant', async () => {
    prismaMock.memberPackage.updateMany.mockResolvedValue({ count: 1 } as any);
    const amount = new Prisma.Decimal(25);
    await PackageService.consume(prismaMock as any, { id: 'pkg-2', kind: 'WALLET' }, amount);
    expect(prismaMock.memberPackage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pkg-2', amountRemaining: { gte: amount } }),
      data: { amountRemaining: { decrement: amount } },
    }));
  });

  it('consume lève INSUFFICIENT_BALANCE si le décrément ne touche aucune ligne (solde épuisé, expiré, ou course concurrente)', async () => {
    prismaMock.memberPackage.updateMany.mockResolvedValue({ count: 0 } as any);
    await expect(PackageService.consume(prismaMock as any, { id: 'pkg-1', kind: 'ENTRIES' }, new Prisma.Decimal(25)))
      .rejects.toThrow('INSUFFICIENT_BALANCE');
  });

  it('listMemberPackages renvoie les packages du membre avec le nom de l’offre', async () => {
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    await service.listMemberPackages('club-1', 'user-1');
    expect(prismaMock.memberPackage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clubId: 'club-1', userId: 'user-1' }),
    }));
  });

  it('listMyPackagesBySlug refuse un club inconnu ou suspendu', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.listMyPackagesBySlug('ghost', 'user-1')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});

describe('PackageService — caisse du jour & vouchers', () => {
  let service: PackageService;
  beforeEach(() => {
    service = new PackageService();
    prismaMock.refund.findMany.mockResolvedValue([] as any);
  });

  it('dailySummary borne la journée dans le fuseau du club et totalise par méthode', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' } as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { method: 'CASH', amount: 20 }, { method: 'CASH', amount: 5.5 }, { method: 'CARD', amount: 30 },
    ] as any);

    const out = await service.dailySummary('club-1', '2026-06-10');

    const where = prismaMock.payment.findMany.mock.calls[0][0]!.where as any;
    expect(where.clubId).toBe('club-1');
    // 2026-06-10 00:00 Europe/Paris = 2026-06-09T22:00:00Z (UTC+2 en juin)
    expect((where.createdAt.gte as Date).toISOString()).toBe('2026-06-09T22:00:00.000Z');
    expect((where.createdAt.lt as Date).toISOString()).toBe('2026-06-10T22:00:00.000Z');
    expect(out.totalsByMethod.CASH).toBe('25.50');
    expect(out.totalsByMethod.CARD).toBe('30.00');
    expect(out.collected).toBe('55.50');
  });

  it('dailySummary soustrait les remboursements du jour par méthode et du total encaissé', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' } as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { method: 'CASH', amount: new Prisma.Decimal(20) },
      { method: 'CARD', amount: new Prisma.Decimal(30) },
    ] as any);
    prismaMock.refund.findMany.mockResolvedValue([
      { method: 'CASH', amount: new Prisma.Decimal(5) },
    ] as any);

    const out = await service.dailySummary('club-1', '2026-06-10');

    expect(out.totalsByMethod.CASH).toBe('15.00');
    expect(out.totalsByMethod.CARD).toBe('30.00');
    expect(out.collected).toBe('45.00');
    expect(out.refunded).toBe('5.00');
  });

  it('dailySummary refuse une date invalide', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' } as any);
    await expect(service.dailySummary('club-1', 'pas-une-date')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('setVoucherStatus refuse un paiement non-voucher ou d’un autre club', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({ id: 'pay-1', clubId: 'club-1', method: 'CASH' } as any);
    await expect(service.setVoucherStatus('pay-1', 'club-1', 'REIMBURSED')).rejects.toThrow('PAYMENT_NOT_FOUND');
  });

  it('setVoucherStatus marque remboursé', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({ id: 'pay-1', clubId: 'club-1', method: 'VOUCHER' } as any);
    prismaMock.payment.update.mockResolvedValue({ id: 'pay-1', voucherStatus: 'REIMBURSED' } as any);
    await service.setVoucherStatus('pay-1', 'club-1', 'REIMBURSED');
    expect(prismaMock.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { voucherStatus: 'REIMBURSED' },
    }));
  });
});
