import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { AccountingService } from '../accounting.service';

describe('AccountingService.monthlySummary', () => {
  let service: AccountingService;
  beforeEach(() => { service = new AccountingService(); prismaMock.club.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' } as any); });

  it('totalise par méthode net des remboursements (fuseau club)', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { amount: 20, method: 'CASH', createdAt: new Date('2026-06-10T10:00:00Z') },
      { amount: 30, method: 'CARD', createdAt: new Date('2026-06-12T10:00:00Z') },
    ] as any);
    prismaMock.refund.findMany.mockResolvedValue([
      { amount: 5, method: 'CASH', createdAt: new Date('2026-06-12T10:00:00Z') },
    ] as any);
    const out = await service.monthlySummary('club-1', 2026, 6);
    expect(out.totalsByMethod.CASH).toBe('15.00');
    expect(out.totalsByMethod.CARD).toBe('30.00');
    expect(out.collected).toBe('45.00');
    expect(out.refunded).toBe('5.00');
    expect(Array.isArray(out.byDay)).toBe(true);
  });

  it('refuse un mois invalide', async () => {
    await expect(service.monthlySummary('club-1', 2026, 13)).rejects.toThrow('VALIDATION_ERROR');
  });

  it('club inconnu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.monthlySummary('x', 2026, 6)).rejects.toThrow('CLUB_NOT_FOUND');
  });
});

describe('AccountingService.exportCsv', () => {
  let service: AccountingService;
  beforeEach(() => { service = new AccountingService(); prismaMock.club.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' } as any); });

  it('produit un CSV avec en-tête et lignes échappées', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-06-10T08:00:00Z'), receiptNo: 1, method: 'CASH', amount: 20, refundedAmount: 0, payerName: 'Dupont, Jean' },
    ] as any);
    const csv = await service.exportCsv('club-1', '2026-06-01', '2026-06-30');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Date,Recu,Methode,Montant,Rembourse,Payeur');
    expect(lines[1]).toContain('"Dupont, Jean"'); // virgule → quoté
    expect(lines[1]).toContain('CASH');
    expect(lines[1]).toContain('20.00');
  });
});
