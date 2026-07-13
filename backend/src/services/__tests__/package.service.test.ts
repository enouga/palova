import fs from 'fs';
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

  it('updateTemplate ne modifie que name/description/price/validityDays/isActive', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1' } as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-1' } as any);
    await service.updateTemplate('tpl-1', 'club-1', { name: 'Nouveau nom', isActive: false });
    const data = prismaMock.packageTemplate.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('kind');
    expect(data).not.toHaveProperty('entriesCount');
  });

  it('updateTemplate met à jour sportKeys (validés)', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1', kind: 'ENTRIES' } as any);
    prismaMock.sport.findMany.mockResolvedValue([{ key: 'padel' }, { key: 'tennis' }] as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-1' } as any);
    await service.updateTemplate('tpl-1', 'club-1', { sportKeys: ['padel', 'tennis'] });
    expect(prismaMock.packageTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sportKeys: ['padel', 'tennis'] }),
    }));
  });

  it('updateTemplate refuse un sportKeys inconnu', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1', kind: 'ENTRIES' } as any);
    prismaMock.sport.findMany.mockResolvedValue([{ key: 'padel' }] as any);
    await expect(service.updateTemplate('tpl-1', 'club-1', { sportKeys: ['inconnu'] }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('updateTemplate met à jour entriesCount sur un carnet, refuse ≤ 0', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1', kind: 'ENTRIES' } as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-1' } as any);
    await service.updateTemplate('tpl-1', 'club-1', { entriesCount: 12 });
    expect(prismaMock.packageTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entriesCount: 12 }),
    }));
    await expect(service.updateTemplate('tpl-1', 'club-1', { entriesCount: 0 })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('updateTemplate ignore entriesCount sur un porte-monnaie et walletAmount sur un carnet', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-w', clubId: 'club-1', kind: 'WALLET' } as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-w' } as any);
    await service.updateTemplate('tpl-w', 'club-1', { entriesCount: 99, walletAmount: 250 });
    const data = prismaMock.packageTemplate.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('entriesCount');
    expect(Number(data.walletAmount)).toBe(250);
  });

  it('crée une offre avec description complète (trim), null si absente', async () => {
    prismaMock.packageTemplate.create.mockResolvedValue({ id: 'tpl-3' } as any);
    await service.createTemplate('club-1', { kind: 'ENTRIES', name: '10 entrées', price: 200, entriesCount: 10, description: '  Valable 1 an, non cessible.  ' });
    expect(prismaMock.packageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: 'Valable 1 an, non cessible.' }),
    }));
    await service.createTemplate('club-1', { kind: 'ENTRIES', name: '10 entrées', price: 200, entriesCount: 10 });
    expect(prismaMock.packageTemplate.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: null }),
    }));
  });

  it('updateTemplate met à jour la description (efface si chaîne vide)', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1' } as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-1' } as any);
    await service.updateTemplate('tpl-1', 'club-1', { description: 'Nouvelle description' });
    expect(prismaMock.packageTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: 'Nouvelle description' }),
    }));
    await service.updateTemplate('tpl-1', 'club-1', { description: '   ' });
    expect(prismaMock.packageTemplate.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: null }),
    }));
  });

  it('setImage pose la nouvelle URL et supprime l’ancien fichier uploadé', async () => {
    const unlink = jest.spyOn(fs.promises, 'unlink').mockResolvedValue();
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1', imageUrl: '/uploads/offers/tpl-1-111.jpg' } as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-1', imageUrl: '/uploads/offers/tpl-1-222.jpg' } as any);
    await service.setImage('tpl-1', 'club-1', '/uploads/offers/tpl-1-222.jpg');
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('tpl-1-111.jpg'));
    expect(prismaMock.packageTemplate.update).toHaveBeenCalledWith({ where: { id: 'tpl-1' }, data: { imageUrl: '/uploads/offers/tpl-1-222.jpg' } });
    unlink.mockRestore();
  });

  it('setImage refuse une offre d’un autre club', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'autre' } as any);
    await expect(service.setImage('tpl-1', 'club-1', '/uploads/offers/x.jpg')).rejects.toThrow('TEMPLATE_NOT_FOUND');
  });

  it('updateTemplate avec imageUrl:null supprime le fichier existant', async () => {
    const unlink = jest.spyOn(fs.promises, 'unlink').mockResolvedValue();
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1', imageUrl: '/uploads/offers/tpl-1-111.jpg' } as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-1' } as any);
    await service.updateTemplate('tpl-1', 'club-1', { imageUrl: null });
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('tpl-1-111.jpg'));
    expect(prismaMock.packageTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageUrl: null }),
    }));
    unlink.mockRestore();
  });

  it('crée une offre avec sportKeys validés', async () => {
    prismaMock.sport.findMany.mockResolvedValue([{ key: 'padel' }, { key: 'tennis' }] as any);
    prismaMock.packageTemplate.create.mockResolvedValue({ id: 'tpl-4' } as any);
    await service.createTemplate('club-1', { kind: 'ENTRIES', name: '10 entrées', price: 200, entriesCount: 10, sportKeys: ['padel'] });
    expect(prismaMock.packageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sportKeys: ['padel'] }),
    }));
  });

  it('sportKeys absent → tableau vide par défaut (générique, tous sports)', async () => {
    prismaMock.packageTemplate.create.mockResolvedValue({ id: 'tpl-5' } as any);
    await service.createTemplate('club-1', { kind: 'ENTRIES', name: '10 entrées', price: 200, entriesCount: 10 });
    expect(prismaMock.packageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sportKeys: [] }),
    }));
    expect(prismaMock.sport.findMany).not.toHaveBeenCalled(); // pas de validation si absent
  });

  it('refuse un sportKeys avec une clé inconnue', async () => {
    prismaMock.sport.findMany.mockResolvedValue([{ key: 'padel' }] as any);
    await expect(service.createTemplate('club-1', { kind: 'ENTRIES', name: 'x', price: 200, entriesCount: 10, sportKeys: ['squash'] }))
      .rejects.toThrow('VALIDATION_ERROR');
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

  it('listMyPackagesBySlug sélectionne sportKeys du template', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE' } as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    await service.listMyPackagesBySlug('padel-arena', 'user-1');
    const arg = prismaMock.memberPackage.findMany.mock.calls[0][0] as any;
    expect(arg.include.template.select).toEqual({ name: true, sportKeys: true });
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

  it('dailySummary exclut les méthodes sans argent (MEMBER, SUBSCRIPTION) du total encaissé mais les garde dans totalsByMethod', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' } as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { method: 'CASH', amount: new Prisma.Decimal(40) },
      { method: 'MEMBER', amount: new Prisma.Decimal(25) },
      { method: 'SUBSCRIPTION', amount: new Prisma.Decimal(15) },
    ] as any);
    prismaMock.refund.findMany.mockResolvedValue([
      { method: 'MEMBER', amount: new Prisma.Decimal(10) },
    ] as any);

    const out = await service.dailySummary('club-1', '2026-06-10');

    // totalsByMethod doit lister toutes les méthodes, y compris les non-argent
    expect(out.totalsByMethod.CASH).toBe('40.00');
    expect(out.totalsByMethod.MEMBER).toBe('15.00'); // 25 - 10
    expect(out.totalsByMethod.SUBSCRIPTION).toBe('15.00');
    // collected ne doit compter que les méthodes argent (CASH uniquement ici)
    expect(out.collected).toBe('40.00');
    // refunded ne doit compter que les remboursements argent (MEMBER n'est pas argent)
    expect(out.refunded).toBe('0.00');
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

describe('PackageService — listActiveByClub', () => {
  it('interroge les soldes utilisables du club et expose userId', async () => {
    prismaMock.memberPackage.findMany.mockResolvedValue([
      { id: 'pk-1', userId: 'u1', kind: 'WALLET', amountRemaining: new Prisma.Decimal(130) } as any,
    ]);
    const svc = new PackageService();
    const rows = await svc.listActiveByClub('club-1');
    const arg = prismaMock.memberPackage.findMany.mock.calls[0][0] as any;
    expect(arg.where.clubId).toBe('club-1');
    expect(arg.select.userId).toBe(true);
    // filtre expirés + soldes à zéro
    expect(JSON.stringify(arg.where)).toContain('expiresAt');
    expect(JSON.stringify(arg.where)).toContain('amountRemaining');
    expect(rows).toHaveLength(1);
  });
});

describe('PackageService — recharge d’un solde existant', () => {
  let service: PackageService;
  beforeEach(() => {
    service = new PackageService();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 5 } as any);
    prismaMock.memberPackage.update.mockResolvedValue({ id: 'pkg-1' } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);
  });

  const pkgEntries = { id: 'pkg-1', clubId: 'club-1', userId: 'user-1', kind: 'ENTRIES', creditsRemaining: 3, creditsTotal: 10, amountRemaining: null, amountTotal: null, expiresAt: null, template: { name: 'Carnet 10' } };
  const pkgWallet = { id: 'pkg-2', clubId: 'club-1', userId: 'user-1', kind: 'WALLET', creditsRemaining: null, creditsTotal: null, amountRemaining: new Prisma.Decimal(20), amountTotal: new Prisma.Decimal(50), expiresAt: null, template: { name: 'Porte-monnaie' } };

  it('recharge un carnet : incrémente creditsRemaining + creditsTotal et crée un Payment (pas de note)', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue(pkgEntries as any);
    await service.rechargePackage('club-1', 'user-1', 'pkg-1', { addEntries: 5, price: 100, method: 'CARD' }, 'staff-1');
    expect(prismaMock.memberPackage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pkg-1' },
      data: expect.objectContaining({ creditsRemaining: { increment: 5 }, creditsTotal: { increment: 5 } }),
    }));
    const pay = prismaMock.payment.create.mock.calls[0][0].data as any;
    expect(pay.memberPackageId).toBe('pkg-1');
    expect(Number(pay.amount)).toBe(100);
    expect(pay.method).toBe('CARD');
    expect(pay.receiptNo).toBe(5);
    expect(String(pay.note)).toContain('Recharge');
    expect(prismaMock.memberNote.create).not.toHaveBeenCalled();
  });

  it('recharge un porte-monnaie : incrémente amountRemaining + amountTotal, Payment = montant ajouté', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue(pkgWallet as any);
    await service.rechargePackage('club-1', 'user-1', 'pkg-2', { addAmount: 30, method: 'CASH' }, 'staff-1');
    const data = prismaMock.memberPackage.update.mock.calls[0][0].data as any;
    expect(Number(data.amountRemaining.increment)).toBe(30);
    expect(Number(data.amountTotal.increment)).toBe(30);
    expect(Number((prismaMock.payment.create.mock.calls[0][0].data as any).amount)).toBe(30);
  });

  it('refuse un solde d’un autre club ou d’un autre membre', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue({ ...pkgEntries, clubId: 'autre' } as any);
    await expect(service.rechargePackage('club-1', 'user-1', 'pkg-1', { addEntries: 5, price: 100 }, 's')).rejects.toThrow('PACKAGE_NOT_FOUND');
    prismaMock.memberPackage.findUnique.mockResolvedValue({ ...pkgEntries, userId: 'autre' } as any);
    await expect(service.rechargePackage('club-1', 'user-1', 'pkg-1', { addEntries: 5, price: 100 }, 's')).rejects.toThrow('PACKAGE_NOT_FOUND');
  });

  it('refuse la recharge d’un solde expiré', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue({ ...pkgEntries, expiresAt: new Date(Date.now() - 86_400_000) } as any);
    await expect(service.rechargePackage('club-1', 'user-1', 'pkg-1', { addEntries: 5, price: 100 }, 's')).rejects.toThrow('PACKAGE_EXPIRED');
  });

  it('refuse des quantités/montants invalides', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue(pkgEntries as any);
    await expect(service.rechargePackage('club-1', 'user-1', 'pkg-1', { addEntries: 0, price: 100 }, 's')).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.rechargePackage('club-1', 'user-1', 'pkg-1', { addEntries: 2.5, price: 100 }, 's')).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.rechargePackage('club-1', 'user-1', 'pkg-1', { addEntries: 5, price: 0 }, 's')).rejects.toThrow('VALIDATION_ERROR');
    prismaMock.memberPackage.findUnique.mockResolvedValue(pkgWallet as any);
    await expect(service.rechargePackage('club-1', 'user-1', 'pkg-2', { addAmount: 0 }, 's')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('recharge en ticket CE : exige voucherRef et pose voucherStatus', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue(pkgEntries as any);
    await expect(service.rechargePackage('club-1', 'user-1', 'pkg-1', { addEntries: 5, price: 100, method: 'VOUCHER' }, 's')).rejects.toThrow('VALIDATION_ERROR');
    await service.rechargePackage('club-1', 'user-1', 'pkg-1', { addEntries: 5, price: 100, method: 'VOUCHER', voucherRef: 'ANCV-9' }, 's');
    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: 'VOUCHER', voucherRef: 'ANCV-9', voucherStatus: 'PENDING_REIMBURSEMENT' }),
    }));
  });
});

