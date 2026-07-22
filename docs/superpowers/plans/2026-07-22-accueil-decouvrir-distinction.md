# Distinction Mon Palova / /decouvrir — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La grande pilule de recherche blanche devient la signature exclusive de `/decouvrir` ; l'accueil connecté (Mon Palova) prend un hero « Prêt à jouer ? » + une porte encre compacte « Découvrir ».

**Architecture:** 100 % frontend, 3 fichiers de prod touchés (`HomeHero.tsx` textes, `DiscoverPill.tsx` réécrit en porte, `FranceDotsMap.tsx` export d'une icône). `/decouvrir`, la vitrine anonyme et `LocationSearchPill` ne bougent pas. Spec : `docs/superpowers/specs/2026-07-22-accueil-decouvrir-distinction-design.md`.

**Tech Stack:** Next.js 16 / React, jest + React Testing Library. Pas de migration, pas de backend.

---

## ⚠️ Consignes transverses (à lire avant toute tâche)

- **WIP parallèle non commité dans le repo** : ne JAMAIS `git add -A`, `git add .` ni `git commit -a`. Chaque commit ajoute **exactement** les fichiers listés dans la tâche. Ne JAMAIS utiliser `git stash`.
- **Avant chaque commit** : vérifier `git branch --show-current` → doit afficher `feat/seo-referencement`. Sinon, s'arrêter et le signaler.
- **Écrasement assumé** : `frontend/components/platform/home/DiscoverPill.tsx` (diff non commité de 6 lignes : `goNearMe` conserve la saisie) et `frontend/__tests__/DiscoverPill.test.tsx` (untracked) portent un WIP qui teste la recherche embarquée — la spec la supprime de l'accueil, ce WIP est **volontairement remplacé** par la porte. Aucun autre fichier WIP n'est touché.
- **Shims npm cassés sur cette machine** : `npx jest` échoue. Lancer jest via `node node_modules/jest/bin/jest.js` et tsc via `node node_modules/typescript/bin/tsc`, depuis `frontend/`.
- **Toujours `--runTestsByPath`** pour cibler un fichier (sinon Windows insensible à la casse attrape d'autres suites au même nom).
- `tsc --noEmit` sortira peut-être des erreurs venant du WIP parallèle : ne regarder que les fichiers touchés par ce plan (grep).

---

### Task 1: HomeHero — « Prêt à jouer ? » (textes seuls)

**Files:**
- Modify: `frontend/components/platform/home/HomeHero.tsx`
- Modify: `frontend/__tests__/HomeHero.test.tsx`
- Modify: `frontend/__tests__/MonPalova.test.tsx` (2 assertions de texte)

- [ ] **Step 1: Mettre à jour le test HomeHero (échouant)**

Remplacer intégralement le contenu de `frontend/__tests__/HomeHero.test.tsx` par :

```tsx
import { render, screen } from '@testing-library/react';
import { HomeHero } from '../components/platform/home/HomeHero';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('HomeHero', () => {
  it('salue par prénom et pose l\'en-tête tableau de bord (plus d\'accroche recherche)', () => {
    wrap(<HomeHero firstName="Eric" />);
    expect(screen.getByText(/Bonjour Eric/)).toBeInTheDocument();
    expect(screen.getByText(/Prêt à jouer/)).toBeInTheDocument();
    expect(screen.getByText(/Ton agenda, tes clubs et tes parties/)).toBeInTheDocument();
    // L'ancienne accroche recherche a déménagé dans la porte Découvrir.
    expect(screen.queryByText(/Où veux-tu jouer/)).toBeNull();
  });

  it('sans prénom → salutation générique', () => {
    wrap(<HomeHero firstName={null} />);
    expect(screen.getByText('Bonjour')).toBeInTheDocument();
    expect(screen.getByText(/Prêt à jouer/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Vérifier que le test échoue**

Run (depuis `frontend/`) : `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/HomeHero.test.tsx`
Expected: FAIL — « Prêt à jouer » introuvable (le composant affiche encore « Où veux-tu jouer ? »).

- [ ] **Step 3: Modifier HomeHero.tsx**

Dans `frontend/components/platform/home/HomeHero.tsx`, trois retouches :

(a) le commentaire d'en-tête du fichier (lignes 6-10) devient :

```tsx
// Hero « accueil » de Mon Palova — brume bleue (jamais de panneau sombre) : salutation +
// en-tête du tableau de bord. Il ne rejoue PLUS la prochaine réservation (elle vit dans
// « À venir ») et ne porte plus la promesse de recherche : celle-ci vit dans la porte
// Découvrir (DiscoverPill), rendue en frère JUSTE après ce hero (cf. MonPalova) et qui
// flotte sur son bord bas via sa marge négative propre — d'où le padding bas généreux.
```

(b) le titre :

```tsx
// AVANT
          Où veux-tu jouer&nbsp;?
// APRÈS
          Prêt à jouer&nbsp;?
```

(c) le sous-titre :

```tsx
// AVANT
          Un club, un créneau, une partie ouverte — près de chez toi.
// APRÈS
          Ton agenda, tes clubs et tes parties — d'un coup d'œil.
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/HomeHero.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Mettre à jour les 2 assertions de MonPalova.test.tsx**

Dans `frontend/__tests__/MonPalova.test.tsx`, deux occurrences à remplacer (lignes ~62 et ~69) :

```tsx
// AVANT (2 occurrences)
    expect(await screen.findByText(/Où veux-tu jouer/)).toBeInTheDocument();
// APRÈS
    expect(await screen.findByText(/Prêt à jouer/)).toBeInTheDocument();
```

Ne rien changer d'autre dans ce fichier (le mock de `DiscoverPill` reste valable).

- [ ] **Step 6: Vérifier la suite MonPalova**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MonPalova.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit (fichiers exacts, branche vérifiée)**

```bash
git branch --show-current   # doit afficher feat/seo-referencement
git add frontend/components/platform/home/HomeHero.tsx frontend/__tests__/HomeHero.test.tsx frontend/__tests__/MonPalova.test.tsx
git commit -m "feat(home): hero Pret a jouer (en-tete tableau de bord, l'accroche recherche part dans la porte)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Porte Découvrir (icône France + réécriture DiscoverPill)

**Files:**
- Modify: `frontend/components/platform/FranceDotsMap.tsx` (ajout d'un export, rien d'existant ne change)
- Rewrite: `frontend/components/platform/home/DiscoverPill.tsx` (⚠️ écrase un WIP non commité — assumé, cf. consignes)
- Rewrite: `frontend/__tests__/DiscoverPill.test.tsx` (untracked, idem)

- [ ] **Step 1: Réécrire le test DiscoverPill (échouant)**

Remplacer intégralement le contenu de `frontend/__tests__/DiscoverPill.test.tsx` par :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// Import après le mock (le composant lit useRouter au montage).
import { DiscoverPill } from '@/components/platform/home/DiscoverPill';

const wrap = () => render(<ThemeProvider><DiscoverPill /></ThemeProvider>);

describe('DiscoverPill (porte Découvrir)', () => {
  beforeEach(() => { push.mockClear(); });

  it('clic sur la porte → /decouvrir', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /Découvrir · clubs, parties, tournois/ }));
    expect(push).toHaveBeenCalledWith('/decouvrir');
  });

  it('plus de recherche embarquée : ni champ de saisie ni « Autour de moi » (la pilule blanche est la signature exclusive de /decouvrir)', () => {
    wrap();
    expect(screen.queryByPlaceholderText('Ville, code postal ou département')).toBeNull();
    expect(screen.queryByRole('button', { name: /Autour de moi/ })).toBeNull();
  });

  it('l\'icône France est décorative (aria-hidden)', () => {
    wrap();
    expect(screen.getByTestId('france-icon')).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPill.test.tsx`
Expected: FAIL — l'ancien composant rend la pilule de recherche (pas de bouton « Découvrir · … », pas de `france-icon`).

- [ ] **Step 3: Exporter l'icône France depuis FranceDotsMap.tsx**

Ajouter à la fin de `frontend/components/platform/FranceDotsMap.tsx` (aucune modification de l'existant, `FRANCE_MASK` est déjà défini dans ce fichier) :

```tsx
/** Icône compacte « France en pointillés » — trame claire pour les fonds encre (porte
 *  Découvrir de l'accueil). Purement décorative : aria-hidden, pas d'épingles. */
export function FranceDotsIcon({ size = 18, dotColor = 'rgba(244,246,250,0.95)' }: { size?: number; dotColor?: string }) {
  return (
    <span
      data-testid="france-icon"
      aria-hidden="true"
      style={{
        display: 'inline-block', width: size, height: size, flexShrink: 0,
        backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1.3px)`,
        backgroundSize: '3.5px 3.5px',
        WebkitMaskImage: FRANCE_MASK, WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', WebkitMaskSize: 'contain',
        maskImage: FRANCE_MASK, maskRepeat: 'no-repeat', maskPosition: 'center', maskSize: 'contain',
      }}
    />
  );
}
```

- [ ] **Step 4: Réécrire DiscoverPill.tsx**

Remplacer intégralement le contenu de `frontend/components/platform/home/DiscoverPill.tsx` par :

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { FranceDotsIcon } from '@/components/platform/FranceDotsMap';
import { PILL_INK } from '@/components/discover/LocationSearchPill';

// Porte vers /decouvrir — pastille encre compacte qui flotte sur le bord bas du hero (marge
// haute négative, même geste que la pilule blanche de /decouvrir, silhouette opposée). La
// grande pilule de recherche (LocationSearchPill) est la signature EXCLUSIVE de la page
// Découvrir : depuis l'accueil on ne tape rien, on passe la porte et on cherche là-bas.
export function DiscoverPill() {
  const router = useRouter();
  const { th } = useTheme();
  return (
    <div style={{ margin: '-20px 22px 0', position: 'relative', zIndex: 3 }}>
      <button
        type="button"
        className="pl-lift"
        onClick={() => router.push('/decouvrir')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 9, border: 'none', cursor: 'pointer',
          background: PILL_INK, color: '#f4f6fa', borderRadius: 999, height: 42, padding: '0 18px 0 15px',
          fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
          boxShadow: '0 12px 28px rgba(27,42,63,.35)',
        }}
      >
        <FranceDotsIcon />
        Découvrir · clubs, parties, tournois
        <span aria-hidden="true" style={{ opacity: 0.7, fontWeight: 400 }}>→</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Vérifier que le test passe**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPill.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Non-régression sur les consommateurs voisins**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MonPalova.test.tsx __tests__/AnonymousView.test.tsx __tests__/DiscoverPage.test.tsx`
