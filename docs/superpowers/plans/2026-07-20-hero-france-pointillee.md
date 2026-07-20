# « Trouvez où jouer. » — hero France en pointillés + Découvrir compact — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser le geste signature « La France en pointillés » + barre de recherche flottante sur le hero de la vitrine anonyme palova.fr, et transformer `/decouvrir` en établi compact (mini-hero brume + même barre contrôlée + sections éditoriales), en retirant l'habillage « Carte en filigrane » v1 raté.

**Architecture:** Deux composants partagés purs (`FranceDotsMap` = trame de points masquée par la silhouette France + épingles animées ; `LocationSearchPill` = pilule blanche flottante à encres fixes) consommés par `AnonymousView` (hero, navigation vers `/decouvrir?q=`/`?pres=1`) et `app/decouvrir/page.tsx` (contrôlée, filtrage live existant + lecture des deep-links). Classes/keyframes dans `globals.css` (media queries impossibles en styles inline). Spec : `docs/superpowers/specs/2026-07-20-hero-france-pointillee-design.md`.

**Tech Stack:** Next.js (App Router), React, TypeScript, Jest + RTL, thème maison (`HERO_GRADIENT`/`HERO_INK`/`HERO_INK_MUTED` depuis `@/components/agenda/AgendaHero`, `ACCENTS` depuis `@/lib/theme`).

**Contraintes dures :** cartes parties/tournois/clubs et composants de section (`NationalOpenMatches`, `UpcomingTournaments`, `ClubDirectory`, `TournamentFinder`, `DiscoverMatches`) **inchangés** ; racine palova.fr connectée (`PlayerView`/`ManagerView`) **intouchée** ; sections vitrine (« Comment ça marche », `ClubPitch`, rails) **intactes** ; placeholder « Ville, code postal ou département » **conservé à l'identique** (contrat de tests).

**⚠️ Git (session parallèle possible) :** ne jamais `git add -A`/`git add .` — stager uniquement les chemins listés. Pas de stash, pas de changement de branche (`feat/dupliquer-tournoi-event`).

