# Découvrir — habillage « Carte en filigrane » — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à la page `/decouvrir` un habillage « Carte en filigrane » (fond « plan » discret + barre de localisation en héros) pour signaler la vue « le Palova de tous les clubs », sans toucher aux cartes parties/tournois/clubs.

**Architecture:** Un nouveau composant décoratif `DiscoverMapBackground` (couche `position:absolute; inset:0` posée SOUS le contenu dans la colonne `position:relative` de `<Screen>`, `aria-hidden`, `pointer-events:none`), plus trois petites retouches de chrome dans `app/decouvrir/page.tsx` (montage de la couche, sous-titre reformulé, champ de localisation avec épingle + liseré d'accent). 100 % frontend, aucune migration, aucun backend, aucune route.

**Tech Stack:** Next.js (frontend Palova), React, TypeScript, Jest + React Testing Library, thème maison (`lib/theme.ts` / `lib/ThemeProvider.tsx`).

**Contrainte dure :** les composants de cartes (`NationalMatchCard`, `TournamentFinder`, `ClubDirectory`) et la logique de la page (fetch, filtres, ancres, scroll-spy, deep-links, redirection hôte-club) restent **strictement inchangés**.

**⚠️ Contexte git (session parallèle) :** une autre session édite le dépôt en parallèle (fichiers `backend/src/email/mailer.ts`, `frontend/components/ProfileMenu.tsx`, etc. modifiés hors périmètre). **Ne jamais `git add -A` / `git add .`** — chaque commit stage UNIQUEMENT les chemins explicitement listés. Ne pas `git stash`. Ne pas changer de branche. La spec a déjà été committée (`c3427c5`) sur la branche courante `feat/dupliquer-tournoi-event` ; ce plan sera aussi committé dessus, et l'implémentation aussi.

**Exécution des tests (spécificités de ce poste, cf. mémoires) :** les shims `node_modules/.bin` sont cassés → lancer Jest via `node node_modules/jest/bin/jest.js` et `tsc` via `node node_modules/typescript/bin/tsc`, **depuis le dossier `frontend/`**. Jest traite l'argument comme un motif (Windows insensible à la casse) → cibler un fichier précis avec `--runTestsByPath`. `ts-jest` ne type-check pas → passer `tsc --noEmit` séparément.

---

## Structure des fichiers

- **Créer** `frontend/components/discover/DiscoverMapBackground.tsx` — couche « plan » décorative, présentationnelle pure (lit `useTheme`, aucune donnée/interaction). Une seule responsabilité : peindre le fond identitaire de la page Découvrir.
- **Créer** `frontend/__tests__/DiscoverMapBackground.test.tsx` — tests unitaires du composant (aria-hidden, non interactif, bascule de palette clair/sombre).
- **Modifier** `frontend/app/decouvrir/page.tsx` — monter la couche sous le contenu, reformuler le sous-titre, habiller le champ de localisation (épingle + liseré accent).
- **Modifier** `frontend/__tests__/DiscoverPage.test.tsx` — présence de la couche sur l'hôte plateforme, absence sur l'hôte club, nouveau sous-titre.

---

## Task 1: Composant `DiscoverMapBackground`

**Files:**
- Create: `frontend/components/discover/DiscoverMapBackground.tsx`
- Test: `frontend/__tests__/DiscoverMapBackground.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/DiscoverMapBackground.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { DiscoverMapBackground } from '@/components/discover/DiscoverMapBackground';

// ThemeProvider lit localStorage après montage (peut écraser defaultMode) — on nettoie
// pour que `defaultMode` fasse foi dans chaque test.
beforeEach(() => localStorage.clear());

describe('DiscoverMapBackground', () => {
  it('rend une couche décorative aria-hidden et non interactive', () => {
    render(<ThemeProvider defaultMode="daylight"><DiscoverMapBackground /></ThemeProvider>);
    const layer = screen.getByTestId('discover-map');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).toHaveStyle({ pointerEvents: 'none' });
  });

  it('bascule la palette selon le thème (le point des épingles = le ton du fond)', () => {
    const { unmount } = render(<ThemeProvider defaultMode="daylight"><DiscoverMapBackground /></ThemeProvider>);
    expect(screen.getAllByTestId('discover-pin-dot')[0]).toHaveAttribute('fill', '#eef1f5');
    unmount();
    render(<ThemeProvider defaultMode="floodlit"><DiscoverMapBackground /></ThemeProvider>);
    expect(screen.getAllByTestId('discover-pin-dot')[0]).toHaveAttribute('fill', '#111110');
  });

  it('reflète le mode courant via data-mode', () => {
    render(<ThemeProvider defaultMode="floodlit"><DiscoverMapBackground /></ThemeProvider>);
    expect(screen.getByTestId('discover-map')).toHaveAttribute('data-mode', 'floodlit');
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Depuis `frontend/` :

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMapBackground.test.tsx`
Expected: FAIL — « Cannot find module '@/components/discover/DiscoverMapBackground' ».

- [ ] **Step 3: Écrire le composant**

Créer `frontend/components/discover/DiscoverMapBackground.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';

// Couche décorative « plan » de la page /decouvrir (« le Palova de tous les clubs ») : un fond
// discret de plan de ville (routes + rivière + pâtés) répété à échelle constante, ponctué de 3
// épingles aux couleurs de clubs. Signale la vue agrégée AU-DESSUS des clubs. Purement
// présentationnel : aucune donnée, aucune interaction. aria-hidden + pointer-events:none →
// invisible aux lecteurs d'écran et au pointeur ; posé SOUS le contenu (z-index 0). Les tons et
// alphas sont des constantes LOCALES (surface décorative propre à cette page — pas de nouveaux
// tokens de thème globaux).

interface PlanPalette {
  base: string;      // fond « plan »
  road: string;      // routes fines
  mainRoad: string;  // route principale teintée de l'accent Palova
  river: string;     // rivière pointillée
  block: string;     // pâtés estompés
  pinDot: string;    // point central des épingles (= couleur du fond → contraste net)
}

const LIGHT: PlanPalette = {
  base: '#eef1f5',
  road: 'rgba(24,21,14,0.06)',
  mainRoad: 'rgba(94,147,218,0.16)',
  river: 'rgba(70,230,208,0.20)',
  block: 'rgba(24,21,14,0.018)',
  pinDot: '#eef1f5',
};

const DARK: PlanPalette = {
  base: '#111110',
  road: 'rgba(255,255,255,0.05)',
  mainRoad: 'rgba(94,147,218,0.20)',
  river: 'rgba(70,230,208,0.16)',
  block: 'rgba(255,255,255,0.02)',
  pinDot: '#111110',
};

// 3 épingles aux couleurs de clubs (bleu / émeraude / violet), réparties dans la zone haute de
// la page — position en % de largeur pour s'étaler quelle que soit la largeur réelle.
const PINS: { color: string; pos: React.CSSProperties }[] = [
  { color: '#5e93da', pos: { left: '11%', top: 118 } },
  { color: '#34b27b', pos: { right: '16%', top: 82 } },
  { color: '#bda6ff', pos: { left: '38%', top: 360 } },
];

// Tuile SVG répétée : échelle CONSTANTE quelle que soit la largeur de page (contrairement à un
// SVG plein cadre en `slice` qui grossirait les traits ~3× sur desktop). Routes bord à bord →
// tuilage propre. La rivière et les pâtés introduisent une couture négligeable à faible alpha.
function tileUrl(p: PlanPalette): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='480' viewBox='0 0 360 480'>` +
    `<rect x='30' y='60' width='90' height='70' rx='6' fill='${p.block}'/>` +
    `<rect x='200' y='320' width='120' height='90' rx='6' fill='${p.block}'/>` +
    `<line x1='0' y1='96' x2='360' y2='96' stroke='${p.mainRoad}' stroke-width='7'/>` +
    `<line x1='0' y1='300' x2='360' y2='300' stroke='${p.road}' stroke-width='6'/>` +
    `<line x1='90' y1='0' x2='90' y2='480' stroke='${p.road}' stroke-width='6'/>` +
    `<line x1='270' y1='0' x2='270' y2='480' stroke='${p.road}' stroke-width='5'/>` +
    `<path d='M0,200 C80,170 130,260 200,225 S320,290 360,255' fill='none' stroke='${p.river}' stroke-width='7' stroke-dasharray='2 9' stroke-linecap='round'/>` +
    `<circle cx='90' cy='96' r='10' fill='none' stroke='${p.mainRoad}' stroke-width='5'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function DiscoverMapBackground() {
  const { th } = useTheme();
  const pal = th.mode === 'floodlit' ? DARK : LIGHT;
  return (
    <div
      data-testid="discover-map"
      data-mode={th.mode}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        background: pal.base,
        backgroundImage: tileUrl(pal),
        backgroundRepeat: 'repeat',
        backgroundSize: '360px 480px',
      }}
    >
      {PINS.map((p, i) => (
        <span key={i} style={{ position: 'absolute', opacity: 0.55, pointerEvents: 'none', ...p.pos }}>
          <svg width="16" height="24" viewBox="0 0 16 24">
            <path fill={p.color} d="M8 0C3.582 0 0 3.582 0 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.418-3.582-8-8-8z" />
            <circle data-testid="discover-pin-dot" fill={pal.pinDot} cx="8" cy="8" r="3" />
          </svg>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Depuis `frontend/` :

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMapBackground.test.tsx`
Expected: PASS (3 tests verts).

- [ ] **Step 5: Vérifier le typage**

Depuis `frontend/` :

Run: `node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "discover/DiscoverMapBackground\|DiscoverMapBackground.test"`
Expected: aucune ligne (nos fichiers ne produisent aucune erreur ; d'éventuelles erreurs hors périmètre dues au WIP parallèle sont ignorées par le grep).

- [ ] **Step 6: Commit**

Depuis la racine du dépôt :

```bash
git add frontend/components/discover/DiscoverMapBackground.tsx frontend/__tests__/DiscoverMapBackground.test.tsx
git commit -m "feat(decouvrir): couche de fond 'Carte en filigrane' (DiscoverMapBackground)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Câbler la couche + habiller le chrome de la page

**Files:**
- Modify: `frontend/app/decouvrir/page.tsx`
- Test: `frontend/__tests__/DiscoverPage.test.tsx`

- [ ] **Step 1: Ajouter les assertions au test de page (elles échouent)**

Dans `frontend/__tests__/DiscoverPage.test.tsx` :

1a. Dans le test `'rend les 3 sections simultanément (plus d\'onglets)'`, ajouter **après** la ligne `expect(await screen.findAllByRole('link', { name: /Rejoindre la partie/ })).toHaveLength(2);` :

```tsx
    expect(screen.getByTestId('discover-map')).toBeInTheDocument();
    expect(screen.getByText('Un club, une partie, un tournoi — partout autour de vous.')).toBeInTheDocument();
```

1b. Dans le test `'hôte club : redirige vers la plateforme (hash préservé), rien rendu'`, ajouter **après** `expect(container).toBeEmptyDOMElement();` :

```tsx
    expect(screen.queryByTestId('discover-map')).not.toBeInTheDocument();
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Depuis `frontend/` :

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPage.test.tsx`
Expected: FAIL — `discover-map` introuvable et l'ancien sous-titre encore présent.

- [ ] **Step 3: Importer le composant dans la page**

Dans `frontend/app/decouvrir/page.tsx`, **après** la ligne `import { ClubDirectory } from '@/components/ClubDirectory';` (ligne 15), ajouter :

```tsx
import { DiscoverMapBackground } from '@/components/discover/DiscoverMapBackground';
```

- [ ] **Step 4: Monter la couche sous le contenu**

Dans `frontend/app/decouvrir/page.tsx`, remplacer l'ouverture du rendu — le bloc actuel :

```tsx
  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '28px 20px 6px' }}>
