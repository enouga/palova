import { prisma } from '../db/prisma';

export const PSEUDO_REGEX = /^[A-Za-z0-9_-]{3,20}$/;
export const PSEUDO_FORMAT_ERROR = 'Le pseudo doit contenir 3 à 20 caractères (lettres, chiffres, - ou _), sans espace ni accent.';
export const PSEUDO_TAKEN_ERROR = 'Ce pseudo est déjà pris.';

/**
 * Normalise et valide un pseudo brut : trim, format, puis conflit d'unicité (insensible à
 * la casse) sur la plateforme, EXCLUANT `excludeUserId`. L'auto-édition (routes/me.ts)
 * exclut l'utilisateur courant ; l'édition staff (ClubService.updateMembership) exclut le
 * membre édité, jamais l'acteur — c'est le membre édité qui va porter la valeur.
 * Renvoie la valeur normalisée à écrire (`null` efface le pseudo), ou lève
 * `PSEUDO_INVALID` (format) / `PSEUDO_TAKEN` (conflit).
 */
export async function normalizePseudo(raw: unknown, excludeUserId: string): Promise<string | null> {
  if (raw === null) return null;
  if (typeof raw !== 'string') throw new Error('PSEUDO_INVALID');
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!PSEUDO_REGEX.test(trimmed)) throw new Error('PSEUDO_INVALID');
  const conflict = await prisma.user.findFirst({
    where: { pseudo: { equals: trimmed, mode: 'insensitive' }, NOT: { id: excludeUserId } },
    select: { id: true },
  });
  if (conflict) throw new Error('PSEUDO_TAKEN');
  return trimmed;
}
