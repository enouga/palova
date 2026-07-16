# Offres — couleur par type, sans dégradé — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les teintes cyclées-par-position (`OFFER_TINTS`/`offerAccent(index)`) par une teinte déterminée par le TYPE d'offre (Abonnement=bleu, Carnet=abricot, Porte-monnaie=émeraude) et supprimer le lavis dégradé, sur les 3 surfaces qui affichent des cartes d'offres.

**Architecture:** Un seul helper pur `offerTint(kind)` dans `frontend/lib/adminOffers.ts` remplace `offerAccent(index)`. Chaque surface (page admin, vitrine Club-house, aperçu du studio) est migrée une à une vers ce helper, puis le code mort (`OFFER_TINTS`, `offerAccent`, `previewIndex`) est retiré. Chaque commit laisse le dépôt dans un état qui compile et dont les tests passent — `offerAccent` n'est supprimé qu'après que plus aucun call site n'y fasse référence.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Jest + React Testing Library (`ts-jest`). Aucun changement backend, aucune migration.

**Périmètre (rappel spec) :** `docs/superpowers/specs/2026-07-16-offres-couleur-par-type-design.md`. 3 fichiers de composant + 1 page + 1 helper + 1 fichier de test à modifier :
- `frontend/lib/adminOffers.ts`
- `frontend/__tests__/adminOffers.test.ts`
- `frontend/components/admin/offers/OfferCard.tsx`
- `frontend/app/admin/packages/page.tsx`
- `frontend/components/admin/offers/OfferPreviewCard.tsx`
- `frontend/components/admin/offers/OfferStudio.tsx`
- `frontend/components/clubhouse/OffersShowcase.tsx`

**Environnement d'exécution :** ce dépôt tourne sous Windows ; les shims `node_modules/.bin` sont cassés sur cette machine — invoquer jest/tsc via `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc`, jamais `npx`. Un `tsc --noEmit` plein projet affiche 3 erreurs préexistantes et non liées dans `.next/dev/types/routes.d.ts` (fichier généré par Next, pas du code source) — ignorer ce bruit et ne regarder que les erreurs dans les fichiers de ce plan.

---

### Task 1: Ajouter le helper pur `offerTint(kind)` (TDD)

**Files:**
- Modify: `frontend/__tests__/adminOffers.test.ts:1-12`
- Modify: `frontend/lib/adminOffers.ts:1-6`

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/__tests__/adminOffers.test.ts`, ajouter un import de `ACCENTS` et un nouveau bloc `describe('offerTint', ...)` **à côté** du bloc `offerAccent` existant (ne pas encore toucher au bloc `offerAccent` — il sera retiré à la Task 7, une fois tous les appelants migrés) :

```ts
import {
  OFFER_TINTS, offerAccent, offerTint, planPulse, packagePulse, planRevenueCents, splitByActive,
} from '../lib/adminOffers';
import { ACCENTS } from '../lib/theme';
import type { PackageTemplate, SubscriberRow } from '../lib/api';

describe('offerAccent', () => {
  it('cycle sur la palette', () => {
    expect(offerAccent(0)).toBe(OFFER_TINTS[0]);
    expect(offerAccent(OFFER_TINTS.length)).toBe(OFFER_TINTS[0]);
    expect(offerAccent(OFFER_TINTS.length + 2)).toBe(OFFER_TINTS[2]);
  });
});

