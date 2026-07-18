import { LegalDocument, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { LEGAL_VERSIONS } from '../content/legalVersions';

type Db = Prisma.TransactionClient | typeof prisma;

export interface LegalDocStatus { accepted: string | null; current: string }

export class LegalService {
  /** Enregistre une acceptation (insert-only — jamais d'update ni de delete). */
  async record(
    input: { userId: string; document: LegalDocument; context: string; clubId?: string | null },
    db: Db = prisma,
  ) {
    return db.legalAcceptance.create({
      data: {
        userId: input.userId,
        clubId: input.clubId ?? null,
        document: input.document,
        version: LEGAL_VERSIONS[input.document],
        context: input.context,
      },
    });
  }

  /** Dernière version acceptée par document + version courante. cgvSaas : OWNER seulement. */
  async statusFor(userId: string) {
    const [rows, ownsClub] = await Promise.all([
      prisma.legalAcceptance.findMany({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
        select: { document: true, version: true },
      }),
      prisma.clubMember.findFirst({ where: { userId, role: 'OWNER' }, select: { id: true } }),
    ]);
    const latest = (doc: LegalDocument): string | null =>
      rows.find((r) => r.document === doc)?.version ?? null;
    return {
      cgu: { accepted: latest('CGU'), current: LEGAL_VERSIONS.CGU } as LegalDocStatus,
      privacy: { accepted: latest('PRIVACY'), current: LEGAL_VERSIONS.PRIVACY } as LegalDocStatus,
      ...(ownsClub ? { cgvSaas: { accepted: latest('CGV_SAAS'), current: LEGAL_VERSIONS.CGV_SAAS } as LegalDocStatus } : {}),
    };
  }
}

export const legalService = new LegalService();
