import type { MemberPackage, ActiveMemberPackage } from '@/lib/api';
import type { IconName } from '@/components/ui/Icon';

/** Libellé court d'un solde : « Carnet — 7 entrées » / « Porte-monnaie — 53,50 € ». */
export function packageLabel(p: MemberPackage): string {
  if (p.kind === 'ENTRIES') {
    const n = p.creditsRemaining ?? 0;
    return `Carnet — ${n} entrée${n > 1 ? 's' : ''}`;
  }
  return `Porte-monnaie — ${Number(p.amountRemaining ?? 0).toFixed(2).replace('.', ',')} €`;
}

/**
 * Décompose un solde pour un affichage structuré (icône + label + valeur) — alimente `StatPill`.
 * Même formatage des montants que `packageLabel`, mais label et valeur séparés.
 */
export function packageParts(p: MemberPackage): { icon: IconName; label: string; value: string } {
  if (p.kind === 'ENTRIES') {
    const n = p.creditsRemaining ?? 0;
    return { icon: 'ticket', label: 'Carnet', value: `${n} entrée${n > 1 ? 's' : ''}` };
  }
  return {
    icon: 'wallet',
    label: 'Porte-monnaie',
    value: `${Number(p.amountRemaining ?? 0).toFixed(2).replace('.', ',')} €`,
  };
}

/** Un package est utilisable s'il a du solde et n'est pas expiré. */
export function isUsable(p: MemberPackage, now: Date = new Date()): boolean {
  if (p.expiresAt && new Date(p.expiresAt) <= now) return false;
  return p.kind === 'ENTRIES' ? (p.creditsRemaining ?? 0) >= 1 : Number(p.amountRemaining ?? 0) > 0;
}

/** true si le package peut couvrir `amount` € (toujours vrai pour un carnet utilisable). */
export function canCover(p: MemberPackage, amount: number, now: Date = new Date()): boolean {
  if (!isUsable(p, now)) return false;
  return p.kind === 'ENTRIES' ? true : Number(p.amountRemaining) >= amount;
}

/** Message d'aide quand aucun bouton de solde prépayé n'est proposé (null = ne rien afficher). */
export function prepaidHint(hasPlayer: boolean, usableCount: number, remainingCents: number): string | null {
  if (remainingCents <= 0) return null;   // rien à encaisser
  if (usableCount > 0) return null;        // des boutons solde sont déjà affichés
  return hasPlayer
    ? 'Aucun solde prépayé actif pour ce joueur — vendez-lui une offre depuis la Caisse.'
    : 'Associez un joueur pour régler avec un carnet ou un porte-monnaie.';
}

/**
 * Choisit le 1ᵉʳ solde utilisable d'un joueur capable de couvrir `amountCents`.
 * `kind` filtre éventuellement (ENTRIES / WALLET). null si aucun ne convient.
 */
export function pickPackageFor(
  packages: MemberPackage[],
  amountCents: number,
  kind?: 'ENTRIES' | 'WALLET',
  now: Date = new Date(),
): MemberPackage | null {
  const amount = amountCents / 100;
  for (const p of packages) {
    if (kind && p.kind !== kind) continue;
    if (canCover(p, amount, now)) return p;
  }
  return null;
}

/** Indexe les soldes actifs (avec userId) par joueur, ordre conservé. */
export function indexPackagesByUser(rows: ActiveMemberPackage[]): Record<string, ActiveMemberPackage[]> {
  const map: Record<string, ActiveMemberPackage[]> = {};
  for (const p of rows) (map[p.userId] ??= []).push(p);
  return map;
}

/** Solde restant projeté après un paiement de `amountEuros` € (jamais négatif). */
export function remainingAfterLabel(p: MemberPackage, amountEuros: number): string {
  if (p.kind === 'ENTRIES') {
    // ENTRIES : toujours 1 entrée consommée — amountEuros ignoré
    const n = Math.max(0, (p.creditsRemaining ?? 0) - 1);
    return `il restera ${n} entrée${n > 1 ? 's' : ''}`;
  }
  const left = Math.max(0, Number(p.amountRemaining ?? 0) - amountEuros);
  return `il restera ${left.toFixed(2).replace('.', ',')} €`;
}

/** Résumé d'un paiement par solde (moyen + restant) — pour la confirmation. */
export function paidWithLabel(p: MemberPackage, amountEuros: number): string {
  if (p.kind === 'ENTRIES') {
    // ENTRIES : toujours 1 entrée consommée — amountEuros ignoré
    const n = Math.max(0, (p.creditsRemaining ?? 0) - 1);
    return `Payé avec votre carnet · ${n} entrée${n > 1 ? 's' : ''} restante${n > 1 ? 's' : ''}`;
  }
  const left = Math.max(0, Number(p.amountRemaining ?? 0) - amountEuros);
  return `Payé avec votre porte-monnaie · solde restant ${left.toFixed(2).replace('.', ',')} €`;
}
