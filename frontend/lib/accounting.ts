import { fmtEuros, toCents } from '@/lib/caisse';
import type { PaymentMethod } from '@/lib/api';

/** Libellé lisible d'un mois : ex. "juin 2026". Déterministe, ne s'exécute pas
 *  au niveau module — accepte des nombres year/month (month = 1-based). */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/** Premier et dernier jour d'un mois sous forme YYYY-MM-DD.
 *  Exemple : monthRange(2026, 6) → { from: "2026-06-01", to: "2026-06-30" } */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = `${year}-${pad(month)}-01`;
  // Dernier jour : jour 0 du mois suivant
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${pad(month)}-${pad(last)}`;
  return { from, to };
}

const METHOD_LABEL: Partial<Record<PaymentMethod, string>> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre',
  VOUCHER: 'Ticket CE', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre',
};

/** Libellé d'une méthode de paiement (clé brute si inconnue). */
export function methodLabel(method: string): string {
  return METHOD_LABEL[method as PaymentMethod] ?? method;
}

/** Formate un montant string API ("52.00") en euros affichables. */
export function fmtAmount(v: string): string {
  return fmtEuros(toCents(v));
}
