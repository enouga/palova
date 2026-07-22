import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { WalletService } from '../wallet.service';

const CLUB_A = { slug: 'padel-arena-paris', name: 'Padel Arena Paris', accentColor: '#5e93da' };
const CLUB_B = { slug: 'bordeaux-pala', name: 'Bordeaux Pala', accentColor: '#7c5cff' };

describe('WalletService.listMyWallet', () => {
  let service: WalletService;
  beforeEach(() => { jest.clearAllMocks(); service = new WalletService(); });

  it('groupe abonnements + carnets par club, clubs sans rien omis', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { id: 's1', status: 'ACTIVE', expiresAt: new Date('2027-01-01'), plan: { name: 'Illimité' }, club: CLUB_A },
    ] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([
      { id: 'p1', kind: 'ENTRIES', creditsRemaining: 8, template: { name: 'Carnet 10', sportKeys: ['padel'] }, club: CLUB_B },
      { id: 'p2', kind: 'WALLET', amountRemaining: '45', template: { name: 'Porte-monnaie', sportKeys: [] }, club: CLUB_A },
    ] as any);

    const out = await service.listMyWallet('u1');

    expect(out).toHaveLength(2);
    const a = out.find((e) => e.club.slug === 'padel-arena-paris')!;
    expect(a.club).toEqual(CLUB_A);
    expect(a.subscriptions.map((s: any) => s.id)).toEqual(['s1']);
    expect(a.packages.map((p: any) => p.id)).toEqual(['p2']);
    const b = out.find((e) => e.club.slug === 'bordeaux-pala')!;
    expect(b.subscriptions).toEqual([]);
    expect(b.packages.map((p: any) => p.id)).toEqual(['p1']);
    // le club n'est pas dupliqué dans chaque item (extrait au niveau du groupe)
    expect((a.subscriptions[0] as any).club).toBeUndefined();
  });

  it('ne demande que les abonnements ACTIFS non expirés de clubs ACTIVE', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);

    await service.listMyWallet('u1');

    const subArgs = (prismaMock.subscription.findMany as jest.Mock).mock.calls[0][0];
    expect(subArgs.where.userId).toBe('u1');
    expect(subArgs.where.status).toBe('ACTIVE');
    expect(subArgs.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(subArgs.where.club).toEqual({ status: 'ACTIVE' });
  });

  it('ne demande que les carnets utilisables (non expirés ET solde > 0), miroir de listMyPackagesBySlug', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);

    await service.listMyWallet('u1');

    const packArgs = (prismaMock.memberPackage.findMany as jest.Mock).mock.calls[0][0];
    expect(packArgs.where.userId).toBe('u1');
    expect(packArgs.where.club).toEqual({ status: 'ACTIVE' });
    expect(packArgs.where.AND).toEqual([
      { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
      { OR: [{ creditsRemaining: { gte: 1 } }, { amountRemaining: { gt: 0 } }] },
    ]);
  });

  it('aucun solde nulle part → tableau vide', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    expect(await service.listMyWallet('u1')).toEqual([]);
  });
});
