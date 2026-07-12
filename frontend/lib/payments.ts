import type { MyPaymentMethod, PaymentMethod } from '@/lib/api';

/** Centimes → « 25,00 € ». */
export function eurosFromCents(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
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
