# Offres : tri par sport + couleurs sport/type distinctes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur un club multi-sport, regrouper les offres (abonnements/carnets/porte-monnaie) par sport sur le Club-house et sur `/admin/packages`, avec une couleur dédiée par sport (bandeau de carte) qui reste distincte de la couleur de type déjà en place (badge).

**Architecture:** Nouveaux helpers purs dans `frontend/lib/adminOffers.ts` (dictionnaire de couleurs par sport + fonction de regroupement stable), consommés par les deux surfaces existantes (`OffersShowcase.tsx` côté joueur, `app/admin/packages/page.tsx` + ses sous-composants côté admin). Le composant de carte de chaque surface reçoit désormais deux teintes (`sportTint` pour le bandeau, `typeTint` pour le badge) au lieu d'une seule. Tout est gaté sur `clubIsMultiSport(club)` (déjà existant dans `lib/sportBadge.ts`) : un club mono-sport garde un rendu strictement identique à aujourd'hui.

**Tech Stack:** Next.js 16 / React / TypeScript, Jest + Testing Library (frontend uniquement, aucun changement backend).

---

## Contexte pour l'exécutant

Spec validée : `docs/superpowers/specs/2026-07-17-offres-tri-couleur-sport-design.md` — la lire avant de commencer si le contexte ci-dessous ne suffit pas.

Deux fichiers de carte existent aujourd'hui et couplent une SEULE couleur (`tint`) à la fois pour le bandeau du haut de carte ET le badge de type — c'est ce couplage qu'on casse :
- `frontend/components/clubhouse/OffersShowcase.tsx` (composant `OfferCard` local, non exporté)
- `frontend/components/admin/offers/OfferCard.tsx` (composant exporté, utilisé par `app/admin/packages/page.tsx`)
- `frontend/components/admin/offers/OfferPreviewCard.tsx` (aperçu en direct dans le studio de création, même couplage)

La couleur de TYPE existe déjà : `offerTint(kind)` dans `frontend/lib/adminOffers.ts` (bleu=Abonnement, abricot=Carnet, émeraude=Porte-monnaie). On y ajoute une couleur de SPORT, indépendante.

Le gate `clubIsMultiSport(club)` existe déjà dans `frontend/lib/sportBadge.ts` : `(club?.clubSports?.length ?? 0) > 1`.

---

## Task 1: Helpers purs de couleur/regroupement par sport

**Files:**
- Modify: `frontend/lib/adminOffers.ts`
- Test: `frontend/__tests__/adminOffers.test.ts`

