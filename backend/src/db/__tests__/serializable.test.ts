import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { Prisma } from '@prisma/client';
import { serializableTx, isSerializationConflict } from '../serializable';

const p2034 = () =>
  new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: 'test' });

describe('isSerializationConflict', () => {
  it('reconnaît P2034 et les codes Postgres 40001/40P01', () => {
    expect(isSerializationConflict(p2034())).toBe(true);
    expect(isSerializationConflict({ code: '40001' })).toBe(true);
    expect(isSerializationConflict({ code: '40P01' })).toBe(true);
  });
  it('ignore les autres erreurs', () => {
    expect(isSerializationConflict(new Error('SLOT_NO_LONGER_AVAILABLE'))).toBe(false);
    expect(isSerializationConflict(null)).toBe(false);
  });
});

describe('serializableTx', () => {
  beforeEach(() => prismaMock.$transaction.mockReset());

  it('exécute la transaction et renvoie son résultat (1 tentative si succès)', async () => {
    prismaMock.$transaction.mockResolvedValue('ok' as any);
    await expect(serializableTx(async () => 'ok')).resolves.toBe('ok');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejoue sur conflit de sérialisation puis réussit', async () => {
    prismaMock.$transaction
      .mockRejectedValueOnce(p2034())
      .mockResolvedValueOnce('ok' as any);
    await expect(serializableTx(async () => 'ok', { maxAttempts: 4 })).resolves.toBe('ok');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('ne rejoue JAMAIS sur une erreur métier', async () => {
    prismaMock.$transaction.mockRejectedValue(new Error('SLOT_NO_LONGER_AVAILABLE'));
    await expect(serializableTx(async () => 'x')).rejects.toThrow('SLOT_NO_LONGER_AVAILABLE');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('abandonne après maxAttempts si le conflit persiste (relance la dernière erreur)', async () => {
    prismaMock.$transaction.mockRejectedValue(p2034());
    await expect(serializableTx(async () => 'x', { maxAttempts: 3 })).rejects.toThrow('write conflict');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
  });

  it('passe isolationLevel Serializable et le timeout au $transaction', async () => {
    prismaMock.$transaction.mockResolvedValue(undefined as any);
    await serializableTx(async () => undefined, { timeout: 10_000 });
    expect(prismaMock.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 },
    );
  });
});
