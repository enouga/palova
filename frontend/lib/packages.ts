import type { MemberPackage } from '@/lib/api';

/** Libellé court d'un solde : « Carnet — 7 entrées » / « Porte-monnaie — 53,50 € ». */
export function packageLabel(p: MemberPackage): string {
  if (p.kind === 'ENTRIES') {
    const n = p.creditsRemaining ?? 0;
    return `Carnet — ${n} entrée${n > 1 ? 's' : ''}`;
  }
  return `Porte-monnaie — ${Number(p.amountRemaining ?? 0).toFixed(2).replace('.', ',')} €`;
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
