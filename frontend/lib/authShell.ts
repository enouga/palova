import type { IconName } from '@/components/ui/Icon';

export type AuthAudience = 'player' | 'club';

export interface AuthPanelCopy {
  headline: string;
  line: string;
  chips: { icon: IconName; label: string }[];
}

/** Copy du panneau de marque des pages d'auth, par audience (hôte plateforme). */
export const PANEL_COPY: Record<AuthAudience, AuthPanelCopy> = {
  player: {
    headline: 'Le sport en club, simplifié.',
    line: 'Réservation en direct, tournois, parties ouvertes — dans tous les clubs Palova.',
    chips: [
      { icon: 'bolt', label: 'Dispos en direct' },
      { icon: 'trophy', label: 'Tournois & events' },
      { icon: 'users', label: 'Parties ouvertes' },
    ],
  },
  club: {
    headline: 'Votre club en ligne, simplement.',
    line: 'Planning, encaissement, tournois : le quotidien du club géré depuis un seul endroit.',
    chips: [
      { icon: 'calendar', label: 'Planning & résas' },
      { icon: 'euro', label: 'Caisse & offres' },
      { icon: 'trophy', label: 'Tournois' },
    ],
  },
};

/** Ligne du panneau quand l'identité d'un club habille la page (hôte club). */
export const CLUB_PANEL_LINE =
  'Réservez vos terrains, rejoignez les tournois et les parties ouvertes du club.';

/**
 * Lavis clair dérivé de la couleur d'accent d'un club : dégradé de deux mixes
 * très clairs de l'accent vers un blanc cassé. L'encre fixe HERO_INK reste
 * lisible quelle que soit la couleur du club (jamais de panneau saturé/sombre).
 */
export function clubPanelWash(accent: string): string {
  return `linear-gradient(115deg, color-mix(in srgb, ${accent} 12%, #fdfdfc), color-mix(in srgb, ${accent} 30%, #fdfdfc))`;
}