```

par :

```tsx
  return (
    <Screen>
      <DiscoverMapBackground />
      <div style={{ position: 'relative', zIndex: 1, paddingBottom: 40 }}>
        <div style={{ padding: '28px 20px 6px' }}>
```

(La couche est le premier enfant de `<Screen>` — dont la colonne interne est `position:relative` — et le contenu passe au-dessus via `position:relative; zIndex:1`. Le reste du JSX, jusqu'au `</Screen>`, est inchangé.)

- [ ] **Step 5: Reformuler le sous-titre**

Dans `frontend/app/decouvrir/page.tsx`, remplacer :

```tsx
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, marginTop: 8 }}>
            Clubs, parties et tournois, partout sur Palova.
          </p>
```

par :

```tsx
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, marginTop: 8 }}>
            Un club, une partie, un tournoi — partout autour de vous.
          </p>
```

- [ ] **Step 6: Habiller le champ de localisation (épingle + liseré accent)**

Dans `frontend/app/decouvrir/page.tsx`, remplacer le bloc `<input>` de localisation — l'actuel :

```tsx
          <input
            value={locInput}
            onChange={(e) => setLocInput(e.target.value)}
            placeholder="Ville, code postal ou département"
            style={{ flex: '1 1 220px', minWidth: 0, height: 46, padding: '0 14px', borderRadius: 12,
              background: th.surface, color: th.text, border: 'none', boxShadow: `inset 0 0 0 1.5px ${th.line}`,
              fontFamily: th.fontUI, fontSize: 15 }}
          />