describe('offerTint', () => {
  it('un abonnement est toujours bleu', () => {
    expect(offerTint('SUBSCRIPTION')).toBe(ACCENTS.blue);
  });
  it('un carnet (ENTRIES) est toujours abricot', () => {
    expect(offerTint('ENTRIES')).toBe(ACCENTS.apricot);
  });
  it('un porte-monnaie (WALLET) est toujours émeraude', () => {
    expect(offerTint('WALLET')).toBe(ACCENTS.emerald);
  });
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/adminOffers.test.ts`
Expected: FAIL — `offerTint` n'est pas exporté par `../lib/adminOffers` (TypeScript/module error, le fichier ne compile pas car `offerTint` n'existe pas encore).

- [ ] **Step 3: Implémenter `offerTint` sans toucher à `offerAccent`/`OFFER_TINTS`**

Dans `frontend/lib/adminOffers.ts`, ajouter le nouveau type et helper **juste après** les lignes existantes (`OFFER_TINTS`/`offerAccent` restent en place pour l'instant — `OfferStudio.tsx` en dépend encore jusqu'à la Task 5) :

```ts
import { ACCENTS } from '@/lib/theme';
import type { PackageKind, SubscriberRow } from '@/lib/api';

/** Teintes cyclées des cartes (miroir de OffersShowcase, même ordre). */
export const OFFER_TINTS = [ACCENTS.blue, ACCENTS.apricot, ACCENTS.emerald, ACCENTS.violet, ACCENTS.cyan];
export const offerAccent = (index: number): string => OFFER_TINTS[((index % OFFER_TINTS.length) + OFFER_TINTS.length) % OFFER_TINTS.length];

/** Type d'offre pour la couleur : un abonnement, un carnet (entrées) ou un porte-monnaie. */
export type OfferTintKind = 'SUBSCRIPTION' | PackageKind;

/** Couleur d'une offre déterminée par son TYPE (pas sa position) : deux offres du même type partagent toujours la même teinte. */
export const offerTint = (kind: OfferTintKind): string =>
  kind === 'SUBSCRIPTION' ? ACCENTS.blue : kind === 'ENTRIES' ? ACCENTS.apricot : ACCENTS.emerald;
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/adminOffers.test.ts`
Expected: PASS — `Tests: 12 passed, 12 total` (9 existants + 3 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/adminOffers.ts frontend/__tests__/adminOffers.test.ts
git commit -m "feat(offers): ajoute offerTint(kind), couleur par type d'offre"
```

---

### Task 2: `OfferCard.tsx` — retirer le lavis dégradé (page admin)

**Files:**
- Modify: `frontend/components/admin/offers/OfferCard.tsx:33-34`

**Contexte :** changement purement visuel (suppression d'un `<span>` décoratif), sans nouveau comportement à tester — pas de fichier de test dédié à `OfferCard` (le composant est exercé indirectement par `AdminPackages.test.tsx`, qui n'affirme rien sur la couleur). On vérifie par régression de cette suite.

- [ ] **Step 1: Retirer le `<span>` dégradé**

Dans `OfferCard.tsx`, la fonction rend actuellement (lignes 32-34) :

```tsx
    <div style={card}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: isActive ? tint : th.textFaint }} />
      <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 52, background: `linear-gradient(180deg, ${tint}${th.mode === 'floodlit' ? '20' : '2e'}, transparent)`, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', padding: '13px 15px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
```

Remplacer par (le liseré latéral reste, le dégradé du haut disparaît) :

```tsx
    <div style={card}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: isActive ? tint : th.textFaint }} />
      <div style={{ position: 'relative', padding: '13px 15px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
```

- [ ] **Step 2: Lancer la suite de régression**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/AdminPackages.test.tsx`
Expected: PASS — `Tests: 8 passed, 8 total` (aucune régression, aucune assertion sur le dégradé retiré).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/admin/offers/OfferCard.tsx
git commit -m "fix(offers): retire le lavis degrade de la carte admin"
```

---

### Task 3: `app/admin/packages/page.tsx` — brancher les 2 grilles sur `offerTint`

**Files:**
- Modify: `frontend/app/admin/packages/page.tsx:7`
- Modify: `frontend/app/admin/packages/page.tsx:147`
- Modify: `frontend/app/admin/packages/page.tsx:172`

- [ ] **Step 1: Changer l'import**

Ligne 7, remplacer :

```ts
import { offerAccent, planPulse, packagePulse, planRevenueCents, splitByActive } from '@/lib/adminOffers';
```

par :

```ts
import { offerTint, planPulse, packagePulse, planRevenueCents, splitByActive } from '@/lib/adminOffers';
```

- [ ] **Step 2: Grille Abonnements — remplacer `offerAccent(i)` par `offerTint('SUBSCRIPTION')`**

Ligne 147, remplacer :

```tsx
                {orderedPlans.map((p, i) => (
                  <OfferCard key={p.id} tint={offerAccent(i)} kindLabel="Abonnement" name={p.name}
```

par :

```tsx
                {orderedPlans.map((p, i) => (
                  <OfferCard key={p.id} tint={offerTint('SUBSCRIPTION')} kindLabel="Abonnement" name={p.name}
```

(`i` reste utilisé par `key`/le reste de la boucle — seule la teinte change de source.)

- [ ] **Step 3: Grille Carnets & Porte-monnaie — remplacer `offerAccent(orderedPlans.length + i)` par `offerTint(t.kind)`**

Ligne 172, remplacer :

```tsx
                {orderedTpls.map((t, i) => (
                  <OfferCard key={t.id} tint={offerAccent(orderedPlans.length + i)}
```

par :

```tsx
                {orderedTpls.map((t, i) => (
                  <OfferCard key={t.id} tint={offerTint(t.kind)}
```

- [ ] **Step 4: Lancer la suite de régression**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/AdminPackages.test.tsx`
Expected: PASS — `Tests: 8 passed, 8 total`.

- [ ] **Step 5: Vérifier la compilation TypeScript du fichier touché**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "app/admin/packages/page.tsx"`
Expected: aucune sortie (pas d'erreur sur ce fichier).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/admin/packages/page.tsx
git commit -m "feat(offers): grilles admin branchees sur offerTint(kind)"
```

---

### Task 4: `OfferPreviewCard.tsx` — retirer le lavis dégradé (aperçu studio + partagé Club-house)

**Files:**
- Modify: `frontend/components/admin/offers/OfferPreviewCard.tsx:27-29`

**Contexte :** même remarque que Task 2 — changement visuel pur, exercé indirectement par `AdminPackages.test.tsx` (le test « Créer une offre » ouvre le studio et affiche cette carte).

- [ ] **Step 1: Retirer le `<span>` dégradé**

Remplacer (lignes 27-29) :

```tsx
  return (
    <div style={card}>
      <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72, background: `linear-gradient(180deg, ${tint}${th.mode === 'floodlit' ? '26' : '33'}, transparent)`, pointerEvents: 'none' }} />
      <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: tint }} />