- [ ] **Step 1: Écrire les tests (échouent — les fonctions n'existent pas encore)**

Dans `frontend/__tests__/adminOffers.test.ts`, remplacer la ligne d'import en tête de fichier :

```ts
import {
  offerTint, planPulse, packagePulse, planRevenueCents, splitByActive,
} from '../lib/adminOffers';
```

par :

```ts
import {
  offerTint, planPulse, packagePulse, planRevenueCents, splitByActive,
  sportOfferTint, sportKeyColor, sportGroupLabel, groupOffersBySport,
} from '../lib/adminOffers';
```

Puis ajouter, à la fin du fichier (après le bloc `describe('splitByActive', ...)`) :

```ts
describe('sportOfferTint', () => {
  it('une offre à un seul sport prend la couleur dédiée de ce sport', () => {
    expect(sportOfferTint(['padel'])).toBe('#7FAE86');
    expect(sportOfferTint(['tennis'])).toBe('#6F9FC4');
  });
  it('une offre sans sport (« Tous sports ») prend la couleur neutre', () => {
    expect(sportOfferTint([])).toBe('#B9B3A8');
  });
  it('une offre à plusieurs sports prend la couleur neutre', () => {
    expect(sportOfferTint(['padel', 'tennis'])).toBe('#B9B3A8');
  });
  it('une clé de sport hors catalogue retombe sur la couleur neutre', () => {
    expect(sportOfferTint(['futsal'])).toBe('#B9B3A8');
  });
});

describe('sportKeyColor', () => {
  it('couleur dédiée pour une clé connue', () => {
    expect(sportKeyColor('squash')).toBe('#D69574');
  });
  it('couleur neutre pour la clé null ("Tous sports")', () => {
    expect(sportKeyColor(null)).toBe('#B9B3A8');
  });
});

describe('sportGroupLabel', () => {
  const club = { clubSports: [{ sport: { key: 'padel', name: 'Padel' } }, { sport: { key: 'tennis', name: 'Tennis' } }] };
  it('résout le nom du sport via le club', () => {
    expect(sportGroupLabel('padel', club)).toBe('Padel');
  });
  it('« Tous sports » pour la clé null', () => {
    expect(sportGroupLabel(null, club)).toBe('Tous sports');
  });
  it('retombe sur la clé brute si le sport est introuvable côté club', () => {
    expect(sportGroupLabel('squash', club)).toBe('squash');
  });
});

describe('groupOffersBySport', () => {
  const clubSports = [{ sport: { key: 'padel' } }, { sport: { key: 'tennis' } }];
  const item = (id: string, sportKeys: string[]) => ({ id, sportKeys });

  it('regroupe par sport dans l’ordre du club, « Tous sports » en dernier', () => {
    const items = [
      item('tennis-1', ['tennis']),
      item('padel-1', ['padel']),
      item('all-1', []),
      item('padel-2', ['padel']),
    ];
    const groups = groupOffersBySport(items, clubSports);
    expect(groups.map((g) => g.key)).toEqual(['padel', 'tennis', null]);
    expect(groups[0].items.map((i) => i.id)).toEqual(['padel-1', 'padel-2']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['tennis-1']);
    expect(groups[2].items.map((i) => i.id)).toEqual(['all-1']);
  });

  it('une offre à plusieurs sports rejoint « Tous sports »', () => {
    const groups = groupOffersBySport([item('multi', ['padel', 'tennis'])], clubSports);
    expect(groups).toEqual([{ key: null, items: [item('multi', ['padel', 'tennis'])] }]);
  });

  it('une clé hors catalogue du club est ajoutée après les sports du club', () => {
    const items = [item('padel-1', ['padel']), item('squash-1', ['squash'])];
    const groups = groupOffersBySport(items, clubSports);
    expect(groups.map((g) => g.key)).toEqual(['padel', 'squash']);
  });

  it('groupes vides omis', () => {
    const groups = groupOffersBySport([item('padel-1', ['padel'])], clubSports);
    expect(groups.map((g) => g.key)).toEqual(['padel']);
  });
});
```

- [ ] **Step 2: Vérifier que les nouveaux tests échouent**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/adminOffers.test.ts`
Expected: FAIL — `sportOfferTint is not a function` (ou erreur d'import équivalente).

*(Note environnement Windows : si `npx jest`/`npx tsc` échouent avec « n'est pas reconnu », utiliser `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc` directement — shims cassés connus sur ce poste.)*

- [ ] **Step 3: Implémenter les helpers**

Dans `frontend/lib/adminOffers.ts`, insérer le bloc suivant juste après la définition de `offerTint` (donc avant la constante `const NO_SALE = ...`) :

```ts
/** Couleur dédiée à chaque sport — indépendante de offerTint, qui code le TYPE d'offre. */
export const SPORT_COLORS: Record<string, string> = {
  padel: '#7FAE86',
  tennis: '#6F9FC4',
  squash: '#D69574',
  badminton: '#A78FC4',
  pickleball: '#CDA553',
  pingpong: '#C98FA0',
};

/** Couleur neutre du compartiment « Tous sports » (offre à 0 ou plusieurs sports, ou sport hors catalogue). */
export const SPORT_COLOR_OTHER = '#B9B3A8';

/** Clé de regroupement d'une offre : son sport si elle en cible exactement un, sinon `null` ("Tous sports"). */
function sportGroupKey(sportKeys: string[]): string | null {
  return sportKeys.length === 1 ? sportKeys[0] : null;
}

/** Couleur d'une clé de regroupement (sport précis, ou `null` pour "Tous sports"). */
export function sportKeyColor(key: string | null): string {
  return key !== null ? (SPORT_COLORS[key] ?? SPORT_COLOR_OTHER) : SPORT_COLOR_OTHER;
}

/** Couleur de sport d'une offre : sa couleur dédiée si elle ne cible qu'un seul sport, neutre sinon. */
export function sportOfferTint(sportKeys: string[]): string {
  return sportKeyColor(sportGroupKey(sportKeys));
}

/** Libellé de section : nom du sport résolu via le club, "Tous sports" pour le compartiment `null`. */
export function sportGroupLabel(
  key: string | null,
  club: { clubSports?: { sport: { key: string; name: string } }[] } | null | undefined,
): string {
  if (key === null) return 'Tous sports';
  return club?.clubSports?.find((cs) => cs.sport.key === key)?.sport.name ?? key;
}

/**
 * Regroupe des offres par sport : une offre à un seul sport rejoint le groupe de ce sport, une
 * offre à 0 ou plusieurs sports rejoint le compartiment "Tous sports" (clé `null`). Ordre des
 * groupes = celui de `clubSports` (sports du club) ; une clé présente dans les offres mais hors
 * de `clubSports` est ajoutée ensuite, dans l'ordre de première apparition ; le compartiment
 * "Tous sports" est toujours en dernier. Regroupement stable : l'ordre relatif des offres à
 * l'intérieur de chaque groupe est celui du tableau reçu. Groupes vides omis.
 */
export function groupOffersBySport<T extends { sportKeys: string[] }>(
  items: T[],
  clubSports: { sport: { key: string } }[],
): { key: string | null; items: T[] }[] {
  const buckets = new Map<string | null, T[]>();
  for (const item of items) {
    const key = sportGroupKey(item.sportKeys);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const order: (string | null)[] = [];
  for (const cs of clubSports) {
    if (buckets.has(cs.sport.key) && !order.includes(cs.sport.key)) order.push(cs.sport.key);
  }
  for (const key of buckets.keys()) {
    if (key !== null && !order.includes(key)) order.push(key);
  }
  if (buckets.has(null)) order.push(null);
  return order.map((key) => ({ key, items: buckets.get(key)! }));
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/adminOffers.test.ts`
Expected: PASS — tous les tests verts (anciens + nouveaux).

- [ ] **Step 5: Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune nouvelle erreur (le fichier est purement additif, ne devrait rien casser).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/adminOffers.ts frontend/__tests__/adminOffers.test.ts
git commit -m "feat(offers): helpers de couleur et regroupement par sport"
```

---

## Task 2: Club-house — `OffersShowcase.tsx` groupé par sport

**Files:**
- Modify: `frontend/components/clubhouse/OffersShowcase.tsx`
- Test: `frontend/__tests__/OffersShowcase.test.tsx`

Dépend de la Task 1 (importe `sportOfferTint`, `sportKeyColor`, `sportGroupLabel`, `groupOffersBySport`).

- [ ] **Step 1: Ajouter les nouveaux tests (échouent — le composant ne groupe pas encore)**

Dans `frontend/__tests__/OffersShowcase.test.tsx`, ajouter l'import de `ACCENTS` en tête de fichier (après l'import de `PublicOffers`) :

```ts
import { ACCENTS } from '@/lib/theme';
```

Puis ajouter, à la fin du `describe('OffersShowcase', ...)` (après le test `'club multi-sport : le sport apparaît sur la carte et dans la modale'`, avant la fermeture du `describe`) :

```tsx
  it('club mono-sport (ou non chargé) : bandeau de couleur de type, aucune section de sport', () => {
    wrap({});
    expect(screen.queryByTestId('offer-sport-kicker')).toBeNull();
    const stripe = screen.getByText('Abo Or').closest('.of-card')!.querySelector('[data-testid="offer-stripe"]')!;
    expect(stripe).toHaveStyle({ background: ACCENTS.blue });
  });

  it('club multi-sport : sections par sport dans l’ordre du club, « Tous sports » en dernier, bandeau ≠ badge', () => {
    clubCtx = {
      slug: 'padel-arena',
      club: { clubSports: [{ sport: { key: 'padel', name: 'Padel' } }, { sport: { key: 'tennis', name: 'Tennis' } }] },
    };
    wrap({
      offers: {
        ...offers,
        plans: [{ ...offers.plans[0], sportKeys: ['padel'] }],
        packages: [
          { ...offers.packages[0], id: 'tp-tennis', name: 'Carnet Tennis', sportKeys: ['tennis'] },
          { ...offers.packages[0], id: 'tp-multi', name: 'Carnet Multi', sportKeys: [] },
        ],
      },
    });
    const kickers = screen.getAllByTestId('offer-sport-kicker');
    expect(kickers.map((k) => k.textContent)).toEqual(['Padel', 'Tennis', 'Tous sports']);

    const padelStripe = screen.getByText('Abo Or').closest('.of-card')!.querySelector('[data-testid="offer-stripe"]')!;
    expect(padelStripe).toHaveStyle({ background: '#7FAE86' });
    expect(padelStripe).not.toHaveStyle({ background: ACCENTS.blue });

    const multiStripe = screen.getByText('Carnet Multi').closest('.of-card')!.querySelector('[data-testid="offer-stripe"]')!;
    expect(multiStripe).toHaveStyle({ background: '#B9B3A8' });
  });
```

- [ ] **Step 2: Vérifier que les nouveaux tests échouent**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OffersShowcase.test.tsx`
Expected: FAIL — `offer-sport-kicker`/`offer-stripe` introuvables (les `data-testid` n'existent pas encore).

- [ ] **Step 3: Réécrire le composant**

Remplacer intégralement le contenu de `frontend/components/clubhouse/OffersShowcase.tsx` par :

```tsx
'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { api, assetUrl, ClubDetail, PublicOffers, PublicPlan, PublicPackageTemplate } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { sportTag, clubIsMultiSport } from '@/lib/sportBadge';
import { offerTint, sportOfferTint, sportKeyColor, sportGroupLabel, groupOffersBySport } from '@/lib/adminOffers';
import { Btn } from '@/components/ui/atoms';
import { SectionHeader, cardStyle } from '@/components/clubhouse/SectionHeader';

const StripePaymentStep = dynamic(() => import('@/components/StripePaymentStep'), { ssr: false });

const euros = (v: string) => `${Number(v).toFixed(2).replace('.', ',')} €`;

type Target = { kind: 'plan'; plan: PublicPlan } | { kind: 'package'; tpl: PublicPackageTemplate };
type Stage = 'details' | 'payment' | 'done';

const planBenefits = (p: PublicPlan, club: ClubDetail | null): string[] => {
  const tag = sportTag(club, p.sportKeys);
  return [
    ...(tag ? [tag] : []),
    p.offPeakOnly ? 'Heures creuses' : 'Toutes heures',
    p.benefit === 'INCLUDED' ? 'Réservations incluses' : `−${p.discountPercent ?? 0} % sur les réservations`,
    ...(p.dailyCap ? [`${p.dailyCap} résa/jour max`] : []),
    ...(p.weeklyCap ? [`${p.weeklyCap} résa/sem. max`] : []),
    `Engagement ${p.commitmentMonths} mois`,
  ];
};

const packageBenefits = (t: PublicPackageTemplate, club: ClubDetail | null): string[] => {
  const tag = sportTag(club, t.sportKeys);
  return [
    ...(tag ? [tag] : []),
    t.kind === 'ENTRIES' ? `${t.entriesCount} entrées` : `${euros(t.walletAmount ?? '0')} crédités`,
    t.validityDays ? `Valable ${t.validityDays} jours` : 'Sans expiration',
  ];
};

type CardEntry = {
  id: string;
  name: string;
  price: string;
  suffix: string | null;
  lines: string[];
  kindLabel: string;
  typeTint: string;
  sportKeys: string[];
  onOpen: () => void;
};

// Vitrine des formules : cartes abonnements + carnets, groupées par sport sur un club multi-sport
// (sections avec kicker coloré, ordre des sports du club). Le bouton « Souscrire » ouvre une
// modale de détail (description complète + caractéristiques) ; le paiement en ligne n'y est
// proposé que si le club l'a activé, sinon la modale invite à régler à l'accueil.
export function OffersShowcase({ offers, token, hasActiveSubscription, onAuthPrompt, onPurchased }: {
  offers: PublicOffers;
  token: string | null;
  hasActiveSubscription: boolean;
  onAuthPrompt: () => void;
  onPurchased: () => void;
}) {
  const { th } = useTheme();
  const { slug, club } = useClub();
  const [target, setTarget] = useState<Target | null>(null);
  const [stage, setStage] = useState<Stage>('details');

  const plans = hasActiveSubscription ? [] : offers.plans;
  if (plans.length === 0 && offers.packages.length === 0) return null;

  const openDetails = (t: Target) => { setStage('details'); setTarget(t); };
  const close = () => setTarget(null);

  const multiSport = clubIsMultiSport(club);

  const cardEntries: CardEntry[] = [
    ...plans.map((p): CardEntry => ({
      id: `plan-${p.id}`, name: p.name, price: euros(p.monthlyPrice), suffix: '/ mois',
      lines: planBenefits(p, club), kindLabel: 'Abonnement', typeTint: offerTint('SUBSCRIPTION'),
      sportKeys: p.sportKeys, onOpen: () => openDetails({ kind: 'plan', plan: p }),
    })),
    ...offers.packages.map((t): CardEntry => ({
      id: `tpl-${t.id}`, name: t.name, price: euros(t.price), suffix: null,
      lines: packageBenefits(t, club), kindLabel: t.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie',
      typeTint: offerTint(t.kind), sportKeys: t.sportKeys, onOpen: () => openDetails({ kind: 'package', tpl: t }),
    })),
  ];

  const groups = multiSport
    ? groupOffersBySport(cardEntries, club?.clubSports ?? [])
    : [{ key: null as string | null, items: cardEntries }];

  // Carte compacte du rail : prix en chiffre vedette, bénéfices en 2 lignes, CTA fin.
  // sportTint colore le bandeau du haut (couleur de sport ; couleur de type si le club n'a qu'un
  // sport) ; typeTint colore le badge et le bouton (abonnement/carnet/porte-monnaie), inchangé.
  const OfferCard = ({ name, price, suffix, lines, kindLabel, sportTint, typeTint, onOpen }: {
    name: string; price: string; suffix: string | null; lines: string[]; kindLabel: string;
    sportTint: string; typeTint: string; onOpen: () => void;
  }) => (
    <div className="of-card" style={{ ...cardStyle(th), flex: '0 0 236px', scrollSnapAlign: 'start', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', overflow: 'hidden' }}>
      <span aria-hidden="true" data-testid="offer-stripe" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: sportTint }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: 999, padding: '3px 8px', background: th.mode === 'floodlit' ? `${typeTint}26` : `${typeTint}40`, color: th.mode === 'floodlit' ? typeTint : th.ink }}>
          {kindLabel}
        </span>
      </div>
      <div style={{ position: 'relative', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, marginTop: 6 }}>{name}</div>
      <div style={{ position: 'relative', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 27, letterSpacing: -0.5, color: th.text }}>
        <span>{price}</span>{suffix && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, letterSpacing: 0 }}> {suffix}</span>}
      </div>
      <div style={{ position: 'relative', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.55, flex: 1 }}>
        {lines.join(' · ')}
      </div>
      <button onClick={onOpen} style={{
        marginTop: 10, border: `1.5px solid ${typeTint}`, background: 'transparent', color: th.mode === 'floodlit' ? typeTint : th.ink,
        borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer',
      }}>
        Souscrire
      </button>
    </div>
  );

  const targetName = target?.kind === 'plan' ? target.plan.name : target?.tpl.name ?? '';
  const targetKindLabel = target?.kind === 'plan' ? 'Abonnement' : target?.kind === 'package' ? (target.tpl.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie') : '';
  const targetDescription = target?.kind === 'plan' ? target.plan.description : target?.kind === 'package' ? target.tpl.description : null;
  const targetImageUrl = target?.kind === 'plan' ? target.plan.imageUrl : target?.kind === 'package' ? target.tpl.imageUrl : null;
  const targetLines = target?.kind === 'plan' ? planBenefits(target.plan, club) : target?.kind === 'package' ? packageBenefits(target.tpl, club) : [];
  const targetPrice = target?.kind === 'plan' ? `${euros(target.plan.monthlyPrice)} / mois` : target ? euros(target.tpl.price) : '';
  const amountLabel = target?.kind === 'plan'
    ? `1re mensualité · ${euros(target.plan.monthlyPrice)}`
    : target ? euros(target.tpl.price) : '';

  const souscrire = () => {
    if (!token) { onAuthPrompt(); return; }
    setStage('payment');
  };

  return (
    <section>
      <SectionHeader title="Abonnements & offres" />
      <style>{`.of-card{transition:transform .18s ease}.of-card:hover{transform:translateY(-3px)}`}</style>
      {groups.map((g) => (
        <div key={g.key ?? '_other'}>
          {multiSport && (
            <div data-testid="offer-sport-kicker" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 20px 6px', fontFamily: th.fontUI, fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: sportKeyColor(g.key) }} />
              {sportGroupLabel(g.key, club)}
            </div>
          )}
          {/* scrollPaddingLeft = padding-left : sans lui le snap `mandatory` mange le padding au montage. */}
          <div className="sp-scroll-x" style={{ display: 'flex', gap: 12, margin: '0 -20px', padding: '4px 20px 14px', scrollSnapType: 'x mandatory', scrollPaddingLeft: 20 }}>
            {g.items.map((entry) => (
              <OfferCard key={entry.id} name={entry.name} price={entry.price} suffix={entry.suffix}
                kindLabel={entry.kindLabel} typeTint={entry.typeTint}
                sportTint={multiSport ? sportOfferTint(entry.sportKeys) : entry.typeTint}
                lines={entry.lines} onOpen={entry.onOpen} />
            ))}
          </div>
        </div>
      ))}

      {target && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
          <div role="dialog" aria-modal="true" style={{ position: 'relative', width: '100%', maxWidth: 520, margin: '0 auto', background: th.bgElev, borderRadius: '0 0 28px 28px', padding: '20px 20px 30px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)', maxHeight: '86vh', overflowY: 'auto' }}>
            {stage === 'done' ? (
              <div style={{ textAlign: 'center', fontFamily: th.fontUI }}>
                <div style={{ fontSize: 30 }}>✓</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: th.text, marginTop: 6 }}>C&rsquo;est fait !</div>
                <p style={{ fontSize: 13.5, color: th.textMute }}>Votre {target.kind === 'plan' ? 'abonnement est actif' : 'solde est disponible'} — retrouvez-le dans votre profil.</p>
                <Btn onClick={() => { close(); onPurchased(); }}>Fermer</Btn>
              </div>
            ) : stage === 'payment' ? (
              <StripePaymentStep
                type="payment"
                amountLabel={amountLabel}
                createIntent={async () => {
                  const r = target.kind === 'plan'
                    ? await api.createOfferPlanIntent(slug ?? '', target.plan.id, token!)
                    : await api.createOfferPackageIntent(slug ?? '', target.tpl.id, token!);
                  return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId ?? null, customerSessionClientSecret: r.customerSessionClientSecret ?? null };
                }}
                confirm={async (ids) => {
                  if (ids.stripePaymentIntentId) await api.confirmOfferPayment(slug ?? '', ids.stripePaymentIntentId, token!);
                }}
                onSuccess={() => setStage('done')}
                onCancel={close}
              />
            ) : (
              <div>
                {targetImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(targetImageUrl) ?? ''} alt={targetName} style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 12, marginBottom: 14 }} />
                )}
                <div style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: th.accent, marginBottom: 4 }}>
                  {targetKindLabel}
                </div>
                <h3 style={{ margin: 0, fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 21, color: th.text }}>{targetName}</h3>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, letterSpacing: -0.3, color: th.text, marginTop: 6 }}>{targetPrice}</div>

                {targetDescription && (
                  <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.text, lineHeight: 1.6, marginTop: 14, whiteSpace: 'pre-wrap' }}>
                    {targetDescription}
                  </p>
                )}

                <ul style={{ margin: '14px 0 0', padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {targetLines.map((l, i) => (
                    <li key={i} style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{l}</li>
                  ))}
                </ul>

                <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Btn variant="ghost" onClick={close}>Fermer</Btn>
                  {offers.onlinePurchase ? (
                    <Btn onClick={souscrire}>Souscrire · {targetPrice}</Btn>
                  ) : (
                    <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
                      Cette offre se règle directement à l&rsquo;accueil du club.
                    </span>
                  )}
                </div>
              </div>
            )}
            <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '18px auto 0' }} />
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Vérifier que tous les tests du fichier passent**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OffersShowcase.test.tsx`
Expected: PASS — les 12 tests (10 existants + 2 nouveaux) verts. Le test existant `'club multi-sport : le sport apparaît sur la carte et dans la modale'` doit rester vert sans modification.

- [ ] **Step 5: Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune nouvelle erreur.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/clubhouse/OffersShowcase.tsx frontend/__tests__/OffersShowcase.test.tsx
git commit -m "feat(clubhouse): offres groupées et colorées par sport"
```