describe('PackageService — correction d’un solde (sans argent)', () => {
  let service: PackageService;
  beforeEach(() => {
    service = new PackageService();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.memberPackage.update.mockResolvedValue({ id: 'pkg-1' } as any);
    prismaMock.memberNote.create.mockResolvedValue({ id: 'note-1' } as any);
  });

  const pkgEntries = { id: 'pkg-1', clubId: 'club-1', userId: 'user-1', kind: 'ENTRIES', creditsRemaining: 3, creditsTotal: 10, amountRemaining: null, amountTotal: null, expiresAt: null, template: { name: 'Carnet 10' } };
  const pkgWallet = { id: 'pkg-2', clubId: 'club-1', userId: 'user-1', kind: 'WALLET', creditsRemaining: null, creditsTotal: null, amountRemaining: new Prisma.Decimal(20), amountTotal: new Prisma.Decimal(50), expiresAt: null, template: { name: 'Porte-monnaie' } };

  it('corrige un carnet à une cible et journalise dans MemberNote, sans Payment', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue(pkgEntries as any);
    await service.adjustPackage('club-1', 'user-1', 'pkg-1', { newCredits: 8, reason: 'erreur de saisie' }, 'staff-1');
    expect(prismaMock.memberPackage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pkg-1' },
      data: expect.objectContaining({ creditsRemaining: 8 }),
    }));
    const note = prismaMock.memberNote.create.mock.calls[0][0].data as any;
    expect(note).toMatchObject({ clubId: 'club-1', userId: 'user-1', authorId: 'staff-1' });
    expect(note.body).toContain('3');
    expect(note.body).toContain('8');
    expect(note.body).toContain('erreur de saisie');
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it('remonte le total si la cible dépasse le total, sinon le laisse', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue(pkgEntries as any); // total 10
    await service.adjustPackage('club-1', 'user-1', 'pkg-1', { newCredits: 12, reason: 'x' }, 's');
    expect((prismaMock.memberPackage.update.mock.calls[0][0].data as any).creditsTotal).toBe(12);
    prismaMock.memberPackage.update.mockClear();
    await service.adjustPackage('club-1', 'user-1', 'pkg-1', { newCredits: 2, reason: 'x' }, 's');
    const data = prismaMock.memberPackage.update.mock.calls[0][0].data as any;
    expect(data.creditsRemaining).toBe(2);
    expect(data.creditsTotal).toBe(10); // inchangé
  });

  it('corrige un porte-monnaie à un montant cible', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue(pkgWallet as any);
    await service.adjustPackage('club-1', 'user-1', 'pkg-2', { newAmount: 35, reason: 'y' }, 's');
    expect(Number((prismaMock.memberPackage.update.mock.calls[0][0].data as any).amountRemaining)).toBe(35);
  });

  it('refuse une cible négative ou un motif vide', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue(pkgEntries as any);
    await expect(service.adjustPackage('club-1', 'user-1', 'pkg-1', { newCredits: -1, reason: 'x' }, 's')).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.adjustPackage('club-1', 'user-1', 'pkg-1', { newCredits: 5, reason: '  ' }, 's')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse un solde hors périmètre', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue({ ...pkgEntries, clubId: 'autre' } as any);
    await expect(service.adjustPackage('club-1', 'user-1', 'pkg-1', { newCredits: 5, reason: 'x' }, 's')).rejects.toThrow('PACKAGE_NOT_FOUND');
  });
});