```

par (un conteneur relatif portant l'épingle, l'input passe au liseré d'accent et laisse la place à l'épingle — **le `placeholder` reste identique**, plusieurs tests s'appuient dessus) :

```tsx
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 15, pointerEvents: 'none' }}>📍</span>
            <input
              value={locInput}
              onChange={(e) => setLocInput(e.target.value)}
              placeholder="Ville, code postal ou département"
              style={{ width: '100%', height: 46, padding: '0 14px 0 38px', borderRadius: 12,
                background: th.surface, color: th.text, border: 'none', boxShadow: `inset 0 0 0 2px ${th.accent}`,
                fontFamily: th.fontUI, fontSize: 15 }}
            />
          </div>
```

- [ ] **Step 7: Lancer le test de page pour vérifier qu'il passe**

Depuis `frontend/` :

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPage.test.tsx`
Expected: PASS (les 8 tests verts, dont les nouvelles assertions).

- [ ] **Step 8: Vérifier le typage**

Depuis `frontend/` :

Run: `node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "app/decouvrir/page\|DiscoverPage.test"`
Expected: aucune ligne.

- [ ] **Step 9: Commit**

Depuis la racine du dépôt :

```bash
git add frontend/app/decouvrir/page.tsx frontend/__tests__/DiscoverPage.test.tsx
git commit -m "feat(decouvrir): habillage 'territoire' — fond plan, barre de localisation heros, sous-titre

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Vérification visuelle (clair + sombre, desktop + mobile)

**Files:** aucun changement de code attendu (sauf ajustement mineur si un défaut visuel apparaît).

- [ ] **Step 1: Démarrer/valider la stack dev**

S'assurer que le frontend tourne (`http://localhost:3000`) et le backend (`http://localhost:3001/health`). Sinon lancer `start.ps1` à la racine du dépôt (cf. CLAUDE.md).