---

## Task 3: Admin — cartes, studio et page `/admin/packages`

**Files:**
- Modify: `frontend/components/admin/offers/OfferCard.tsx`
- Modify: `frontend/components/admin/offers/OfferPreviewCard.tsx`
- Modify: `frontend/components/admin/offers/OfferStudio.tsx`
- Modify: `frontend/app/admin/packages/page.tsx`
- Test: `frontend/__tests__/AdminPackages.test.tsx`

Dépend de la Task 1. Ces 4 fichiers changent ensemble (rupture de l'API de `OfferCard`/`OfferStudio`, seul `page.tsx` les consomme) — un seul commit à la fin.

⚠️ Le club mocké dans `AdminPackages.test.tsx` a **2 sports** (`clubSports: [padel, tennis]`) — c'est donc un club **multi-sport** dans TOUS les tests existants de ce fichier. Après cette tâche, les kickers de section basculent de « Abonnements »/« Carnets & Porte-monnaie » (type) à des kickers par sport — 3 tests existants doivent être réécrits en conséquence (Step 1 ci-dessous).

- [ ] **Step 1: Réécrire les tests concernés (échoueront tant que le composant n'est pas modifié)**

Dans `frontend/__tests__/AdminPackages.test.tsx`, remplacer le test `'affiche le titre « Offres » et les deux sections'` par :

```tsx
it('affiche le titre « Offres » et une section par sport', async () => {
  (api.adminGetPackageTemplates as jest.Mock).mockResolvedValue([tpl, { ...tpl, id: 'tpl-2', name: 'Carte Tennis', sportKeys: ['tennis'] }]);
  mount();
  expect(await screen.findByRole('heading', { name: 'Offres' })).toBeInTheDocument();
  const kickers = await screen.findAllByTestId('offer-sport-kicker');
  expect(kickers.map((k) => k.textContent)).toEqual(['Padel', 'Tennis']);
});
```

Remplacer le test `'une section vide ne rend pas son intitulé'` par :

```tsx
it('un sport sans offre ne rend pas son intitulé', async () => {
  (api.adminGetSubscriptionPlans as jest.Mock).mockResolvedValue([]);
  (api.adminGetSubscriptionOverview as jest.Mock).mockResolvedValue({ kpis: { activeCount: 0, monthlyRevenueCents: 0, expiringSoonCount: 0 }, plans: [], subscribers: [] });
  mount();
  await screen.findByText('Carte 10 parties');
  const kickers = screen.getAllByTestId('offer-sport-kicker');
  expect(kickers.map((k) => k.textContent)).toEqual(['Padel']);
});
```

Remplacer le test `'aucune offre → carte d’état vide seule, pas d’intitulés de section'` par :

```tsx
it('aucune offre → carte d’état vide seule, pas d’intitulés de section', async () => {
  (api.adminGetPackageTemplates as jest.Mock).mockResolvedValue([]);
  (api.adminGetSubscriptionPlans as jest.Mock).mockResolvedValue([]);
  (api.adminGetSubscriptionOverview as jest.Mock).mockResolvedValue({ kpis: { activeCount: 0, monthlyRevenueCents: 0, expiringSoonCount: 0 }, plans: [], subscribers: [] });
  mount();
  expect(await screen.findByText('Créez votre première offre')).toBeInTheDocument();
  expect(screen.queryByTestId('offer-sport-kicker')).toBeNull();
});
```

Puis ajouter, à la toute fin du fichier, un test couvrant le bandeau/badge distincts :

```tsx
it('club multi-sport : bandeau de couleur de sport, badge de couleur de type, distincts', async () => {
  mount();
  await screen.findByText('Padel illimité');
  const planCard = screen.getByText('Padel illimité').closest('div')!.parentElement!.parentElement!;
  const stripe = within(planCard).getByTestId('offer-card-stripe');
  expect(stripe).toHaveStyle({ background: '#7FAE86' }); // couleur padel
  expect(within(planCard).getByText('Abonnement')).toBeInTheDocument(); // badge de type toujours présent
});
```

Ce fichier mocke `useClub` une seule fois en tête de fichier avec un club à **2 sports** (multi-sport) — pour couvrir le cas mono-sport (comportement inchangé), créer un **second fichier de test dédié** :

`frontend/__tests__/AdminPackages.monosport.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import AdminPackagesPage from '../app/admin/packages/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { AdminRoleContext } from '../lib/adminRole';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', clubSports: [{ sport: { key: 'padel', name: 'Padel' } }] } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetPackageTemplates: jest.fn(),
    adminGetSubscriptionPlans: jest.fn(),
    adminGetSubscriptionOverview: jest.fn(),
    adminCreatePackageTemplate: jest.fn(),
    adminUpdatePackageTemplate: jest.fn(),
    adminUploadPackageTemplateImage: jest.fn(),
    adminCreateSubscriptionPlan: jest.fn(),
    adminUpdateSubscriptionPlan: jest.fn(),
    adminUploadSubscriptionPlanImage: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const tpl = {
  id: 'tpl-1', kind: 'ENTRIES', name: 'Carte 10 parties', sportKeys: ['padel'], description: null, imageUrl: null,
  price: '117.00', entriesCount: 10, walletAmount: null, validityDays: 180, isActive: true, createdAt: '2026-01-01T00:00:00Z',
  stats: { soldCount: 23, activeCount: 8, outstandingAmount: '0.00' },
};
const plan = {
  id: 'plan-1', name: 'Padel illimité', description: null, imageUrl: null, sportKeys: ['padel'],
  monthlyPrice: '49.00', commitmentMonths: 12, offPeakOnly: false, benefit: 'INCLUDED', discountPercent: null,
  dailyCap: null, weeklyCap: null, isActive: true, createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetPackageTemplates as jest.Mock).mockResolvedValue([tpl]);
  (api.adminGetSubscriptionPlans as jest.Mock).mockResolvedValue([plan]);
  (api.adminGetSubscriptionOverview as jest.Mock).mockResolvedValue({ kpis: { activeCount: 0, monthlyRevenueCents: 0, expiringSoonCount: 0 }, plans: [], subscribers: [] });
});

const mount = () =>
  render(<AdminRoleContext.Provider value="ADMIN"><ThemeProvider><AdminPackagesPage /></ThemeProvider></AdminRoleContext.Provider>);

it('club mono-sport : sections Abonnements / Carnets & Porte-monnaie inchangées, bandeau = couleur de type', async () => {
  mount();
  expect(await screen.findByText('Abonnements')).toBeInTheDocument();
  expect(screen.getByText('Carnets & Porte-monnaie')).toBeInTheDocument();
  expect(screen.queryByTestId('offer-sport-kicker')).toBeNull();

  const planCard = screen.getByText('Padel illimité').closest('div')!.parentElement!.parentElement!;
  const stripe = planCard.querySelector('[data-testid="offer-card-stripe"]')!;
  // ACCENTS.blue = offerTint('SUBSCRIPTION'), inchangé par rapport à avant cette évolution.
  expect(stripe).toHaveStyle({ background: '#5e93da' });
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminPackages.test.tsx __tests__/AdminPackages.monosport.test.tsx`
Expected: FAIL des deux fichiers — `AdminPackages.test.tsx` : les kickers restent « Abonnements »/« Carnets & Porte-monnaie » (pas de `data-testid="offer-sport-kicker"` posé, `OfferCard` n'a pas encore de props `sportTint`/`typeTint`) ; `AdminPackages.monosport.test.tsx` : `offer-card-stripe` introuvable (le `data-testid` n'existe pas encore sur `OfferCard.tsx`).

- [ ] **Step 3: Réécrire `OfferCard.tsx`**

Remplacer intégralement `frontend/components/admin/offers/OfferCard.tsx` par :

```tsx
'use client';
import { CSSProperties, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';

export interface OfferCardProps {
  sportTint: string;       // bandeau du haut (couleur de sport ; couleur de type si le club n'a qu'un sport)
  typeTint: string;        // badge « Abonnement »/« Carnet »/« Porte-monnaie » + pouls
  kindLabel: string;      // « Abonnement » / « Carnet » / « Porte-monnaie »
  name: string;
  price: string;          // « 49 € »
  priceSuffix: string | null; // « /mois · 12 mois » | « · 10 entrées » | …
  features: string;       // ligne de caractéristiques (déjà jointe au « · »)
  pulse: ReactNode;       // ligne de pouls (string ou bouton)
  isActive: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}

export function OfferCard(props: OfferCardProps) {
  const { th } = useTheme();
  const { sportTint, typeTint, kindLabel, name, price, priceSuffix, features, pulse, isActive, busy, onEdit, onToggleActive } = props;
  const card: CSSProperties = {
    position: 'relative', overflow: 'hidden', background: th.surface, borderRadius: 16, boxShadow: th.shadow,
    display: 'flex', flexDirection: 'column', opacity: isActive ? 1 : 0.55,
  };
  const mini: CSSProperties = {
    border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9,
    padding: '6px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700,
  };
  return (
    <div style={card}>
      <span aria-hidden data-testid="offer-card-stripe" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: isActive ? sportTint : th.textFaint }} />
      <div style={{ position: 'relative', padding: '13px 15px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ alignSelf: 'flex-start', fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: 999, padding: '3px 8px', background: th.mode === 'floodlit' ? `${typeTint}26` : `${typeTint}40`, color: th.mode === 'floodlit' ? typeTint : th.ink }}>
          {kindLabel}
        </span>
        <div style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 15, letterSpacing: -0.2, color: th.text, marginTop: 6 }}>{name}</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, letterSpacing: -1, color: th.text }}>
          <span>{price}</span>{priceSuffix && <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: th.textMute, letterSpacing: 0 }}> {priceSuffix}</span>}
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute, lineHeight: 1.45, marginTop: 2 }}>{features}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: isActive ? typeTint : th.textMute, marginTop: 8 }}>{pulse}</div>
      </div>
      <div style={{ position: 'relative', borderTop: `1px solid ${th.line}`, padding: '9px 15px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: isActive ? ACCENTS.emerald : th.textFaint }} />
        <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, color: th.textMute, marginRight: 'auto' }}>{isActive ? 'En vente' : 'Retirée de la vente'}</span>
        <button type="button" onClick={onEdit} disabled={busy} style={mini}>Modifier</button>
        <button type="button" onClick={onToggleActive} disabled={busy} style={{ ...mini, color: isActive ? '#ff7a4d' : th.text }}>
          {isActive ? 'Retirer' : 'Remettre en vente'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Réécrire `OfferPreviewCard.tsx`**

Remplacer intégralement `frontend/components/admin/offers/OfferPreviewCard.tsx` par :

```tsx
'use client';
import { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

export interface OfferPreview {
  kindLabel: string;        // « Abonnement » / « Carnet » / « Porte-monnaie »
  sportTint: string;        // bandeau du haut (couleur de sport ; couleur de type si le club n'a qu'un sport)
  typeTint: string;         // badge + bouton « Souscrire »
  name: string;
  price: string;            // « 49 € »
  priceSuffix: string | null; // « /mois » | null
  lines: string[];          // caractéristiques (sports, créneaux, avantage, validité…)
  description: string;
  ctaLabel: string;         // « Souscrire · 49 € »
  imageUrl: string | null;  // object URL (aperçu local) ou asset URL
}

/** Carte « ce que verront vos joueurs » — miroir statique de OffersShowcase. */
export function OfferPreviewCard({ preview }: { preview: OfferPreview }) {
  const { th } = useTheme();
  const { kindLabel, sportTint, typeTint, name, price, priceSuffix, lines, description, ctaLabel, imageUrl } = preview;
  const card: CSSProperties = {
    background: th.surface, borderRadius: 16, boxShadow: th.shadow,
    width: 236, overflow: 'hidden', position: 'relative',
    padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 4,
  };
  return (
    <div style={card}>
      <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: sportTint }} />
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" style={{ position: 'relative', display: 'block', width: '100%', height: 'auto', maxHeight: 120, objectFit: 'cover', borderRadius: 10, marginBottom: 4 }} />
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: 999, padding: '3px 8px', background: th.mode === 'floodlit' ? `${typeTint}26` : `${typeTint}40`, color: th.mode === 'floodlit' ? typeTint : th.ink }}>
          {kindLabel}
        </span>
      </div>
      <div style={{ position: 'relative', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, marginTop: 6 }}>{name || 'Sans nom'}</div>
      <div style={{ position: 'relative', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 27, letterSpacing: -0.5, color: th.text }}>
        <span>{price}</span>{priceSuffix && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, letterSpacing: 0 }}> {priceSuffix}</span>}
      </div>
      {lines.length > 0 && (
        <div style={{ position: 'relative', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.55 }}>{lines.join(' · ')}</div>
      )}
      {description && (
        <div style={{ position: 'relative', fontFamily: th.fontUI, fontSize: 12, color: th.textMute, lineHeight: 1.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>{description}</div>
      )}
      <div style={{ position: 'relative', marginTop: 10, border: `1.5px solid ${typeTint}`, textAlign: 'center', color: th.mode === 'floodlit' ? typeTint : th.ink, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>
        {ctaLabel}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Modifier `OfferStudio.tsx`**

Dans `frontend/components/admin/offers/OfferStudio.tsx`, appliquer ces 4 changements :

1) Import (ligne 5) — remplacer :
```ts
import { offerTint } from '@/lib/adminOffers';
```
par :
```ts
import { offerTint, sportOfferTint } from '@/lib/adminOffers';
```

2) Interface `OfferStudioProps` — ajouter `multiSport: boolean;` juste après `sportOptions: string[];` :
```ts
export interface OfferStudioProps {
  open: boolean;
  editing?: { kind: 'plan'; plan: SubscriptionPlan } | { kind: 'package'; tpl: PackageTemplate };
  sportOptions: string[];
  multiSport: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (result: OfferStudioResult) => void;
}
```

3) Destructuring des props — remplacer :
```ts
const { open, editing, sportOptions, busy, error, onClose, onSubmit } = props;
```
par :
```ts
const { open, editing, sportOptions, multiSport, busy, error, onClose, onSubmit } = props;
```

4) Calcul des teintes et construction du `preview` — remplacer :
```ts
  const tint = offerTint(kind === 'PLAN' ? 'SUBSCRIPTION' : kind);
  const priceNum = Number(price) || 0;
```
par :
```ts
  const typeTint = offerTint(kind === 'PLAN' ? 'SUBSCRIPTION' : kind);
  const sportTint = multiSport ? sportOfferTint(sports) : typeTint;
  const priceNum = Number(price) || 0;
```
et remplacer :
```ts
  const preview: OfferPreview = {
    kindLabel, tint, name, description,
```
par :
```ts
  const preview: OfferPreview = {
    kindLabel, sportTint, typeTint, name, description,
```

