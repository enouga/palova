import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Un conflit de sérialisation (Postgres 40001 → Prisma P2034) ou un deadlock (40P01)
 * est un échec TRANSITOIRE d'une transaction Serializable : la transaction a été
 * intégralement annulée, la bonne réponse est de la rejouer, pas de renvoyer une erreur.
 */
export function isSerializationConflict(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') return true;
  const code = (e as { code?: unknown } | null)?.code;
  return code === '40001' || code === '40P01';
}

/**
 * Exécute une transaction Serializable en la rejouant automatiquement sur conflit de
 * sérialisation (jusqu'à `maxAttempts`, backoff léger). Toute autre erreur — métier,
 * validation, indisponibilité — remonte inchangée sans retry.
 *
 * ⚠️ Le callback est ré-exécuté à chaque tentative : il ne doit contenir QUE des
 * opérations DB (via `tx`). Les effets de bord externes (Stripe, email, SSE, Redis)
 * restent HORS de la transaction, dans l'appelant (pattern déjà en place partout).
 */
export async function serializableTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeout?: number; maxAttempts?: number },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        ...(options?.timeout != null ? { timeout: options.timeout } : {}),
      });
    } catch (e) {
      lastErr = e;
      if (!isSerializationConflict(e) || attempt >= maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, attempt * 20)); // 20 / 40 / 60 ms
    }
  }
  throw lastErr; // inatteignable (la boucle retourne ou throw), présent pour le typage
}
