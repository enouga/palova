import type { MyPaymentMethod, PaymentMethod } from '@/lib/api';

/** Centimes → « 25,00 € ». */
export function eurosFromCents(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

/** Chaîne (ou nombre) décimale euros (ex. Decimal Prisma sérialisé, "25.00") → « 25,00 € ». */
export function eurosFromString(value: string | number): string {
  return `${Number(value).toFixed(2).replace('.', ',')} €`;
}

const THOUSANDS_SEPARATORS = /[   ]/g;

/** Centimes → « 29 € » / « 1 010 € » (séparateur de milliers, sans décimales inutiles).
 *  toLocaleString('fr-FR') sépare les milliers par une espace insécable/fine (U+00A0/U+202F,
 *  selon la version d'ICU) — normalisée ici en espace normale pour un rendu prévisible. */
export function eurosCompact(cents: number): string {
  const value = cents / 100;
  const s = (Number.isInteger(value)
    ? value.toLocaleString('fr-FR')
    : value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  ).replace(THOUSANDS_SEPARATORS, ' ');
  return `${s} €`;
}

/** Nombre ou chaîne d'euros → « 25 » / « 25,50 » (sans le signe € — le caller l'ajoute en JSX). */
export function eurosTrim(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Espèces',
  CARD: 'Carte',
  TRANSFER: 'Virement',
  ONLINE: 'Carte en ligne',
  OTHER: 'Autre',
  VOUCHER: 'Ticket CE',
  CHEQUE: 'Chèque',
  CLUB: 'Au club',
  PACK_CREDIT: 'Carnet',
  WALLET: 'Porte-monnaie',
  MEMBER: 'Abonnement',
  SUBSCRIPTION: 'Abonnement',
};

export function paymentMethodLabel(method: PaymentMethod): string {
  return METHOD_LABELS[method] ?? method;
}

/** « Visa •••• 4242 · exp 04/2027 », repli « Carte enregistrée » si détails manquants. */
export function cardLabel(pm: MyPaymentMethod): string {
  if (!pm.last4) return 'Carte enregistrée';
  const brand = pm.brand ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1) : 'Carte';
  const exp = pm.expMonth && pm.expYear ? ` · exp ${String(pm.expMonth).padStart(2, '0')}/${pm.expYear}` : '';
  return `${brand} •••• ${pm.last4}${exp}`;
}