- [ ] **Step 6: Modifier `app/admin/packages/page.tsx`**

Remplacer intégralement `frontend/app/admin/packages/page.tsx` par :

```tsx
'use client';
import { useState, useEffect, useCallback, CSSProperties, ReactNode } from 'react';
import { api, PackageTemplate, SubscriptionPlan, SubscriptionOverview } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { isClubAdmin, useAdminRole } from '@/lib/adminRole';
import { clubIsMultiSport } from '@/lib/sportBadge';
import {
  offerTint, sportOfferTint, sportKeyColor, sportGroupLabel, groupOffersBySport,
  planPulse, packagePulse, planRevenueCents, splitByActive,
} from '@/lib/adminOffers';
import { OfferCard } from '@/components/admin/offers/OfferCard';
import { OfferStudio, OfferStudioResult } from '@/components/admin/offers/OfferStudio';

const euro = (s: string | number) => `${Number(s).toFixed(2).replace('.', ',')} €`;
const SPORT_OPTIONS = ['padel', 'squash', 'tennis', 'badminton', 'pickleball', 'pingpong'];

type Editing = { kind: 'plan'; plan: SubscriptionPlan } | { kind: 'package'; tpl: PackageTemplate };
type Entry = { sportKeys: string[]; render: () => ReactNode };

export default function AdminPackagesPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const admin = isClubAdmin(useAdminRole());

  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [plans, setPlans]         = useState<SubscriptionPlan[]>([]);
  const [overview, setOverview]   = useState<SubscriptionOverview | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);
  const [nowMs, setNowMs]         = useState(0);

  const [studioOpen, setStudioOpen] = useState(false);
  const [editing, setEditing]       = useState<Editing | undefined>(undefined);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try {
      setError(null);
      const [tpls, pls, ov] = await Promise.all([
        api.adminGetPackageTemplates(clubId, token),
        api.adminGetSubscriptionPlans(clubId, token),
        api.adminGetSubscriptionOverview(clubId, token),
      ]);
      setTemplates(tpls); setPlans(pls); setOverview(ov); setNowMs(Date.now());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId && admin) load(); }, [ready, token, clubId, admin, load]);

  const openCreate = () => { setEditing(undefined); setStudioOpen(true); };
  const openEditPlan = (p: SubscriptionPlan) => { setEditing({ kind: 'plan', plan: p }); setStudioOpen(true); };
  const openEditTpl = (t: PackageTemplate) => { setEditing({ kind: 'package', tpl: t }); setStudioOpen(true); };

  const submitStudio = async (r: OfferStudioResult) => {
    if (!token || !clubId) return;
    setBusy(true);
    try {
      setError(null);
      if (r.kind === 'plan') {
        if (editing?.kind === 'plan') {
          await api.adminUpdateSubscriptionPlan(clubId, editing.plan.id, {
            ...r.body, ...(r.removeImage && !r.imageFile ? { imageUrl: null } : {}),
          }, token);
          if (r.imageFile) await api.adminUploadSubscriptionPlanImage(clubId, editing.plan.id, r.imageFile, token);
        } else {
          const created = await api.adminCreateSubscriptionPlan(clubId, r.body, token);
          if (r.imageFile) await api.adminUploadSubscriptionPlanImage(clubId, created.id, r.imageFile, token);
        }
      } else {
        if (editing?.kind === 'package') {
          await api.adminUpdatePackageTemplate(clubId, editing.tpl.id, {
            ...r.body, ...(r.removeImage && !r.imageFile ? { imageUrl: null } : {}),
          }, token);
          if (r.imageFile) await api.adminUploadPackageTemplateImage(clubId, editing.tpl.id, r.imageFile, token);
        } else {
          const created = await api.adminCreatePackageTemplate(clubId, r.body, token);
          if (r.imageFile) await api.adminUploadPackageTemplateImage(clubId, created.id, r.imageFile, token);
        }
      }
      setStudioOpen(false); setEditing(undefined);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleTpl = async (t: PackageTemplate) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { setError(null); await api.adminUpdatePackageTemplate(clubId, t.id, { isActive: !t.isActive }, token); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const togglePlan = async (p: SubscriptionPlan) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { setError(null); await api.adminUpdateSubscriptionPlan(clubId, p.id, { isActive: !p.isActive }, token); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const subscribers = overview?.subscribers ?? [];
  const activeCountFor = (planId: string) => overview?.plans.find((p) => p.id === planId)?.activeCount ?? 0;
  const membersHref = (planId: string) => `/admin/members?plan=${planId}`;

  const { active: activePlans, inactive: inactivePlans } = splitByActive(plans);
  const { active: activeTpls, inactive: inactiveTpls } = splitByActive(templates);
  const orderedPlans = [...activePlans, ...inactivePlans];
  const orderedTpls = [...activeTpls, ...inactiveTpls];

  const multiSport = clubIsMultiSport(club);

  const planEntries: Entry[] = orderedPlans.map((p): Entry => ({
    sportKeys: p.sportKeys,
    render: () => (
      <OfferCard key={p.id} typeTint={offerTint('SUBSCRIPTION')}
        sportTint={multiSport ? sportOfferTint(p.sportKeys) : offerTint('SUBSCRIPTION')}
        kindLabel="Abonnement" name={p.name}
        price={euro(p.monthlyPrice)} priceSuffix={`/mois · ${p.commitmentMonths} mois`}
        features={[
          p.sportKeys.length > 0 ? p.sportKeys.join(', ') : 'Tous sports',
          p.offPeakOnly ? 'Heures creuses' : 'Toutes heures',
          p.benefit === 'INCLUDED' ? 'inclus' : `−${p.discountPercent} %`,
        ].join(' · ')}
        pulse={
          activeCountFor(p.id) > 0 ? (
            <a href={membersHref(p.id)} style={{ color: 'inherit', textDecoration: 'none' }}>
              {planPulse(activeCountFor(p.id), planRevenueCents(subscribers, p.id, nowMs))} <span aria-hidden>→</span>
            </a>
          ) : planPulse(0, 0)
        }
        isActive={p.isActive} busy={busy} onEdit={() => openEditPlan(p)} onToggleActive={() => togglePlan(p)} />
    ),
  }));

  const tplEntries: Entry[] = orderedTpls.map((t): Entry => ({
    sportKeys: t.sportKeys,
    render: () => (
      <OfferCard key={t.id} typeTint={offerTint(t.kind)}
        sportTint={multiSport ? sportOfferTint(t.sportKeys) : offerTint(t.kind)}
        kindLabel={t.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie'} name={t.name}
        price={euro(t.price)}
        priceSuffix={t.kind === 'ENTRIES' ? `· ${t.entriesCount} entrées` : `· ${euro(t.walletAmount ?? 0)} crédités`}
        features={[
          t.sportKeys.length > 0 ? t.sportKeys.join(', ') : 'Tous sports',
          t.validityDays ? `valable ${t.validityDays} j` : 'sans expiration',
        ].join(' · ')}
        pulse={packagePulse(t.stats, t.kind)}
        isActive={t.isActive} busy={busy} onEdit={() => openEditTpl(t)} onToggleActive={() => toggleTpl(t)} />
    ),
  }));

  const sportGroups = multiSport ? groupOffersBySport([...planEntries, ...tplEntries], club?.clubSports ?? []) : [];

  const h1: CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text };
  const kicker: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: th.textMute, margin: '26px 0 12px' };
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 };
  const Kicker = ({ children, dot }: { children: React.ReactNode; dot?: string }) => (
    <div style={kicker} data-testid={dot ? 'offer-sport-kicker' : undefined}>
      {dot && <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: dot }} />}
      <span>{children}</span>
      <span aria-hidden style={{ flex: 1, height: 1, background: th.line }} />
    </div>
  );

  const empty = !loading && plans.length === 0 && templates.length === 0;

  if (!admin) {
    return <div style={{ marginTop: 20, fontFamily: th.fontUI, color: th.textMute }}>Cette page est réservée aux administrateurs du club.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={h1}>Offres</h1>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={openCreate}
          style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 18px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800, boxShadow: th.shadowSoft }}>
          ＋ Créer une offre
        </button>
      </div>

      {error && <div style={{ marginTop: 16, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {loading ? (
        <div style={{ marginTop: 20, fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : empty ? (
        <div style={{ marginTop: 30, background: th.surface, borderRadius: 16, boxShadow: th.shadow, padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: th.text }}>Créez votre première offre</div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 6 }}>Abonnements, carnets d’entrées ou porte-monnaie — vos joueurs les verront sur le Club-house.</div>
          <button type="button" onClick={openCreate} style={{ marginTop: 16, border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 18px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800 }}>＋ Créer une offre</button>
        </div>
      ) : multiSport ? (
        sportGroups.map((g) => (
          <div key={g.key ?? '_other'}>
            <Kicker dot={sportKeyColor(g.key)}>{sportGroupLabel(g.key, club)}</Kicker>
            <div style={grid}>{g.items.map((e) => e.render())}</div>
          </div>
        ))
      ) : (
        <>
          {planEntries.length > 0 && (
            <>
              <Kicker>Abonnements</Kicker>
              <div style={grid}>{planEntries.map((e) => e.render())}</div>
            </>
          )}
          {tplEntries.length > 0 && (
            <>
              <Kicker>Carnets &amp; Porte-monnaie</Kicker>
              <div style={grid}>{tplEntries.map((e) => e.render())}</div>
            </>
          )}
        </>
      )}

      <OfferStudio open={studioOpen} editing={editing}
        sportOptions={SPORT_OPTIONS} multiSport={multiSport} busy={busy} error={studioOpen ? error : null}
        onClose={() => { setStudioOpen(false); setEditing(undefined); }} onSubmit={submitStudio} />
    </div>
  );
}
```

