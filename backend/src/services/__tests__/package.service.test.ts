import '../../__mocks__/prisma';
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
