/**
 * Durée de blocage d'un créneau (hold) partagée par les services et le job de nettoyage.
 * Source unique de vérité — modifier ici suffit à garder tout synchronisé.
 */
export const HOLD_TTL_SECONDS = 300;  // 5 minutes
export const HOLD_EXPIRY_MINUTES = 5;