**Exécution des tests (poste d'Eric) :** shims `.bin` cassés → depuis `frontend/` : `node node_modules/jest/bin/jest.js --runTestsByPath <fichiers>` et `node node_modules/typescript/bin/tsc --noEmit`. Jest traite un chemin nu comme un motif → toujours `--runTestsByPath`.

---

## Structure des fichiers

- **Créer** `frontend/components/platform/FranceDotsMap.tsx` — la France en pointillés (pur, décoratif).
- **Créer** `frontend/components/discover/LocationSearchPill.tsx` — barre de recherche flottante partagée (pur, contrôlé).
- **Créer** `frontend/__tests__/FranceDotsMap.test.tsx`, `frontend/__tests__/LocationSearchPill.test.tsx`.
- **Modifier** `frontend/app/globals.css` — keyframe `pl-pinpop` + classes `pl-france-hero`/`pl-hero-copy` (media query mobile).
- **Modifier** `frontend/components/platform/AnonymousView.tsx` — hero (titre, France, barre, retrait filigrane/orbe/CTAs).
- **Modifier** `frontend/app/decouvrir/page.tsx` — mini-hero compact, barre partagée, `?q=`/`?pres=1`, sections éditoriales, retrait fond v1.
- **Modifier** `frontend/components/discover/DiscoverAnchors.tsx` — rangée centrée (largeur capée).
- **Modifier** `frontend/__tests__/AnonymousView.test.tsx`, `frontend/__tests__/DiscoverPage.test.tsx`.
- **Supprimer** `frontend/components/discover/DiscoverMapBackground.tsx`, `frontend/__tests__/DiscoverMapBackground.test.tsx`.

---

## Task 1: `FranceDotsMap` + classes CSS globales

**Files:**
- Create: `frontend/components/platform/FranceDotsMap.tsx`
- Modify: `frontend/app/globals.css` (append à la fin)
- Test: `frontend/__tests__/FranceDotsMap.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/FranceDotsMap.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { FranceDotsMap } from '@/components/platform/FranceDotsMap';

describe('FranceDotsMap', () => {
  it('rend une couche décorative aria-hidden et non interactive', () => {
    render(<FranceDotsMap />);
    const layer = screen.getByTestId('france-dots');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).toHaveStyle({ pointerEvents: 'none' });
  });

  it('pins="full" (défaut) allume 6 clubs, "few" en allume 3, "none" aucun', () => {
    const { unmount } = render(<FranceDotsMap />);
    expect(screen.getAllByTestId('france-pin')).toHaveLength(6);
    unmount();
    const r2 = render(<FranceDotsMap pins="few" />);
    expect(screen.getAllByTestId('france-pin')).toHaveLength(3);
    r2.unmount();
    render(<FranceDotsMap pins="none" />);
    expect(screen.queryAllByTestId('france-pin')).toHaveLength(0);
  });

  it('le style du parent est fusionné (taille/position posées par le consommateur)', () => {
    render(<FranceDotsMap style={{ opacity: 0.5 }} />);
    expect(screen.getByTestId('france-dots')).toHaveStyle({ opacity: 0.5 });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Depuis `frontend/` : `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FranceDotsMap.test.tsx`
Expected: FAIL — « Cannot find module '@/components/platform/FranceDotsMap' ».

- [ ] **Step 3: Écrire le composant**

Créer `frontend/components/platform/FranceDotsMap.tsx` :

```tsx
'use client';
import type { CSSProperties } from 'react';
import { ACCENTS } from '@/lib/theme';

// « La France en pointillés » — geste signature du « Palova de tous les clubs » : une trame de
// points d'encre masquée par la silhouette de l'hexagone (Corse comprise), où quelques points
// « clubs » s'allument aux couleurs de la palette. Vit sur les heros brume bleue (encres fixes,
// identique clair/sombre). Purement décoratif : aria-hidden + pointer-events:none. La taille et
// la position sont posées par le parent via la classe .pl-france-hero (globals.css — la boîte
// reste CARRÉE, ratio de la viewBox 100×100, pour que le masque `contain` la remplisse et que
// les épingles en % tombent sur la forme) + le prop `style` (surcharges locales).

// Silhouette France (path 100×100, hexagone + Corse) encodée en data-URI pour le masque CSS.
const FRANCE_PATH =
  'M58,3 L66,7 L74,9 L83,15 L90,22 L86,30 L91,40 L87,47 L92,55 L86,63 L88,69 L78,71 L68,74 ' +
  'L60,72 L54,77 L47,81 L36,82 L25,79 L21,75 L24,66 L21,58 L26,52 L17,46 L9,43 L2,36 L8,30 ' +
  'L17,31 L24,28 L23,20 L28,19 L30,26 L38,23 L46,15 L52,8 Z M92,74 L95,78 L93,87 L89,84 L90,77 Z';
const FRANCE_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path d='${FRANCE_PATH}'/></svg>`,
)}")`;

// Encre de la trame : bleu nuit sur brume (constante locale — pas un token de thème, la brume a
// ses encres fixes). Halo des épingles assorti au dégradé.
const DOT_INK = 'rgba(27,42,63,0.38)';
const PIN_RING = '#e9f0f9';

// 6 villes allumées (coordonnées du path, %) — « few » garde Paris/Lyon/Marseille.
const PINS: { color: string; left: string; top: string; few?: boolean }[] = [
  { color: ACCENTS.cyan, left: '57%', top: '11%' },                 // Lille
  { color: ACCENTS.blue, left: '52%', top: '24%', few: true },      // Paris
  { color: ACCENTS.apricot, left: '25%', top: '44%' },              // Nantes
  { color: ACCENTS.emerald, left: '70%', top: '50%', few: true },   // Lyon
  { color: ACCENTS.violet, left: '33%', top: '61%' },               // Bordeaux
  { color: ACCENTS.coral, left: '68%', top: '69%', few: true },     // Marseille
];

export function FranceDotsMap({ pins = 'full', style }: { pins?: 'full' | 'few' | 'none'; style?: CSSProperties }) {
  const shown = pins === 'none' ? [] : pins === 'few' ? PINS.filter((p) => p.few) : PINS;
  return (
    <div className="pl-france-hero" data-testid="france-dots" aria-hidden="true" style={{ pointerEvents: 'none', ...style }}>
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage: `radial-gradient(circle, ${DOT_INK} 1.35px, transparent 1.7px)`,
          backgroundSize: '8px 8px',
          WebkitMaskImage: FRANCE_MASK, WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', WebkitMaskSize: 'contain',
          maskImage: FRANCE_MASK, maskRepeat: 'no-repeat', maskPosition: 'center', maskSize: 'contain',
        }}
      />
      {shown.map((p, i) => (
        <span
          key={p.left + p.top}
          data-testid="france-pin"
          className="pl-pinpop"
          style={{
            position: 'absolute', left: p.left, top: p.top, width: 10, height: 10, borderRadius: '50%',
            background: p.color,
            boxShadow: `0 0 0 3px ${PIN_RING}, 0 0 16px ${p.color}99`,
            animationDelay: `${0.15 * (i + 1)}s`,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Ajouter les classes globales**

Dans `frontend/app/globals.css`, **à la fin du fichier**, ajouter :

```css
/* ── France en pointillés (FranceDotsMap) — heros brume de la vitrine et de /decouvrir ── */
@keyframes pl-pinpop { from { transform: translate(-50%, -50%) scale(0); } to { transform: translate(-50%, -50%) scale(1); } }
.pl-pinpop { transform: translate(-50%, -50%) scale(0); animation: pl-pinpop .5s cubic-bezier(.2, 1.4, .4, 1) forwards; }
.pl-france-hero { position: absolute; right: 26px; top: 50%; transform: translateY(-50%); height: 92%; aspect-ratio: 1 / 1; }
.pl-hero-copy { position: relative; max-width: 56%; }
@media (max-width: 700px) {
  .pl-france-hero { right: -30px; opacity: .5; }
  .pl-hero-copy { max-width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .pl-pinpop { animation: none; transform: translate(-50%, -50%) scale(1); }
}
```

- [ ] **Step 5: Vérifier que le test passe**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FranceDotsMap.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

Depuis la racine du dépôt :
```bash
git add frontend/components/platform/FranceDotsMap.tsx frontend/__tests__/FranceDotsMap.test.tsx frontend/app/globals.css
git commit -m "feat(platform): FranceDotsMap — la France en pointillés, geste signature multi-clubs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `LocationSearchPill` (barre de recherche flottante partagée)

**Files:**
- Create: `frontend/components/discover/LocationSearchPill.tsx`
- Test: `frontend/__tests__/LocationSearchPill.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/LocationSearchPill.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { LocationSearchPill } from '@/components/discover/LocationSearchPill';

const noop = () => {};
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('LocationSearchPill', () => {
  it('saisie → onChange, Entrée → onSubmit', () => {
    const onChange = jest.fn();
    const onSubmit = jest.fn();
    wrap(<LocationSearchPill value="" onChange={onChange} onSubmit={onSubmit} onNearMe={noop} nearActive={false} locating={false} />);
    const input = screen.getByPlaceholderText('Ville, code postal ou département');
    fireEvent.change(input, { target: { value: 'Lyon' } });
    expect(onChange).toHaveBeenCalledWith('Lyon');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Entrée sans onSubmit ne plante pas (mode contrôlé /decouvrir)', () => {
    wrap(<LocationSearchPill value="Lyon" onChange={noop} onNearMe={noop} nearActive={false} locating={false} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Ville, code postal ou département'), { key: 'Enter' });
  });

  it('« Autour de moi » → onNearMe, libellés selon l\'état', () => {
    const onNearMe = jest.fn();
    const { unmount } = wrap(<LocationSearchPill value="" onChange={noop} onNearMe={onNearMe} nearActive={false} locating={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Autour de moi/ }));
    expect(onNearMe).toHaveBeenCalledTimes(1);
    unmount();
    const r2 = wrap(<LocationSearchPill value="" onChange={noop} onNearMe={noop} nearActive={false} locating={true} />);
    expect(screen.getByRole('button', { name: /Localisation…/ })).toBeInTheDocument();
    r2.unmount();
    wrap(<LocationSearchPill value="" onChange={noop} onNearMe={noop} nearActive={true} locating={false} />);
    expect(screen.getByRole('button', { name: /Autour de moi ✓/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/LocationSearchPill.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire le composant**

Créer `frontend/components/discover/LocationSearchPill.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';

// Barre de recherche flottante des heros brume (vitrine + /decouvrir) : pilule BLANCHE à encres
// fixes (elle vit sur la brume — identique clair/sombre), épingle accent, bouton « Autour de
// moi » en encre. Posée à cheval sur le bord bas du hero (margin-top négatif). Contrôlée par le
// parent : la vitrine navigue au submit, /decouvrir filtre en direct (onSubmit omis).
const PILL_INK = '#1b2a3f';

export function LocationSearchPill({ value, onChange, onSubmit, onNearMe, nearActive, locating }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  onNearMe: () => void;
  nearActive: boolean;
  locating: boolean;
}) {
  const { th } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '-29px 20px 0', position: 'relative', zIndex: 3 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: 'min(640px, 100%)', height: 58,
          background: '#ffffff', borderRadius: 999, padding: '8px 8px 8px 18px',
          boxShadow: `0 2px 6px rgba(27,42,63,.08), 0 18px 44px rgba(27,42,63,.22)${focused ? `, 0 0 0 3px ${ACCENTS.blue}55` : ''}`,
        }}
      >
        <svg aria-hidden="true" width="18" height="22" viewBox="0 0 16 22" style={{ flexShrink: 0 }}>
          <path fill={ACCENTS.blue} d="M8 0C3.6 0 0 3.6 0 8c0 5.2 8 14 8 14s8-8.8 8-14c0-4.4-3.6-8-8-8z" />
          <circle fill="#fff" cx="8" cy="8" r="3" />
        </svg>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit?.(); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Ville, code postal ou département"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: th.fontUI, fontSize: 15, color: PILL_INK }}
        />
        <button
          onClick={onNearMe}
          style={{ flexShrink: 0, border: 'none', cursor: 'pointer', height: 42, borderRadius: 999,
            background: PILL_INK, color: '#f4f6fa', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
            padding: '0 18px', whiteSpace: 'nowrap' }}
        >
          {locating ? 'Localisation…' : nearActive ? 'Autour de moi ✓' : 'Autour de moi'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Vérifier que le test passe**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/LocationSearchPill.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/discover/LocationSearchPill.tsx frontend/__tests__/LocationSearchPill.test.tsx
git commit -m "feat(discover): LocationSearchPill — barre de recherche flottante des heros brume

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Hero de la vitrine anonyme (« Trouvez où jouer. »)

**Files:**
- Modify: `frontend/components/platform/AnonymousView.tsx`
- Test: `frontend/__tests__/AnonymousView.test.tsx`

- [ ] **Step 1: Mettre à jour le test (il échoue d'abord)**

Dans `frontend/__tests__/AnonymousView.test.tsx` :

1a. Après le bloc `jest.mock('@/lib/api', …)` (ligne ~18), ajouter le mock de navigation :

```tsx
const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...a: unknown[]) => pushMock(...a), replace: jest.fn(), back: jest.fn() }),
}));
```

1b. Dans le `beforeEach`, ajouter `pushMock.mockReset();` après les deux `mockReset()` existants.

1c. Test 1 : remplacer `expect(screen.getByText(/Le padel se joue ici/i)).toBeInTheDocument();` par :

```tsx
    expect(screen.getByText(/Trouvez où jouer/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ville, code postal ou département')).toBeInTheDocument();
```

1d. Dernier test (« avec parties + tournois… ») : **supprimer** la ligne
`expect(screen.getByRole('link', { name: /Voir les parties/i })).toHaveAttribute('href', '#parties');`
(le CTA n'existe plus — le pouls, déjà assérté au-dessus, garde l'ancre) et retirer « CTA « Voir les parties » » du titre du test.

1e. Ajouter un nouveau test en fin de `describe` :

```tsx
  it('la recherche du hero navigue vers /decouvrir (q= saisi, pres=1 en géoloc)', async () => {
    wrap();
    const input = screen.getByPlaceholderText('Ville, code postal ou département');
    fireEvent.change(input, { target: { value: ' Lyon ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(pushMock).toHaveBeenCalledWith('/decouvrir?q=Lyon');
    fireEvent.click(screen.getByRole('button', { name: /Autour de moi/ }));
    expect(pushMock).toHaveBeenCalledWith('/decouvrir?pres=1');
    await waitFor(() => expect(mockMatches).toHaveBeenCalled());
  });
```

1f. Compléter l'import RTL en tête : `import { render, screen, waitFor, fireEvent } from '@testing-library/react';`

- [ ] **Step 2: Vérifier l'échec**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AnonymousView.test.tsx`
Expected: FAIL — « Trouvez où jouer » introuvable, placeholder absent.

- [ ] **Step 3: Modifier le hero d'`AnonymousView.tsx`**

3a. Imports — ajouter :

```tsx
import { useRouter } from 'next/navigation';
import { FranceDotsMap } from '@/components/platform/FranceDotsMap';
import { LocationSearchPill } from '@/components/discover/LocationSearchPill';
```

3b. En tête du composant (après `const [tournaments, …]`), ajouter :

```tsx
  const router = useRouter();
  const [q, setQ] = useState('');
  const goSearch = () => router.push(q.trim() ? `/decouvrir?q=${encodeURIComponent(q.trim())}` : '/decouvrir');
```

3c. Dans le panneau hero (`<div className="sp-hero-rise" …>`) :
- **Supprimer** le `<svg viewBox="0 0 100 100" …>` du filigrane logo (lignes ~56-62) et le `<span>` orbe accent (lignes ~63-67), remplacés par :

```tsx
            <FranceDotsMap />
```

- Sur le `<div style={{ position: 'relative' }}>` qui enveloppe le texte, remplacer par `className="pl-hero-copy"` (retirer le style inline `position: relative` — la classe le porte) :

```tsx
            <div className="pl-hero-copy">
```

- Titre : remplacer `Le padel se joue ici.` par `Trouvez où jouer.`
- **Supprimer** entièrement la rangée des 2 CTAs (`<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 24 }}>` … `</div>` contenant « Trouver mon club → » et « Voir les parties »).
- Le bloc pouls (chips « N parties à rejoindre… ») reste tel quel.
- Padding du panneau : `padding: '36px 26px 30px'` → `padding: '36px 26px 58px'` (place pour la barre à cheval).

3d. Juste **après** la fermeture du panneau hero (après le `</div>` du `sp-hero-rise`, toujours dans le conteneur `padding: '18px 20px 0'` — la barre chevauche le bord bas), ajouter :

```tsx
          <LocationSearchPill value={q} onChange={setQ} onSubmit={goSearch}
            onNearMe={() => router.push('/decouvrir?pres=1')} nearActive={false} locating={false} />
```

- [ ] **Step 4: Vérifier que la suite passe**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AnonymousView.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/platform/AnonymousView.tsx frontend/__tests__/AnonymousView.test.tsx
git commit -m "feat(vitrine): hero 'Trouvez ou jouer' — France en pointillés + recherche flottante vers /decouvrir

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `/decouvrir` compact (mini-hero, barre partagée, deep-links, sections éditoriales, retrait v1)

**Files:**
- Modify: `frontend/app/decouvrir/page.tsx`
- Modify: `frontend/components/discover/DiscoverAnchors.tsx`
- Delete: `frontend/components/discover/DiscoverMapBackground.tsx`, `frontend/__tests__/DiscoverMapBackground.test.tsx`
- Test: `frontend/__tests__/DiscoverPage.test.tsx`

- [ ] **Step 1: Mettre à jour le test de page (il échoue d'abord)**

Dans `frontend/__tests__/DiscoverPage.test.tsx` :

1a. Test 1 (« rend les 3 sections… ») : **supprimer** les deux lignes ajoutées par la v1 :
`expect(screen.getByTestId('discover-map')).toBeInTheDocument();` et
`expect(screen.getByText('Un club, une partie, un tournoi — partout autour de vous.')).toBeInTheDocument();`

1b. Test « hôte club : redirige… » : **supprimer** `expect(screen.queryByTestId('discover-map')).not.toBeInTheDocument();` (le `container` vide couvre déjà tout).

1c. Ajouter en fin de `describe` deux tests deep-links :

```tsx
  it('?q= préremplit la localisation et filtre dès l\'arrivée', async () => {
    window.history.replaceState(null, '', '/decouvrir?q=Lyon');
    wrap();
    await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
    expect(screen.getByPlaceholderText('Ville, code postal ou département')).toHaveValue('Lyon');
    await waitFor(() => expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument());
    expect(screen.getByText('Padel Lyon')).toBeInTheDocument();
  });

  it('?pres=1 déclenche la géolocalisation à l\'arrivée', async () => {
    const getCurrentPosition = jest.fn();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    window.history.replaceState(null, '', '/decouvrir?pres=1');
    wrap();
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled());
  });
```

- [ ] **Step 2: Vérifier l'échec**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPage.test.tsx`
Expected: FAIL — les 2 nouveaux tests échouent (pas de préremplissage `?q=`, pas de géoloc auto) ; les tests 1a/1b passent déjà (assertions retirées).

- [ ] **Step 3: Réécrire le chrome de `app/decouvrir/page.tsx`**

3a. Imports — **retirer** `import { DiscoverMapBackground } from '@/components/discover/DiscoverMapBackground';` et **ajouter** :

```tsx
import { HERO_GRADIENT, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { FranceDotsMap } from '@/components/platform/FranceDotsMap';
import { LocationSearchPill } from '@/components/discover/LocationSearchPill';
```

3b. Deep-links — après l'effet des fetchs (`api.listNationalOpenMatches…`), ajouter :

```tsx
  // Deep-links posés par le hero de la vitrine : ?q= préremplit la recherche, ?pres=1 lance la
  // géoloc à l'arrivée. Lus une fois au montage (même idiome que le hash plus bas).
  useEffect(() => {
    if (slug) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) setLocInput(q);
    if (params.get('pres') === '1') locateMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
```

3c. Rendu — remplacer tout le bloc entre `<Screen>` et `<DiscoverAnchors` (couche v1, wrapper zIndex, en-tête, sous-titre, barre de localisation v1) par :

```tsx
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '28px 20px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Logotype size={22} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <MyBookingsButton />
              <ThemeToggle />
              <ProfileMenu />
            </div>
          </div>
        </div>

        {/* Mini-hero brume : l'établi ne re-séduit pas (pas de titre-promesse — le hero complet
            vit sur la vitrine anonyme) ; petite France en filigrane pour la continuité. */}
        <div style={{ padding: '10px 18px 0' }}>
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, background: HERO_GRADIENT, padding: '26px 24px 46px' }}>
            <FranceDotsMap pins="few" style={{ height: '150%', right: -20, opacity: 0.55 }} />
            <div style={{ position: 'relative', fontFamily: th.fontBrand, fontSize: 15, letterSpacing: 3, textTransform: 'uppercase', color: HERO_INK_MUTED }}>
              Découvrir
            </div>
          </div>
          <LocationSearchPill value={locInput} onChange={setLocInput} onNearMe={locateMe}
            nearActive={!!coords} locating={geoState === 'locating'} />
          {geoState === 'denied' && (
            <div style={{ textAlign: 'center', marginTop: 8, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
              Localisation indisponible — cherchez par ville ou département.
            </div>
          )}
        </div>
```

puis laisser `<DiscoverAnchors …>` et les 3 `<section>` comme aujourd'hui (le `</div></Screen>` final ne change pas). **Supprimer** au passage la fonction `locateBtnStyle` en bas de fichier (plus utilisée) et la constante `sectionTitle` (remplacée à l'étape 3d).

3d. Sections éditoriales — dans le composant, remplacer la constante `sectionTitle` par un petit helper local (avant le `return`) :

```tsx
  const kickStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: th.textMute };
  const tick = <span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 2, background: th.accent }} />;
  const titleStyle: React.CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, color: th.text, letterSpacing: -0.5, margin: '7px 0 0', scrollMarginTop: 72 };
```

et remplacer les trois `<h2 style={sectionTitle}>…</h2>` :

- Parties : `<div style={kickStyle}>{tick}Parties ouvertes</div><h2 style={titleStyle}>Ça joue bientôt</h2>`
- Tournois : `<div style={kickStyle}>{tick}Compétition</div><h2 style={titleStyle}>Tournois</h2>`
- Clubs : `<div style={kickStyle}>{tick}Annuaire</div><h2 style={titleStyle}>Clubs</h2>`

3e. `DiscoverAnchors.tsx` — centrer la rangée (largeur capée) : sur le `div` intérieur (`display:flex, gap:4, background: th.surface2…`), ajouter `maxWidth: 430, margin: '0 auto'`.

3f. Supprimer les fichiers v1 :

```bash
git rm frontend/components/discover/DiscoverMapBackground.tsx frontend/__tests__/DiscoverMapBackground.test.tsx
```

- [ ] **Step 4: Vérifier que la suite passe**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPage.test.tsx`
Expected: PASS (10 tests : les 8 existants + 2 deep-links).

- [ ] **Step 5: Typage**

`node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "decouvrir\|AnonymousView\|FranceDotsMap\|LocationSearchPill\|DiscoverAnchors"`
Expected: aucune ligne.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/decouvrir/page.tsx frontend/components/discover/DiscoverAnchors.tsx frontend/__tests__/DiscoverPage.test.tsx
git commit -m "feat(decouvrir): etabli compact — mini-hero brume, barre partagee, deep-links ?q=/?pres=1, sections editoriales (retrait carte en filigrane v1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Le `git rm` de 3f a déjà stagé les suppressions — elles partent dans ce commit.)

---

## Task 5: Vérification visuelle + suite finale

**Files:** aucun changement attendu (ajustements mineurs seulement si un défaut apparaît).

- [ ] **Step 1: Stack dev vivante**

`curl http://localhost:3001/health` et `curl -o /dev/null -w "%{http_code}" http://localhost:3000/` → 200 ; sinon `start.ps1`.

- [ ] **Step 2: Vérif CDP (skill `verify`)**

Capturer **en anonyme** (pas de cookie token) `http://localhost:3000/` (vitrine) et **connecté** `http://localhost:3000/decouvrir`, en clair + sombre, 1280 + 390 (⚠️ mobile en `mobile:false` largeur fixe 390). Critères :
- Vitrine : France lisible (silhouette + 6 épingles SUR la forme), titre « Trouvez où jouer. », barre à cheval sur le hero, pouls présent, « Comment ça marche »/« Vous gérez un club » intacts, mobile = France en filigrane derrière le texte.
- `/decouvrir` : mini-hero compact, barre contrôlée, ancres centrées, sections éditoriales, cartes intactes, plus aucune trace du fond v1.
- Aucun débordement horizontal (scrollWidth ≤ clientWidth partout).
- Tester au passage `http://localhost:3000/decouvrir?q=Lyon` (champ prérempli).

- [ ] **Step 3: Suite ciblée finale + typage**

```
node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FranceDotsMap.test.tsx __tests__/LocationSearchPill.test.tsx __tests__/AnonymousView.test.tsx __tests__/DiscoverPage.test.tsx __tests__/DiscoverRedirects.test.tsx
node node_modules/typescript/bin/tsc --noEmit
```
Expected: tout vert (le `tsc` global peut porter des erreurs du WIP parallèle hors périmètre — ignorer ce qui ne concerne pas nos fichiers).

- [ ] **Step 4: Correctifs éventuels puis commit final si fichiers modifiés**

```bash
git add frontend/components/platform/FranceDotsMap.tsx frontend/components/discover/LocationSearchPill.tsx
git commit -m "fix(vitrine): ajustements visuels France/barre apres verification CDP

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review (vérifié à l'écriture)

- **Couverture spec :** geste signature → Task 1 ; barre partagée → Task 2 ; vitrine (titre/France/barre/CTAs retirés/pouls conservé/sections intactes) → Task 3 ; établi compact + deep-links + éditorial + retrait v1 → Task 4 ; connecté intouché → aucune tâche ne touche `PlayerView`/`ManagerView` ; a11y (aria-hidden, reduced-motion, focus visible) → Tasks 1-2 ; vérif CDP → Task 5. ✔
- **Placeholders :** aucun — code complet, commandes exactes. ✔
- **Cohérence :** `FranceDotsMap({ pins, style })` + testids `france-dots`/`france-pin` identiques Tasks 1/3/4 ; `LocationSearchPill({ value, onChange, onSubmit?, onNearMe, nearActive, locating })` identique Tasks 2/3/4 ; placeholder « Ville, code postal ou département » partout ; classes `pl-france-hero`/`pl-hero-copy`/`pl-pinpop` définies Task 1, consommées Tasks 1/3. ✔
