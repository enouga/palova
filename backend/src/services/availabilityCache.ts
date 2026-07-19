// Micro-cache en mémoire des disponibilités d'un club (rush de minuit : des
// centaines de clients rafraîchissent la même grille — TTL court + single-flight
// écrasent la horde en ~1 calcul par clé et par fenêtre, sans jamais servir une
// donnée plus vieille que le TTL). Process-local : le backend est mono-instance
// (comme les canaux SSE) et toute écriture qui change une disponibilité passe par
// ce process, qui invalide ici. Passage en multi-instance un jour → remplacer par
// Redis (même chantier que le pub/sub SSE).

type Entry = {
  clubId: string | null; // null tant que le calcul est en vol (slug pas encore résolu)
  expiresAt: number;
  promise: Promise<{ clubId: string; payload: unknown }>;
};

const cache = new Map<string, Entry>();

// Garde-fou mémoire : les clés dépendent de paramètres client (date/durée) — au-delà
// de ce seuil on purge les entrées expirées (TTL court → la purge suffit).
const MAX_ENTRIES = 1_000;

// TTL 0 sous jest : les suites de routes mockent Prisma requête par requête, un
// cache partagé entre tests fausserait leurs assertions. Les tests du cache le
// réactivent explicitement via _setAvailabilityCacheTtl.
let ttlMs = process.env.NODE_ENV === 'test' ? 0 : 2_000;

export function _setAvailabilityCacheTtl(ms: number): void { ttlMs = ms; }
export function _clearAvailabilityCache(): void { cache.clear(); }

function sweepExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

/**
 * Résout `compute()` au plus une fois par clé et par fenêtre de TTL, appels
 * concurrents compris (single-flight). Une erreur n'est jamais mise en cache.
 */
export async function cachedClubAvailability<T>(
  key: string,
  compute: () => Promise<{ clubId: string; payload: T }>,
): Promise<T> {
  if (ttlMs <= 0) return (await compute()).payload;

  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return (hit.promise as Promise<{ clubId: string; payload: T }>).then((v) => v.payload);
  }

  if (cache.size >= MAX_ENTRIES) sweepExpired(now);

  const entry: Entry = { clubId: null, expiresAt: now + ttlMs, promise: undefined! };
  entry.promise = compute().then(
    (v) => { entry.clubId = v.clubId; return v; },
    (err) => {
      // Jamais de cache négatif : la prochaine requête retente.
      if (cache.get(key) === entry) cache.delete(key);
      throw err;
    },
  );
  cache.set(key, entry);
  return (entry.promise as Promise<{ clubId: string; payload: T }>).then((v) => v.payload);
}

/**
 * Purge les disponibilités en cache d'un club — appelée par toute écriture qui
 * change une disponibilité (hold, confirmation, annulation, déplacement, cleanup).
 * Les entrées encore en vol (club inconnu) sont purgées par prudence ; une
 * invalidation manquée ailleurs se répare seule à l'expiration du TTL.
 */
export function invalidateClubAvailability(clubId: string): void {
  for (const [key, entry] of cache) {
    if (entry.clubId === clubId || entry.clubId === null) cache.delete(key);
  }
}