Expected: PASS — `MonPalova` mocke `DiscoverPill`, la vitrine et `/decouvrir` n'utilisent pas la porte (l'export ajouté à `FranceDotsMap` est purement additif).

Puis le type-check (le WIP parallèle peut sortir des erreurs ailleurs — ne regarder que nos fichiers) :

```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "HomeHero|DiscoverPill|FranceDotsMap"
```
Expected: aucune ligne.

- [ ] **Step 7: Commit (fichiers exacts, branche vérifiée)**

```bash
git branch --show-current   # doit afficher feat/seo-referencement
git add frontend/components/platform/FranceDotsMap.tsx frontend/components/platform/home/DiscoverPill.tsx frontend/__tests__/DiscoverPill.test.tsx
git commit -m "feat(home): porte Decouvrir encre (la pilule blanche devient la signature exclusive de /decouvrir)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Vérification visuelle (CDP)

**Files:** aucun (vérification seule ; retouches éventuelles → mini-cycle test/commit sur les mêmes fichiers).

- [ ] **Step 1: Lancer la vérification visuelle**

Utiliser le skill `verify` (session authentifiée `test@palova.fr`) sur l'hôte plateforme :

- Page `/` (Mon Palova, connecté) : clair + sombre, desktop 1280 + mobile 390 (⚠️ `mobile:false` + largeur fixe 390, sinon l'émulation masque les débordements).
- Page `/decouvrir` : desktop 1280 clair (contrôle « inchangé au pixel » du hero + pilule).

- [ ] **Step 2: Points de contrôle**

- La porte encre flotte sur le bord bas du hero, lisible dans les 2 thèmes (encres fixes sur brume).
- Aucun débordement horizontal en 390 (la porte est `nowrap` : vérifier qu'elle tient, sinon réduire le libellé à « Découvrir · clubs, parties… » et re-passer les tests).
- Le hero affiche « Prêt à jouer ? » + le nouveau sous-titre ; plus aucun champ de saisie sur l'accueil.
- `/decouvrir` strictement identique (grande pilule blanche + France + ancres).

- [ ] **Step 3: Signaler le résultat à Eric** (captures à l'appui) avant toute suite (pas de push).

---

## Self-review (fait à la rédaction)

- Couverture spec : textes hero (Task 1), porte + icône + comportements supprimés (Task 2), `/decouvrir`/vitrine intouchés (aucune tâche ne les modifie), tests recensés (Tasks 1-2), vérif CDP (Task 3). ✓
- Aucun placeholder ; tout le code est inline. ✓
- Cohérence des types : `FranceDotsIcon` défini Task 2 Step 3 avant son import Step 4 ; `PILL_INK` déjà exporté par `LocationSearchPill.tsx` (ligne 10). ✓