- [ ] **Step 7: Vérifier que tous les tests passent**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminPackages.test.tsx __tests__/AdminPackages.monosport.test.tsx`
Expected: PASS — tous verts.

- [ ] **Step 8: Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune nouvelle erreur (vérifier en particulier qu'aucun autre fichier n'importait `OfferCardProps.tint` ou `OfferPreview.tint` — recherche ci-dessous).

Run: `cd frontend && grep -rn "OfferPreview\b" --include=*.tsx --include=*.ts . | grep -v __tests__ | grep -v node_modules`
Expected: seuls `OfferPreviewCard.tsx` et `OfferStudio.tsx` apparaissent (aucun autre consommateur du type `tint`).

- [ ] **Step 9: Commit**

```bash
git add frontend/components/admin/offers/OfferCard.tsx frontend/components/admin/offers/OfferPreviewCard.tsx \
  frontend/components/admin/offers/OfferStudio.tsx frontend/app/admin/packages/page.tsx \
  frontend/__tests__/AdminPackages.test.tsx frontend/__tests__/AdminPackages.monosport.test.tsx
git commit -m "feat(admin): offres groupées et colorées par sport sur /admin/packages"
```

---

## Task 4: Régression complète + note CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Suite complète frontend**

Run: `cd frontend && node node_modules/jest/bin/jest.js`
Expected: PASS. Ignorer le flake pré-existant connu et sans rapport avec ce travail : `BookingModal` qui échoue parfois en suite complète mais passe en isolation (cf. mémoire projet « frontend-full-suite-bookingmodal-flake »). Si un autre test échoue, investiguer avant de continuer.

- [ ] **Step 2: Type-check complet**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Ajouter l'entrée d'évolution dans CLAUDE.md**

Dans `CLAUDE.md`, section `## Caisse & carnets (v1) ✅ implémenté`, ajouter un nouveau paragraphe `> **Évolution (2026-07-17) — ...`, juste après le dernier paragraphe d'évolution de cette section (celui daté 2026-07-13 sur la page admin « Offres » refondue en vitrine miroir), avec ce texte :

