// Helpers PURS de la page Mon profil. Aucune horloge, aucun fetch, aucun JSX.
// Miroir de lib/adminSettings.ts (Réglages du club) — même mécanique baseline/brouillon.
import type { MyProfile, Sex } from '@/lib/api';

export type ProfileTabKey = 'identite' | 'niveau' | 'preferences' | 'portefeuille' | 'securite';

export const PROFILE_TABS: { key: ProfileTabKey; label: string }[] = [
  { key: 'identite',     label: 'Identité' },
  { key: 'niveau',       label: 'Niveau' },
  { key: 'preferences',  label: 'Préférences' },
  { key: 'portefeuille', label: 'Portefeuille' },
  { key: 'securite',     label: 'Sécurité' },
];

/** Lit `?tab=` d'une query string ; défaut et valeur inconnue → 'identite'. */
export function parseProfileTab(search: string): ProfileTabKey {
  const raw = new URLSearchParams(search).get('tab');
  return PROFILE_TABS.some((t) => t.key === raw) ? (raw as ProfileTabKey) : 'identite';
}

/** Corps du PATCH /api/me. Assignable au paramètre de `api.updateMyProfile` (champs optionnels). */
export interface UpdateProfileBody {
  phone: string | null;
  sex: Sex | null;
  birthDate: string | null;
  preferredSportId: string | null;
  locale: string | null;
  showInLeaderboard: boolean;
  autoMatchProposals: boolean;
  acceptsFriendRequests: boolean;
  acceptsDirectMessages: boolean;
}

/**
 * UNIQUE source de vérité des champs enregistrés — sert aussi au calcul isDirty.
 * ⚠️ Tout champ éditable d'un onglet DOIT figurer ici, sinon il est silencieusement
 * non-dirty et non-sauvé (piège documenté côté Réglages : showOtherClubsReservations).
 *
 * Trois normalisations, parce que la forme de LECTURE diffère de celle du FORMULAIRE :
 *  - preferredSport est un objet en lecture, un id en écriture ;
 *  - birthDate est un ISO complet en lecture, un YYYY-MM-DD dans le formulaire ;
 *  - locale absente s'affiche « fr » dans le <select>, donc vaut « fr » ici.
 * Les deux côtés passant par ce builder, ni un retour serveur en ISO ni une locale
 * nulle affichée « Français » ne rendent la page dirty sans changement visible.
 */
export function buildProfileBody(p: MyProfile): UpdateProfileBody {
  return {
    phone: p.phone?.trim() || null,
    sex: p.sex,
    birthDate: p.birthDate ? p.birthDate.slice(0, 10) : null,
    preferredSportId: p.preferredSport?.id ?? null,
    locale: p.locale ?? 'fr',
    showInLeaderboard: p.showInLeaderboard,
    autoMatchProposals: p.autoMatchProposals,
    acceptsFriendRequests: p.acceptsFriendRequests,
    acceptsDirectMessages: p.acceptsDirectMessages,
  };
}

/** Vrai si le brouillon diffère de la baseline sur un champ enregistré. */
export function isDirty(server: MyProfile, draft: MyProfile): boolean {
  return JSON.stringify(buildProfileBody(server)) !== JSON.stringify(buildProfileBody(draft));
}

/** Licence = seconde ressource (endpoint distinct). Comparaison trim, comme l'envoi. */
export function licenceDirty(server: string, draft: string): boolean {
  return server.trim() !== draft.trim();
}
