/**
 * Vrai si `siret` = 14 chiffres avec clé de Luhn valide (validation locale, avant envoi).
 * Miroir de backend/src/services/siret.service.ts `siretIsValidFormat` — garder synchro.
 * La vérification API d'État reste faite côté serveur (seule source de vérité).
 */
export function siretIsValidFormat(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = siret.charCodeAt(i) - 48;
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
