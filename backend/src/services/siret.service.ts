// Validation + vérification d'un SIRET français. Seule porte vers l'API entreprises :
// swappable (Sirene INSEE…) sans toucher au reste du code. Miroir géo : geo.service.ts.
const API_URL = 'https://recherche-entreprises.api.gouv.fr/search';
const TIMEOUT_MS = 5000;

/**
 * Vrai si `siret` = exactement 14 chiffres avec une clé de Luhn valide (contrôle hors réseau).
 * Miroir client : frontend/lib/siret.ts — garder les deux synchronisés.
 * NB : les SIRET de La Poste (356 000 000 xxxxx) ne respectent pas Luhn — non géré (hors périmètre padel).
 */
export function siretIsValidFormat(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = siret.charCodeAt(i) - 48; // '0' = 48
    // Luhn : on double un chiffre sur deux en partant de la droite (positions paires depuis la gauche pour 14 chiffres).
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
