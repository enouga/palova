import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { PromotionService, loadActivePromotions } from '../promotion.service';

const svc = new PromotionService();
const validBody = {
  name: 'Promo été', startDate: '2026-08-01', endDate: '2026-08-31',
  kind: 'PERCENT' as const, percentOff: 20, resourceIds: [] as string[],
};

beforeEach(() => { jest.clearAllMocks(); });

describe('createPromotion — validation', () => {
  it('refuse un nom vide', async () => {
    await expect(svc.createPromotion('club-1', { ...validBody, name: '  ' })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('refuse startDate > endDate', async () => {
    await expect(svc.createPromotion('club-1', { ...validBody, startDate: '2026-09-01', endDate: '2026-08-01' })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('refuse percentOff hors 1..100', async () => {
    await expect(svc.createPromotion('club-1', { ...validBody, percentOff: 0 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(svc.createPromotion('club-1', { ...validBody, percentOff: 150 })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('refuse FIXED sans fixedPrice valide', async () => {
    await expect(svc.createPromotion('club-1', { ...validBody, kind: 'FIXED', percentOff: undefined, fixedPrice: -1 })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('refuse une fenêtre incohérente (start >= end)', async () => {
    await expect(svc.createPromotion('club-1', { ...validBody, windowStart: 1200, windowEnd: 1080 })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('refuse un terrain n’appartenant pas au club', async () => {
    prismaMock.resource.findMany.mockResolvedValue([] as any);
    await expect(svc.createPromotion('club-1', { ...validBody, resourceIds: ['court-x'] })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('crée une promo % valide (DTO shape)', async () => {
    prismaMock.promotion.create.mockResolvedValue({
      id: 'promo-1', clubId: 'club-1', name: 'Promo été',
      startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-31T00:00:00Z'),
      windowStart: null, windowEnd: null, kind: 'PERCENT', percentOff: 20, fixedPrice: null,
      enabled: true, createdAt: new Date('2026-07-15T00:00:00Z'), resources: [],
    } as any);
    const dto = await svc.createPromotion('club-1', validBody);
    expect(dto).toMatchObject({ id: 'promo-1', kind: 'PERCENT', percentOff: 20, startDate: '2026-08-01', endDate: '2026-08-31', resourceIds: [] });
  });
});

describe('updatePromotion / deletePromotion — garde club', () => {
  it('update d’une promo d’un autre club → PROMOTION_NOT_FOUND', async () => {
    prismaMock.promotion.findUnique.mockResolvedValue({ id: 'promo-1', clubId: 'autre', resources: [] } as any);
    await expect(svc.updatePromotion('promo-1', 'club-1', { name: 'X' })).rejects.toThrow('PROMOTION_NOT_FOUND');
  });
  it('delete d’une promo inconnue → PROMOTION_NOT_FOUND', async () => {
    prismaMock.promotion.findUnique.mockResolvedValue(null as any);
    await expect(svc.deletePromotion('promo-1', 'club-1')).rejects.toThrow('PROMOTION_NOT_FOUND');
  });

  it('update succès : bascule PERCENT→FIXED (nulle percentOff) + remplace les terrains, DTO', async () => {
    prismaMock.promotion.findUnique.mockResolvedValue({
      id: 'promo-1', clubId: 'club-1', name: 'Été', startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-31T00:00:00Z'),
      windowStart: null, windowEnd: null, kind: 'PERCENT', percentOff: 20, fixedPrice: null, enabled: true,
      createdAt: new Date('2026-07-15T00:00:00Z'), resources: [{ resourceId: 'court-1' }],
    } as any);
    prismaMock.resource.findMany.mockResolvedValue([{ id: 'court-2' }] as any); // validate : terrain du club
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.promotionResource.deleteMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.promotionResource.createMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.promotion.update.mockResolvedValue({
      id: 'promo-1', clubId: 'club-1', name: 'Été', startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-31T00:00:00Z'),
      windowStart: null, windowEnd: null, kind: 'FIXED', percentOff: null, fixedPrice: '15.00', enabled: true,
      createdAt: new Date('2026-07-15T00:00:00Z'), resources: [{ resourceId: 'court-2' }],
    } as any);

    const dto = await svc.updatePromotion('promo-1', 'club-1', { kind: 'FIXED', fixedPrice: 15, resourceIds: ['court-2'] });

    // la mutation passe par une transaction
    expect(prismaMock.$transaction).toHaveBeenCalled();
    // cohérence kind : percentOff mis à null, fixedPrice posé
    const updateData = (prismaMock.promotion.update as jest.Mock).mock.calls[0][0].data;
    expect(updateData).toMatchObject({ kind: 'FIXED', percentOff: null });
    expect(updateData.fixedPrice).toBeTruthy();
    // remplacement des terrains
    expect(prismaMock.promotionResource.deleteMany).toHaveBeenCalledWith({ where: { promotionId: 'promo-1' } });
    expect(prismaMock.promotionResource.createMany).toHaveBeenCalledWith({ data: [{ promotionId: 'promo-1', resourceId: 'court-2' }] });
    // DTO
    expect(dto).toMatchObject({ id: 'promo-1', kind: 'FIXED', fixedPrice: '15.00', resourceIds: ['court-2'] });
  });

  it('delete succès : appelle promotion.delete et renvoie { ok: true }', async () => {
    prismaMock.promotion.findUnique.mockResolvedValue({ id: 'promo-1', clubId: 'club-1' } as any);
    prismaMock.promotion.delete.mockResolvedValue({ id: 'promo-1' } as any);
    const res = await svc.deletePromotion('promo-1', 'club-1');
    expect(prismaMock.promotion.delete).toHaveBeenCalledWith({ where: { id: 'promo-1' } });
    expect(res).toEqual({ ok: true });
  });
});

describe('loadActivePromotions', () => {
  it('mappe les lignes en ActivePromo (Decimal→cents, resources→ids)', async () => {
    prismaMock.promotion.findMany.mockResolvedValue([
      { name: 'Fixe', kind: 'FIXED', percentOff: null, fixedPrice: '15.00', windowStart: 1080, windowEnd: 1200, resources: [{ resourceId: 'court-1' }] },
    ] as any);
    const promos = await loadActivePromotions('club-1', '2026-08-15');
    expect(promos).toEqual([
      { name: 'Fixe', kind: 'FIXED', percentOff: null, fixedPriceCents: 1500, windowStart: 1080, windowEnd: 1200, resourceIds: ['court-1'] },
    ]);
    const where = (prismaMock.promotion.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ clubId: 'club-1', enabled: true });
    expect(where.startDate.lte).toEqual(new Date('2026-08-15T00:00:00.000Z'));
    expect(where.endDate.gte).toEqual(new Date('2026-08-15T00:00:00.000Z'));
  });
});