- [ ] **Step 2: Vérifier visuellement `/decouvrir` avec le skill `verify`**

Invoquer le skill **`verify`** sur le chemin `/decouvrir` (hôte **plateforme** — `localhost:3000/decouvrir`, PAS un sous-domaine club) dans les 4 combinaisons :
- **Clair desktop 1280**, **Sombre desktop 1280**, **Clair mobile 390**, **Sombre mobile 390**.
- ⚠️ Pour le mobile, capturer en `mobile:false` + largeur fixe **390** (l'émulation `mobile:true` réajuste le viewport et **masque** un vrai débordement horizontal — piège connu, cf. mémoire `verify-mobile-overflow-emulation`).

Critères d'acceptation :
- Le fond « plan » est **discret** (routes/rivière/pâtés à peine visibles), les **3 épingles** lisibles, aux couleurs de clubs.
- La **barre de localisation** ressort (épingle + liseré bleu accent).
- Les **cartes** parties/tournois/clubs sont **intactes** (liseré couleur du club présent, aucune régression de lisibilité — elles sont opaques au-dessus du plan).
- En **sombre** : pas d'aplat noir dur, texture blanche très faible sur charbon.
- **Aucun débordement horizontal** (`scrollWidth <= clientWidth`) sur les 4 captures.

- [ ] **Step 3: Corriger si besoin, sinon conclure**

Si un critère échoue (texture trop forte/faible, épingle mal placée, débordement) : ajuster les constantes de palette / positions dans `DiscoverMapBackground.tsx` (ou l'`inset`/`overflow`), relancer `verify`. Puis, si un fichier a changé :

```bash
git add frontend/components/discover/DiscoverMapBackground.tsx
git commit -m "fix(decouvrir): ajustement visuel de la couche 'Carte en filigrane'

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Si rien n'a changé, aucune action — la vérification visuelle est un contrôle, pas une modification.

- [ ] **Step 4: Suite de tests ciblée finale**

Depuis `frontend/`, relancer les deux suites du périmètre pour confirmer le vert global :

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMapBackground.test.tsx __tests__/DiscoverPage.test.tsx`
Expected: PASS (11 tests : 3 + 8).

---

## Self-review (vérifié à l'écriture)

- **Couverture de la spec :** fond « plan » clair+sombre → Task 1 ; barre de localisation héros + sous-titre → Task 2 ; cartes inchangées → aucune tâche ne les touche (garanti) ; a11y (aria-hidden/pointer-events) → Task 1 test ; vérif visuelle clair/sombre/desktop/mobile + pas de débordement → Task 3. ✔
- **Placeholders :** aucun — code complet à chaque étape, commandes exactes, sorties attendues. ✔
- **Cohérence des types/noms :** `DiscoverMapBackground` (composant), `discover-map` / `discover-pin-dot` (testids), `data-mode`, palette `LIGHT`/`DARK`/`PlanPalette`, `tileUrl` — identiques entre Task 1 (définition/test) et Task 2 (usage/test). Placeholder du champ « Ville, code postal ou département » **conservé** (dépendance des tests existants). ✔
```
