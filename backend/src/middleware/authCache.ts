import { prisma } from '../db/prisma';

// Cache en mémoire de l'identité revérifiée à chaque requête authentifiée
// (tokenVersion/deletedAt, audit pré-MEP §2.2). Sans lui, CHAQUE appel API
// authentifié paie un SELECT user — ~40 % du SQL du chemin chaud au rush de
// minuit (un F5 de la page Réserver = ~6 appels authentifiés). TTL court :
// une révocation « naturelle » est visible sous 30 s, et les deux écritures
// révocantes du process (reset mot de passe, suppression de compte) appellent
// invalidateAuthIdentity → effet immédiat. Process-local, comme availabilityCache :
// à revoir (Redis) si le backend devient multi-instance.

export interface AuthIdentity {
  tokenVersion: number;
  deleted: boolean;
}

type Entry = { value: AuthIdentity; expiresAt: number };

const cache = new Map<string, Entry>();

// Garde-fou mémoire (clé = userId issu d'un JWT vérifié → borné par les vrais
// comptes, mais on purge quand même les entrées expirées au-delà du seuil).
const MAX_ENTRIES = 10_000;

// TTL 0 sous jest : les suites de routes mockent user.findUnique requête par
// requête — un cache partagé entre tests fausserait leurs assertions.
let ttlMs = process.env.NODE_ENV === 'test' ? 0 : 30_000;

export function _setAuthCacheTtl(ms: number): void { ttlMs = ms; }
export function _clearAuthCache(): void { cache.clear(); }

function sweepExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

/** Identité minimale d'un utilisateur pour la validation de token (null = introuvable). */
export async function getAuthIdentity(userId: string): Promise<AuthIdentity | null> {
  const now = Date.now();
  if (ttlMs > 0) {
    const hit = cache.get(userId);
    if (hit && hit.expiresAt > now) return hit.value;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true, deletedAt: true },
  });
  if (!user) return null; // jamais de cache négatif : un id fantôme ne coûte qu'à celui qui le forge

  const value: AuthIdentity = {
    tokenVersion: user.tokenVersion ?? 0,
    deleted: user.deletedAt != null,
  };
  if (ttlMs > 0) {
    if (cache.size >= MAX_ENTRIES) sweepExpired(now);
    cache.set(userId, { value, expiresAt: now + ttlMs });
  }
  return value;
}

/** À appeler après toute écriture qui révoque des tokens (tokenVersion++, deletedAt). */
export function invalidateAuthIdentity(userId: string): void {
  cache.delete(userId);
}
