import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { PaymentHistoryService } from '../paymentHistory.service';

const ACTIVE = { id: 'club-1', status: 'ACTIVE', timezone: 'Europe/Paris' };

describe('PaymentHistoryService.listMyPaymentsBySlug', () => {
  it('CLUB_NOT_FOUND si club inexistant', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(new PaymentHistoryService().listMyPaymentsBySlug('demo', 'u1')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('mappe montants en centimes + libellés selon la source', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'p1', amount: '25.00', refundedAmount: '0', method: 'CARD', status: 'CAPTURED',
        createdAt: new Date('2026-06-14T12:00:00Z'),
        reservation: { startTime: new Date('2026-06-14T16:00:00Z'), resource: { name: 'Court 2' } },
        memberPackage: null, sourcePackage: null, subscriptionSale: null, tournamentRegistration: null, eventRegistration: null },
      { id: 'p2', amount: '80.00', refundedAmount: '10.00', method: 'ONLINE', status: 'PARTIALLY_REFUNDED',
        createdAt: new Date('2026-06-01T09:00:00Z'),
        reservation: null, memberPackage: { template: { name: 'Carnet 10' } },
        sourcePackage: null, subscriptionSale: null, tournamentRegistration: null, eventRegistration: null },
    ] as any);

    const res = await new PaymentHistoryService().listMyPaymentsBySlug('demo', 'u1');
    expect(res[0]).toMatchObject({ id: 'p1', amountCents: 2500, refundedCents: 0, method: 'CARD' });
    expect(res[0].label).toContain('Court 2');
    expect(res[1]).toMatchObject({ id: 'p2', amountCents: 8000, refundedCents: 1000 });
    expect(res[1].label).toContain('Carnet 10');
  });

  it('scope la requête au club et au joueur (OR multi-relations)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.payment.findMany.mockResolvedValue([] as any);
    await new PaymentHistoryService().listMyPaymentsBySlug('demo', 'u1');
    const arg = (prismaMock.payment.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.OR.length).toBeGreaterThanOrEqual(6);
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.take).toBe(100);
  });
});
