import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

export type Context = { prisma: PrismaClient };
export type MockContext = { prisma: DeepMockProxy<PrismaClient> };

export const prismaMock = mockDeep<PrismaClient>();

jest.mock('../db/prisma', () => ({
  __esModule: true,
  prisma: prismaMock,
}));

beforeEach(() => {
  mockReset(prismaMock);
  // authMiddleware/optionalAuth revérifient l'identité en base (tokenVersion/deletedAt,
  // cf. audit pré-MEP §2.2) sur CHAQUE requête authentifiée. Défaut sûr pour ne pas casser
  // les ~60 suites de routes qui n'ont jamais eu à mocker user.findUnique pour ça : un test
  // qui a besoin d'un vrai profil peut toujours écraser ce mock avec le sien.
  prismaMock.user.findUnique.mockResolvedValue({ deletedAt: null } as never);
});
