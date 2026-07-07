// Helpers PURS de présentation de la facturation SaaS côté superadmin (libellés FR,
// périodes). Aucune dépendance DOM. Miroir de l'esprit de lib/memberStats.ts.
import type { BillingState } from '@/lib/api';

export const BILLING_STATE_LABEL: Record<BillingState, string> = {
  EXEMPT: 'Exonéré',
  FREE: 'Gratuit',
  OK: 'Actif',
  TO_REGULARIZE: 'À régulariser',
  PAST_DUE: 'Impayé',
};

const INVOICE_STATUS_LABEL: Record<string, string> = {
  paid: 'Payée',
  failed: 'Échec',
  open: 'En attente',
  void: 'Annulée',
  uncollectible: 'Irrécouvrable',
};

/** Libellé FR d'un statut de facture (repli : la clé brute). */
export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABEL[status] ?? status;
}

/** 'month' → « mensuel », 'year' → « annuel ». */
export function intervalLabel(interval: string | null | undefined): string {
  return interval === 'year' ? 'annuel' : interval === 'month' ? 'mensuel' : '—';
}

/** Date ISO → « 1 août 2026 » (fuseau du navigateur), ou '—' si absente. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(iso));
}

/** Plage de facturation « 1 juil. → 1 août 2026 » (ou '—'). */
export function formatPeriod(startIso: string | null | undefined, endIso: string | null | undefined): string {
  if (!startIso && !endIso) return '—';
  const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const a = startIso ? fmt.format(new Date(startIso)) : '…';
  const b = endIso ? fmt.format(new Date(endIso)) : '…';
  return `${a} → ${b}`;
}
