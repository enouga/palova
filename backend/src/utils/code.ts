import { randomInt } from 'crypto';

/** Code de validation à 6 chiffres (avec zéros de tête). */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