```markdown
> **Évolution (2026-07-17) — offres triées et colorées par sport (Club-house + admin) :** sur un club **multi-sport** (`clubIsMultiSport`), les offres (abonnements/carnets/porte-monnaie) sont désormais **groupées par sport** — sections avec kicker coloré (point + nom), dans l'**ordre des sports du club** (`club.clubSports`), compartiment **« Tous sports »** (offre à 0 ou plusieurs sports) toujours en dernier — sur le rail Club-house (`OffersShowcase.tsx`) **et** sur `/admin/packages` (remplace les kickers « Abonnements »/« Carnets & Porte-monnaie », qui restent le comportement d'un club **mono-sport**, strictement inchangé). Chaque carte porte désormais **deux teintes indépendantes** : `sportTint` (bandeau du haut, nouvelle palette dédiée **`SPORT_COLORS`** — 6 couleurs pastel, une par sport du catalogue plateforme, + `SPORT_COLOR_OTHER` neutre pour « Tous sports ») et `typeTint` (badge de type, inchangé — `offerTint`). Helpers purs testés **`frontend/lib/adminOffers.ts`** (`sportOfferTint`, `sportKeyColor`, `sportGroupLabel`, `groupOffersBySport` — regroupement stable, ordre du club, groupes vides omis). Aperçu studio (`OfferPreviewCard`/`OfferStudio`) aligné : `sportTint` recalculé en direct depuis les sports cochés dans le formulaire. **100 % frontend, aucune migration, aucun changement backend.** Tests : `adminOffers`, `OffersShowcase`, `AdminPackages` (+ nouveau `AdminPackages.monosport`). Spec : `docs/superpowers/specs/2026-07-17-offres-tri-couleur-sport-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: entrée CLAUDE.md — offres triées et colorées par sport"
```

---

## Self-Review effectué

- **Couverture spec** : §1 (palette) → Task 1 ; §2 (tri/groupement, ordre club-sport, "Tous sports" en dernier) → Task 1 + rendu Task 2/3 ; §3 (deux couleurs par carte, aperçu studio) → Task 2/3 ; §4 (helpers) → Task 1 ; §5 (fichiers touchés) → couvre les 6 fichiers listés ; §6 (tests) → chaque fichier de test cité est modifié/créé dans une tâche. Gate mono-sport (§ dédiée) → vérifié explicitement dans Task 2 Step 1 et Task 3 (fichier `.monosport.test.tsx` dédié, nécessaire car le mock `useClub` de `AdminPackages.test.tsx` est déjà multi-sport).
- **Placeholders** : aucun « TBD »/« à compléter » — chaque step contient soit du code complet, soit une commande exacte avec sortie attendue.
- **Cohérence des types** : `sportTint`/`typeTint` nommés identiquement dans `OfferCard.tsx`, `OfferPreviewCard.tsx`, `OfferStudio.tsx`, `OffersShowcase.tsx` (local) et leurs consommateurs (`page.tsx`) ; `groupOffersBySport<T extends {sportKeys:string[]}>` utilisé avec `CardEntry`/`Entry`, tous deux porteurs de `sportKeys` ; `sportGroupLabel`/`sportKeyColor` prennent `key: string | null` partout, jamais `undefined`.

## Hors périmètre (rappel spec)

- Réordonnancement manuel des sections par l'admin.
- Couleur de sport configurable par le club.
- Application de cette palette à d'autres surfaces (badges sport sur parties/tournois/events).
