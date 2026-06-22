import { prisma } from '../../db/prisma';

/**
 * Résout la clé du sport pour les vues personnelles de niveau.
 * Priorité :
 *   1. `override` si c'est une chaîne non vide (ex. `?sport=tennis`)
 *   2. Sport préféré du joueur (`User.preferredSport.key`)
 *   3. Fallback : `'padel'`
 *
 * Réutilisable par le leaderboard et toute autre vue filtrée par sport.
 */
export async function resolvePreferredSportKey(userId: string, override?: unknown): Promise<string> {
  if (typeof override === 'string' && override) return override;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferredSport: { select: { key: true } } },
  });
  return u?.preferredSport?.key ?? 'padel';
}
