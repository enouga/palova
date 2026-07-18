import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { LegalService } from '../legal.service';
import { LEGAL_VERSIONS } from '../../content/legalVersions';

describe('LegalService', () => {
  const svc = new LegalService();
  beforeEach(() => jest.clearAllMocks());

  it('record écrit la version courante du document (insert-only)', async () => {
    prismaMock.legalAcceptance.create.mockResolvedValue({ id: 'la1' } as any);
    await svc.record({ userId: 'u1', document: 'CGU', context: 'register' });
    expect(prismaMock.legalAcceptance.create).toHaveBeenCalledWith({
      data: { userId: 'u1', clubId: null, document: 'CGU', version: LEGAL_VERSIONS.CGU, context: 'register' },
    });
  });

  it('statusFor renvoie la dernière version acceptée par document + la courante', async () => {
    prismaMock.legalAcceptance.findMany.mockResolvedValue([
      { document: 'CGU', version: '2026-07-18' },
      { document: 'CGU', version: '2026-01-01' },
    ] as any);
    prismaMock.clubMember.findFirst.mockResolvedValue(null);
    const s = await svc.statusFor('u1');
    expect(s.cgu).toEqual({ accepted: '2026-07-18', current: LEGAL_VERSIONS.CGU });
    expect(s.privacy.accepted).toBeNull();
    expect(s).not.toHaveProperty('cgvSaas');
  });

  it('statusFor expose cgvSaas seulement pour un OWNER de club', async () => {
    prismaMock.legalAcceptance.findMany.mockResolvedValue([]);
    prismaMock.clubMember.findFirst.mockResolvedValue({ id: 'cm1' } as any);
    const s = await svc.statusFor('u1');
    expect(s.cgvSaas).toEqual({ accepted: null, current: LEGAL_VERSIONS.CGV_SAAS });
  });
});
