import { packageLabel, isUsable, canCover, prepaidHint, pickPackageFor, indexPackagesByUser, remainingAfterLabel, paidWithLabel } from '@/lib/packages';
import type { MemberPackage, ActiveMemberPackage } from '@/lib/api';

const entries = (remaining: number, expiresAt: string | null = null): MemberPackage => ({
  id: 'p1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: remaining,
  amountTotal: null, amountRemaining: null, purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt, template: { name: '10 entrées' },
});

const wallet = (remaining: string): MemberPackage => ({
  id: 'p2', kind: 'WALLET', creditsTotal: null, creditsRemaining: null,
  amountTotal: '200.00', amountRemaining: remaining, purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt: null, template: { name: 'Avoir 200 €' },
});

describe('packageLabel', () => {
  it('libelle un carnet avec ses entrées restantes', () => {
    expect(packageLabel(entries(7))).toBe('Carnet — 7 entrées');
    expect(packageLabel(entries(1))).toBe('Carnet — 1 entrée');
  });
  it('libelle un porte-monnaie avec son solde €', () => {
    expect(packageLabel(wallet('53.50'))).toBe('Porte-monnaie — 53,50 €');
  });
});

describe('isUsable', () => {
  const now = new Date('2026-06-10T12:00:00Z');
  it('carnet avec crédit non expiré → utilisable', () => {
    expect(isUsable(entries(1), now)).toBe(true);
  });
  it('carnet épuisé ou expiré → non utilisable', () => {
    expect(isUsable(entries(0), now)).toBe(false);
    expect(isUsable(entries(5, '2026-06-09T00:00:00Z'), now)).toBe(false);
  });
  it('porte-monnaie à 0 → non utilisable', () => {
    expect(isUsable(wallet('0.00'), now)).toBe(false);
  });
});

describe('canCover', () => {
  const now = new Date('2026-06-10T12:00:00Z');
  it('un carnet utilisable couvre toujours (1 entrée = 1 résa)', () => {
    expect(canCover(entries(1), 999, now)).toBe(true);
  });
  it('un porte-monnaie couvre si son solde >= montant', () => {
    expect(canCover(wallet('25.00'), 25, now)).toBe(true);
    expect(canCover(wallet('24.99'), 25, now)).toBe(false);
  });
});

describe('prepaidHint', () => {
  it('rien à encaisser (reste dû ≤ 0) → null', () => {
    expect(prepaidHint(true, 0, 0)).toBeNull();
    expect(prepaidHint(false, 0, -100)).toBeNull();
  });

  it('au moins un solde utilisable → null (les boutons sont affichés)', () => {
    expect(prepaidHint(true, 1, 5200)).toBeNull();
    expect(prepaidHint(false, 2, 5200)).toBeNull();
  });

  it('joueur rattaché mais aucun solde utilisable → invite à vendre une offre', () => {
    expect(prepaidHint(true, 0, 5200)).toBe(
      'Aucun solde prépayé actif pour ce joueur — vendez-lui une offre depuis la Caisse.',
    );
  });

  it('aucun joueur rattaché → invite à associer un joueur', () => {
    expect(prepaidHint(false, 0, 5200)).toBe(
      'Associez un joueur pour régler avec un carnet ou un porte-monnaie.',
    );
  });
});

// --- pickPackageFor / indexPackagesByUser ---

const mkWallet = (over: Partial<MemberPackage> = {}): MemberPackage => ({
  id: 'pk-w', kind: 'WALLET', creditsTotal: null, creditsRemaining: null,
  amountTotal: '130.00', amountRemaining: '130.00', purchasedAt: '', expiresAt: null,
  template: { name: 'Porte-monnaie' }, ...over,
} as MemberPackage);
const mkCarnet = (over: Partial<MemberPackage> = {}): MemberPackage => ({
  id: 'pk-c', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 5,
  amountTotal: null, amountRemaining: null, purchasedAt: '', expiresAt: null,
  template: { name: 'Carnet' }, ...over,
} as MemberPackage);

describe('pickPackageFor', () => {
  it('porte-monnaie choisi s\'il couvre le montant', () => {
    expect(pickPackageFor([mkWallet()], 1300)?.id).toBe('pk-w');
  });
  it('porte-monnaie écarté si le solde ne couvre pas', () => {
    expect(pickPackageFor([mkWallet({ amountRemaining: '5.00' })], 1300)).toBeNull();
  });
  it('carnet toujours choisi tant qu\'il a une entrée', () => {
    expect(pickPackageFor([mkCarnet()], 999999)?.id).toBe('pk-c');
  });
  it('filtre par kind', () => {
    expect(pickPackageFor([mkCarnet(), mkWallet()], 1300, 'WALLET')?.id).toBe('pk-w');
  });
  it('liste vide → null', () => {
    expect(pickPackageFor([], 1300)).toBeNull();
  });
  it('ignore un solde expiré', () => {
    expect(pickPackageFor([mkWallet({ expiresAt: '2000-01-01T00:00:00.000Z' })], 1300)).toBeNull();
  });
});

describe('remainingAfterLabel', () => {
  it('carnet : -1 entrée (pluriel/singulier, jamais négatif)', () => {
    expect(remainingAfterLabel(entries(7), 25)).toBe('il restera 6 entrées');
    expect(remainingAfterLabel(entries(2), 25)).toBe('il restera 1 entrée');
    expect(remainingAfterLabel(entries(1), 25)).toBe('il restera 0 entrée');
  });
  it('porte-monnaie : -montant €', () => {
    expect(remainingAfterLabel(wallet('53.50'), 25)).toBe('il restera 28,50 €');
    expect(remainingAfterLabel(wallet('25.00'), 25)).toBe('il restera 0,00 €');
  });
});

describe('paidWithLabel', () => {
  it('carnet : moyen + entrées restantes', () => {
    expect(paidWithLabel(entries(7), 25)).toBe('Payé avec votre carnet · 6 entrées restantes');
    expect(paidWithLabel(entries(2), 25)).toBe('Payé avec votre carnet · 1 entrée restante');
  });
  it('porte-monnaie : moyen + solde restant', () => {
    expect(paidWithLabel(wallet('53.50'), 25)).toBe('Payé avec votre porte-monnaie · solde restant 28,50 €');
  });
});

describe('indexPackagesByUser', () => {
  it('groupe les soldes actifs par userId', () => {
    const rows = [
      { ...mkWallet(), id: 'a', userId: 'u1' },
      { ...mkCarnet(), id: 'b', userId: 'u1' },
      { ...mkWallet(), id: 'c', userId: 'u2' },
    ] as ActiveMemberPackage[];
    const map = indexPackagesByUser(rows);
    expect(map['u1'].map((p) => p.id)).toEqual(['a', 'b']);
    expect(map['u2'].map((p) => p.id)).toEqual(['c']);
  });
});
