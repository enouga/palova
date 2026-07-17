// Helpers purs de la table de marque (J/A) : pointage présence, cible de remplacement,
// file de sélection du banc. Aucun DOM, aucun appel réseau — la logique métier de gestes.
import type { MarkTablePresence } from './api';

/** Cycle de pointage d'un tap dans la grille : ○ pas vu → ✅ présent → ✕ absent → ○. */
export function nextPresence(p: MarkTablePresence): MarkTablePresence {
  return p === 'UNSEEN' ? 'PRESENT' : p === 'PRESENT' ? 'ABSENT' : 'UNSEEN';
}

/** Glyphe affiché pour un statut de présence. */
export function presenceGlyph(p: MarkTablePresence): string {
  return p === 'PRESENT' ? '✅' : p === 'ABSENT' ? '✕' : '○';
}

/** Seul un joueur pointé ABSENT est une cible de remplacement (le J/A n'écarte pas un présent par erreur). */
export function isReplaceableSlot(p: MarkTablePresence): boolean {
  return p === 'ABSENT';
}

/**
 * File de sélection du banc (0 à 2 userId) : tap = ajoute si < 2 ou déjà présent (toggle),
 * ignore un 3e joueur tant que 2 sont déjà sélectionnés (il faut d'abord en retirer un).
 */
export function benchSelectionNext(current: string[], userId: string): string[] {
  if (current.includes(userId)) return current.filter((id) => id !== userId);
  if (current.length >= 2) return current;
  return [...current, userId];
}

/** Libellés FR des codes d'erreur backend de la table de marque. */
export const MARK_TABLE_ERRORS: Record<string, string> = {
  NOT_A_MEMBER: "Ce joueur n'est pas membre du club.",
  ALREADY_REGISTERED: 'Ce joueur est déjà inscrit à ce tournoi.',
  ALREADY_ON_BENCH: 'Ce joueur est déjà sur le banc.',
  BENCH_ENTRY_NOT_FOUND: 'Introuvable sur le banc.',
  REGISTRATION_NOT_FOUND: 'Inscription introuvable.',
  SEX_REQUIRED: 'Ce membre doit renseigner son sexe dans son profil avant de jouer un tableau genré.',
  GENDER_MISMATCH: 'Cette composition ne respecte pas le tableau (genre).',
  TOURNAMENT_NOT_OPEN: "Ce tournoi n'accepte plus d'inscriptions.",
  TOURNAMENT_NOT_YOURS: "Vous n'êtes plus juge-arbitre de ce tournoi.",
  TOURNAMENT_NOT_FOUND: 'Ce tournoi est introuvable.',
  NOT_A_REFEREE: 'Accès réservé aux juges-arbitres du club.',
  PARTNER_IS_SELF: 'Un joueur ne peut pas être apparié avec lui-même.',
};

/** Message d'erreur affichable : code backend connu → libellé FR, sinon le message brut. */
export function markTableErrorLabel(e: unknown): string {
  const msg = (e as Error).message;
  return MARK_TABLE_ERRORS[msg] ?? msg;
}