describe('PackageService — listTemplates + stats', () => {
  let service: PackageService;
  beforeEach(() => { service = new PackageService(); });

  it('agrège vendus / actifs / outstanding par template', async () => {
    prismaMock.packageTemplate.findMany.mockResolvedValue([
      { id: 'tpl-e', clubId: 'club-1', kind: 'ENTRIES', name: 'Carte 10' },
      { id: 'tpl-w', clubId: 'club-1', kind: 'WALLET', name: 'Avoir 200' },
      { id: 'tpl-none', clubId: 'club-1', kind: 'ENTRIES', name: 'Jamais vendue' },
    ] as any);
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    prismaMock.memberPackage.findMany.mockResolvedValue([
      { templateId: 'tpl-e', kind: 'ENTRIES', creditsRemaining: 3, amountRemaining: null, expiresAt: future },
      { templateId: 'tpl-e', kind: 'ENTRIES', creditsRemaining: 0, amountRemaining: null, expiresAt: future },
      { templateId: 'tpl-w', kind: 'WALLET', creditsRemaining: null, amountRemaining: new Prisma.Decimal(130), expiresAt: future },
      { templateId: 'tpl-w', kind: 'WALLET', creditsRemaining: null, amountRemaining: new Prisma.Decimal(50), expiresAt: past },
    ] as any);

    const out = await service.listTemplates('club-1');

    const byId = Object.fromEntries(out.map((t: any) => [t.id, t.stats]));
    expect(byId['tpl-e']).toEqual({ soldCount: 2, activeCount: 1, outstandingAmount: '0.00' });
    expect(byId['tpl-w']).toEqual({ soldCount: 2, activeCount: 1, outstandingAmount: '130.00' });
    expect(byId['tpl-none']).toEqual({ soldCount: 0, activeCount: 0, outstandingAmount: '0.00' });
  });

  it('ne lit que les member_packages du club', async () => {
    prismaMock.packageTemplate.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    await service.listTemplates('club-1');
    const arg = prismaMock.memberPackage.findMany.mock.calls[0][0] as any;
    expect(arg.where.clubId).toBe('club-1');
  });
});
