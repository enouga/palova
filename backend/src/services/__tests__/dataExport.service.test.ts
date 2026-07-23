import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { DataExportService } from '../dataExport.service';

describe('DataExportService', () => {
  it('agrège les données du seul demandeur', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'e@x.fr', firstName: 'E', lastName: 'N' } as never);
    const out = await new DataExportService().buildExport('u1');
    expect(out.profile).toEqual(expect.objectContaining({ email: 'e@x.fr' }));
    expect(out).toHaveProperty('reservations');
    expect(out).toHaveProperty('legalAcceptances');
    expect(typeof out.generatedAt).toBe('string');
  });

  it("le profil exporté inclut l'adresse postale (rue/CP/ville)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'e@x.fr', address: '12 rue du Padel', postalCode: '75001', city: 'Paris',
    } as never);
    const out = await new DataExportService().buildExport('u1');
    expect(out.profile).toEqual(expect.objectContaining({
      address: '12 rue du Padel', postalCode: '75001', city: 'Paris',
    }));
    const profileCall = prismaMock.user.findUnique.mock.calls[0][0] as any;
    expect(profileCall?.select).toEqual(expect.objectContaining({
      address: true, postalCode: true, city: true,
    }));
  });

  it('les requêtes messages ne ciblent que les messages ENVOYÉS par le demandeur', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' } as never);
    await new DataExportService().buildExport('u1');
    const dmCall = prismaMock.directMessage.findMany.mock.calls[0][0];
    expect(JSON.stringify(dmCall?.where)).toContain('u1');
    expect(JSON.stringify(dmCall?.where)).not.toContain('conversation');
    const matchCall = prismaMock.openMatchMessage.findMany.mock.calls[0][0];
    expect(matchCall?.where).toEqual({ userId: 'u1' });
  });

  it('les paiements sont cherchés via toutes les sources possibles, scopées au demandeur', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' } as never);
    await new DataExportService().buildExport('u1');
    const paymentCall = prismaMock.payment.findMany.mock.calls[0][0];
    expect(JSON.stringify(paymentCall?.where)).toContain('u1');
  });
});