```

par :

```tsx
  return (
    <div style={card}>
      <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: tint }} />
```

- [ ] **Step 2: Lancer la suite de régression**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/AdminPackages.test.tsx`
Expected: PASS — `Tests: 8 passed, 8 total`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/admin/offers/OfferPreviewCard.tsx
git commit -m "fix(offers): retire le lavis degrade de l'apercu studio"
```

---

### Task 5: `OfferStudio.tsx` — retirer `previewIndex`, brancher `offerTint(kind)` selon le type sélectionné

**Files:**
- Modify: `frontend/components/admin/offers/OfferStudio.tsx:5`
- Modify: `frontend/components/admin/offers/OfferStudio.tsx:16-25` (interface `OfferStudioProps`)
- Modify: `frontend/components/admin/offers/OfferStudio.tsx:31`
- Modify: `frontend/components/admin/offers/OfferStudio.tsx:92`
- Modify: `frontend/app/admin/packages/page.tsx:189`

**Pourquoi un seul commit pour 2 fichiers :** `previewIndex` est retiré de l'interface `OfferStudioProps` **et** de son unique call site en même temps — sinon TypeScript échoue (excess-property check sur l'attribut JSX dans `page.tsx`, ou prop manquante si on inverse l'ordre).

- [ ] **Step 1: Changer l'import dans `OfferStudio.tsx`**

Ligne 5, remplacer :

```ts
import { offerAccent } from '@/lib/adminOffers';
```

par :

```ts
import { offerTint } from '@/lib/adminOffers';
```

- [ ] **Step 2: Retirer `previewIndex` de l'interface**

Remplacer (lignes 16-25) :

```ts
export interface OfferStudioProps {
  open: boolean;
  editing?: { kind: 'plan'; plan: SubscriptionPlan } | { kind: 'package'; tpl: PackageTemplate };
  previewIndex: number;
  sportOptions: string[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (result: OfferStudioResult) => void;
}
```

par :

```ts
export interface OfferStudioProps {
  open: boolean;
  editing?: { kind: 'plan'; plan: SubscriptionPlan } | { kind: 'package'; tpl: PackageTemplate };
  sportOptions: string[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (result: OfferStudioResult) => void;
}
```

- [ ] **Step 3: Retirer `previewIndex` de la destructuration des props**

Ligne 31, remplacer :

```ts
  const { open, editing, previewIndex, sportOptions, busy, error, onClose, onSubmit } = props;
```

par :

```ts
  const { open, editing, sportOptions, busy, error, onClose, onSubmit } = props;
```

- [ ] **Step 4: Calculer la teinte depuis le type sélectionné (`kind`) au lieu de `previewIndex`**

Ligne 92, remplacer :

```ts
  const tint = offerAccent(previewIndex);
```

par :

```ts
  const tint = offerTint(kind === 'PLAN' ? 'SUBSCRIPTION' : kind);
```

(`kind` est de type `StudioKind = 'PLAN' | 'ENTRIES' | 'WALLET'` défini ligne 9 — `'PLAN'` se traduit en `'SUBSCRIPTION'` pour `offerTint`, les deux autres valeurs passent telles quelles puisqu'elles correspondent déjà à `PackageKind`.)

- [ ] **Step 5: Retirer `previewIndex` du call site dans `page.tsx`**

Dans `frontend/app/admin/packages/page.tsx`, ligne 189, remplacer :

```tsx
      <OfferStudio open={studioOpen} editing={editing} previewIndex={editing ? 0 : orderedPlans.length + orderedTpls.length}
        sportOptions={SPORT_OPTIONS} busy={busy} error={studioOpen ? error : null}
        onClose={() => { setStudioOpen(false); setEditing(undefined); }} onSubmit={submitStudio} />
```

par :

```tsx
      <OfferStudio open={studioOpen} editing={editing}
        sportOptions={SPORT_OPTIONS} busy={busy} error={studioOpen ? error : null}
        onClose={() => { setStudioOpen(false); setEditing(undefined); }} onSubmit={submitStudio} />
```

- [ ] **Step 6: Lancer la suite de régression**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/AdminPackages.test.tsx`
Expected: PASS — `Tests: 8 passed, 8 total` (le test « crée un carnet via le studio » clique sur le chip « Carnet » puis soumet — vérifie implicitement que le studio fonctionne toujours sans `previewIndex`).

- [ ] **Step 7: Vérifier la compilation TypeScript des 2 fichiers touchés**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "OfferStudio\.tsx|admin/packages/page\.tsx"`
Expected: aucune sortie.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/admin/offers/OfferStudio.tsx frontend/app/admin/packages/page.tsx
git commit -m "feat(offers): apercu studio teinte par type choisi, retire previewIndex"
```

---

### Task 6: `OffersShowcase.tsx` (Club-house) — retirer le cycle local + le dégradé, brancher `offerTint`

**Files:**
- Modify: `frontend/components/clubhouse/OffersShowcase.tsx:8` (import `ACCENTS`)
- Modify: `frontend/components/clubhouse/OffersShowcase.tsx:61-63` (commentaire + `OFFER_TINTS` local)
- Modify: `frontend/components/clubhouse/OffersShowcase.tsx:70` (dégradé)
- Modify: `frontend/components/clubhouse/OffersShowcase.tsx:115`
- Modify: `frontend/components/clubhouse/OffersShowcase.tsx:121`

- [ ] **Step 1: Remplacer l'import `ACCENTS` par `offerTint`**

Ligne 8, remplacer :

```ts
import { ACCENTS } from '@/lib/theme';
```

par :

```ts
import { offerTint } from '@/lib/adminOffers';
```

(`ACCENTS` n'est utilisé nulle part ailleurs dans ce fichier — vérifié : seule occurrence restante était `OFFER_TINTS` retiré à l'étape suivante.)

- [ ] **Step 2: Retirer le tableau local `OFFER_TINTS` et son commentaire**

Remplacer (lignes 61-63) :

```tsx
  // Chaque carte du rail prend une teinte de la palette (cycle par position) : lavis en
  // tête, chip de type et CTA assortis — de la couleur sans casser le fond clair.
  const OFFER_TINTS = [ACCENTS.blue, ACCENTS.apricot, ACCENTS.emerald, ACCENTS.violet, ACCENTS.cyan];

  // Carte compacte du rail : prix en chiffre vedette, bénéfices en 2 lignes, CTA fin.
```

par :

```tsx
  // Carte compacte du rail : prix en chiffre vedette, bénéfices en 2 lignes, CTA fin.
```

- [ ] **Step 3: Retirer le `<span>` dégradé de la carte du rail**

Remplacer (ligne 69-71) :

```tsx
    <div className="of-card" style={{ ...cardStyle(th), flex: '0 0 236px', scrollSnapAlign: 'start', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', overflow: 'hidden' }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72, background: `linear-gradient(180deg, ${tint}${th.mode === 'floodlit' ? '26' : '33'}, transparent)`, pointerEvents: 'none' }} />
      <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: tint }} />
```

par :

```tsx
    <div className="of-card" style={{ ...cardStyle(th), flex: '0 0 236px', scrollSnapAlign: 'start', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', overflow: 'hidden' }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: tint }} />
```

- [ ] **Step 4: Brancher les 2 usages sur `offerTint`**

Remplacer (ligne 115) :

```tsx
            kindLabel="Abonnement" tint={OFFER_TINTS[i % OFFER_TINTS.length]}
```

par :

```tsx
            kindLabel="Abonnement" tint={offerTint('SUBSCRIPTION')}
```

Remplacer (ligne 121) :

```tsx
            tint={OFFER_TINTS[(plans.length + i) % OFFER_TINTS.length]}
```

par :

```tsx
            tint={offerTint(t.kind)}
```

- [ ] **Step 5: Lancer la suite de régression**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/OffersShowcase.test.tsx`
Expected: PASS — `Tests: 11 passed, 11 total` (inchangé par rapport à la baseline, aucune assertion de couleur dans cette suite).

- [ ] **Step 6: Vérifier la compilation TypeScript du fichier touché**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "OffersShowcase.tsx"`
Expected: aucune sortie.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/clubhouse/OffersShowcase.tsx
git commit -m "feat(offers): club-house branche sur offerTint, retire le cycle local"
```

---

### Task 7: Nettoyage — retirer le code mort `OFFER_TINTS`/`offerAccent`

**Files:**
- Modify: `frontend/lib/adminOffers.ts:1-6`
- Modify: `frontend/__tests__/adminOffers.test.ts:1-12`

**Pré-requis :** après les Tasks 2-6, plus aucun composant n'appelle `offerAccent`/`OFFER_TINTS`. Vérifier avant de supprimer :

- [ ] **Step 1: Confirmer qu'il ne reste aucun appelant**

Run: `cd frontend && grep -rn "offerAccent\|OFFER_TINTS" --include="*.ts" --include="*.tsx" app components lib`
Expected: seule sortie = les 2 lignes du fichier `lib/adminOffers.ts` lui-même (la définition) — aucune autre occurrence dans `app/`/`components/`.

- [ ] **Step 2: Retirer `OFFER_TINTS`/`offerAccent` de `adminOffers.ts`**

Remplacer :

```ts
import { ACCENTS } from '@/lib/theme';
import type { PackageKind, SubscriberRow } from '@/lib/api';

/** Teintes cyclées des cartes (miroir de OffersShowcase, même ordre). */
export const OFFER_TINTS = [ACCENTS.blue, ACCENTS.apricot, ACCENTS.emerald, ACCENTS.violet, ACCENTS.cyan];
export const offerAccent = (index: number): string => OFFER_TINTS[((index % OFFER_TINTS.length) + OFFER_TINTS.length) % OFFER_TINTS.length];

/** Type d'offre pour la couleur : un abonnement, un carnet (entrées) ou un porte-monnaie. */
export type OfferTintKind = 'SUBSCRIPTION' | PackageKind;

/** Couleur d'une offre déterminée par son TYPE (pas sa position) : deux offres du même type partagent toujours la même teinte. */
export const offerTint = (kind: OfferTintKind): string =>
  kind === 'SUBSCRIPTION' ? ACCENTS.blue : kind === 'ENTRIES' ? ACCENTS.apricot : ACCENTS.emerald;
```

par :

```ts
import { ACCENTS } from '@/lib/theme';
import type { PackageKind, SubscriberRow } from '@/lib/api';

/** Type d'offre pour la couleur : un abonnement, un carnet (entrées) ou un porte-monnaie. */
export type OfferTintKind = 'SUBSCRIPTION' | PackageKind;

/** Couleur d'une offre déterminée par son TYPE (pas sa position) : deux offres du même type partagent toujours la même teinte. */
export const offerTint = (kind: OfferTintKind): string =>
  kind === 'SUBSCRIPTION' ? ACCENTS.blue : kind === 'ENTRIES' ? ACCENTS.apricot : ACCENTS.emerald;
```

- [ ] **Step 3: Retirer le bloc de test `offerAccent` devenu orphelin**

Remplacer :

```ts
import {
  OFFER_TINTS, offerAccent, offerTint, planPulse, packagePulse, planRevenueCents, splitByActive,
} from '../lib/adminOffers';
import { ACCENTS } from '../lib/theme';
import type { PackageTemplate, SubscriberRow } from '../lib/api';

describe('offerAccent', () => {
  it('cycle sur la palette', () => {
    expect(offerAccent(0)).toBe(OFFER_TINTS[0]);
    expect(offerAccent(OFFER_TINTS.length)).toBe(OFFER_TINTS[0]);
    expect(offerAccent(OFFER_TINTS.length + 2)).toBe(OFFER_TINTS[2]);
  });
});

describe('offerTint', () => {
```

par :

```ts
import {
  offerTint, planPulse, packagePulse, planRevenueCents, splitByActive,
} from '../lib/adminOffers';
import { ACCENTS } from '../lib/theme';
import type { PackageTemplate, SubscriberRow } from '../lib/api';

describe('offerTint', () => {
```

- [ ] **Step 4: Lancer toute la suite touchée**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/adminOffers.test.ts __tests__/AdminPackages.test.tsx __tests__/OffersShowcase.test.tsx`
Expected: PASS — `Test Suites: 3 passed, 3 total` / `Tests: 30 passed, 30 total` (baseline 28 + 3 tests `offerTint` ajoutés en Task 1 − 1 test `offerAccent` retiré ici = 30 ; `adminOffers.test.ts` seul passe de 12 à 11).

- [ ] **Step 5: Vérifier la compilation TypeScript des 2 fichiers touchés**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "lib/adminOffers\.ts|__tests__/adminOffers\.test\.ts"`
Expected: aucune sortie.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/adminOffers.ts frontend/__tests__/adminOffers.test.ts
git commit -m "refactor(offers): retire le code mort offerAccent/OFFER_TINTS"
```

---

### Task 8: Vérification visuelle (companion CDP) — clair + sombre, desktop + mobile

**Aucun fichier modifié dans cette tâche** — vérification uniquement, via le skill `verify` du projet (screenshots Chrome headless + CDP, session authentifiée).

- [ ] **Step 1: Invoquer le skill `verify` sur les 3 surfaces**

Utiliser le skill `verify` (via `Skill` tool, `skill: "verify"`) pour capturer, en thème clair **et** sombre, en desktop (1280px) **et** mobile (390px) :
1. `/admin/packages` (les 2 grilles : Abonnements, Carnets & Porte-monnaie — vérifier que chaque type d'offre a bien sa couleur constante et qu'il n'y a plus de dégradé en tête de carte).
2. Le Club-house du club (section « Abonnements & offres ») — même vérification, langage identique à la page admin.
3. Le studio de création (`/admin/packages` → « ＋ Créer une offre »), en essayant les 3 chips ⚡/🎟/💰 pour confirmer que l'aperçu « Ce que verront vos joueurs » change bien de couleur selon le type choisi.

Expected: sur les 3 surfaces, plus aucun lavis dégradé visible ; Abonnement toujours bleu, Carnet toujours abricot, Porte-monnaie toujours émeraude ; lisible en clair et en sombre ; aucun débordement horizontal en mobile 390px.

- [ ] **Step 2: Si un écart est trouvé**

Revenir à la Task concernée (fichier + ligne indiqués dans ce plan), corriger, relancer la suite de régression associée, commit correctif dédié (`fix(offers): ...`), puis reprendre la vérification visuelle sur la surface corrigée uniquement.

---

## Self-review (fait par l'auteur du plan)

- **Couverture de la spec :** helper `offerTint` (Task 1) ✓, dégradé retiré sur les 3 surfaces — `OfferCard` (Task 2), `OfferPreviewCard` (Task 4), `OffersShowcase` (Task 6) ✓, couleur par type sur les 3 surfaces — page admin (Task 3), studio (Task 5), Club-house (Task 6) ✓, aucune migration/backend touché ✓.
- **Aucun placeholder :** chaque step contient le code exact à écrire, aucun « TODO »/« similaire à la tâche N » sans le code répété en entier.
- **Cohérence des types :** `OfferTintKind = 'SUBSCRIPTION' | PackageKind` défini une seule fois (Task 1), consommé identiquement dans les 3 surfaces (`'SUBSCRIPTION'` pour les abonnements, `t.kind`/`kind` pour carnets et porte-monnaie) — pas de désaccord de nommage entre tâches.
- **Ordre des commits :** vérifié qu'aucun commit intermédiaire ne casse la compilation — `offerAccent`/`OFFER_TINTS` ne sont retirés (Task 7) qu'après que tous les appelants (Tasks 3, 5, 6) ont basculé sur `offerTint`.
