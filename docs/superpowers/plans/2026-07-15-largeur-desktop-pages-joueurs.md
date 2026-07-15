# Largeur desktop des pages joueurs (820 → 1080) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Porter la colonne des pages joueurs de 820 à 1080 px en desktop (source unique `Screen.tsx`), avec clamps internes sur les contenus qui doivent rester étroits, et aligner le calendrier national (aujourd'hui sans cap) sur le même cadre.

**Architecture:** `Screen.tsx` est la source de vérité de la largeur (18 pages joueurs l'utilisent, `ClubNav` collant compris) : on change le cap à un seul endroit, puis on fait des ajustements ciblés — grille des parties en 3 colonnes sur écran large, clamp ~760 px sur le formulaire du profil, wrap de `TournamentFinder` dans `Screen` — et une passe de vérification visuelle systématique (skill `verify`) qui décide des derniers polish.

**Tech Stack:** Next.js 16 (Turbopack), React inline styles + `useTheme()`, Jest/RTL (`node node_modules/jest/bin/jest.js` — les shims `.bin` sont cassés), skill `verify` (screenshots CDP).

**Spec:** `docs/superpowers/specs/2026-07-15-largeur-desktop-pages-joueurs-design.md`

**⚠️ Arbre de travail partagé :** du WIP non lié peut exister (ex. `notificationsStream`, `ClubNav.tsx`, `MessagesHub.tsx`, `NotificationBell.tsx`, `OpenMatches.tsx` modifiés). À chaque commit, `git add` **uniquement** les fichiers listés dans la tâche — jamais `git add -A`. Si `OpenMatches.tsx` porte du WIP étranger au moment de la Tâche 3, faire le diff avant d'éditer et ne committer que ses propres hunks (`git add -p` si nécessaire).

---

### Task 1: Cap du Screen à 1080 + commentaires

**Files:**
- Modify: `frontend/components/ui/Screen.tsx:6-15`
- Modify: `frontend/app/globals.css:17`

- [ ] **Step 1: Changer le cap et la docstring de Screen**

Dans `frontend/components/ui/Screen.tsx`, remplacer :

```tsx
/**
 * App shell: a centered column, full width on phones and capped on desktop, painted
 * with the current theme background. Default cap = 820px (largeur unique des pages
 * joueur) ; surchargeable via `style={{ maxWidth }}` si besoin.
 */
```

par :

```tsx
/**
 * App shell: a centered column, full width on phones and capped on desktop, painted
 * with the current theme background. Default cap = 1080px (largeur unique des pages
 * joueur — le ClubNav collant vit dedans, donc JAMAIS de largeur par page : la barre
 * sauterait en naviguant) ; surchargeable via `style={{ maxWidth }}` si besoin.
 */
```

et ligne 15, remplacer :

```tsx
      <div style={{ width: '100%', maxWidth: 820, minHeight: '100vh', position: 'relative', background: th.bg, ...style }}>
```

par :

```tsx
      <div style={{ width: '100%', maxWidth: 1080, minHeight: '100vh', position: 'relative', background: th.bg, ...style }}>
```

- [ ] **Step 2: Mettre à jour le commentaire de globals.css**

Dans `frontend/app/globals.css` (~ligne 17), remplacer :

```
   gouttière équivalente à gauche → le contenu centré (colonne max-width 820)
```

par :

```
   gouttière équivalente à gauche → le contenu centré (colonne max-width 1080)
```

- [ ] **Step 3: Vérifier que rien d'autre ne code 820 en dur**

Run: `cd frontend && grep -rn "820" components/ui/Screen.tsx app/globals.css`
Expected: aucune occurrence restante dans ces deux fichiers.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ui/Screen.tsx frontend/app/globals.css
git commit -m "feat(ui): colonne des pages joueurs elargie a 1080px en desktop"
```

---

### Task 2: Calendrier national dans le cadre Screen

Aujourd'hui `TournamentFinder` est rendu **sans aucun cap** (pleine largeur fenêtre) sur l'hôte plateforme — outlier pré-existant qu'on aligne sur le cadre unique.

**Files:**
- Modify: `frontend/app/tournois/page.tsx`
- Test (non-régression) : `frontend/__tests__/TournamentFinder.test.tsx` (monte le composant, pas la page — inchangé)

- [ ] **Step 1: Envelopper TournamentFinder dans Screen**

Remplacer le contenu de `frontend/app/tournois/page.tsx` par :

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { TournamentFinder } from '@/components/calendar/TournamentFinder';

// L'hôte est décidé par `slug` (posé par le layout depuis x-club-slug) : null = plateforme.
// Hôte plateforme → calendrier national public. Hôte club → /tournois est devenu /events.
export default function TournoisPage() {
  const { slug } = useClub();
  const router = useRouter();

  useEffect(() => {
    if (slug) router.replace('/events?filtre=competitions');
  }, [slug, router]);

  if (slug) return null;            // hôte club : redirection en cours vers /events
  return (
    <Screen>
      <TournamentFinder />
    </Screen>
  );
}
```

(Le root de `TournamentFinder` pose déjà `background: th.bg, minHeight: '100vh'` — duplication inoffensive avec `Screen`, ne pas y toucher.)

- [ ] **Step 2: Lancer la suite TournamentFinder**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/TournamentFinder.test.tsx`
Expected: PASS (la suite monte le composant directement, pas la page).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/tournois/page.tsx
git commit -m "feat(tournois): calendrier national aligne sur la colonne Screen"
```

---

### Task 3: Grille des parties ouvertes en 3 colonnes sur écran large

La grille 2 colonnes de `/parties` était explicitement calibrée pour un Screen de 820. À 1080, trois cartes de ~340 px passent confortablement.

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx:52-60`
- Test (non-régression) : `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1: Vérifier l'état du fichier (WIP partagé)**

Run: `git diff frontend/components/openmatch/OpenMatches.tsx`
Si le diff montre du WIP étranger (ex. notificationsStream) : n'éditer que la zone de la grille (lignes ~52-60) et committer avec `git add -p` en ne retenant que ce hunk.

- [ ] **Step 2: Passer la grille à 3 colonnes ≥ 1010px**

Dans `frontend/components/openmatch/OpenMatches.tsx`, remplacer :

```tsx
  // Écran large (le Screen fait 820px) : cartes en grille 2 colonnes — une carte
  // pleine largeur étire le mini-terrain pour rien ; en mobile, 1 colonne.
  const isDesktop = useIsDesktop(700);
  const matchGrid = {
    display: 'grid',
    gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr',
    gap: 12,
    alignItems: 'start',
  } as const;
```

par :

```tsx
  // Écran large (le Screen fait 1080px) : cartes en grille — une carte pleine largeur
  // étire le mini-terrain pour rien. 1 colonne en mobile, 2 dès 700px, 3 dès 1010px
  // (viewport ≈ colonne pleine : ~1040px utiles → 3 cartes de ~340px).
  const isDesktop = useIsDesktop(700);
  const isWide = useIsDesktop(1010);
  const matchGrid = {
    display: 'grid',
    gridTemplateColumns: isWide ? '1fr 1fr 1fr' : isDesktop ? '1fr 1fr' : '1fr',
    gap: 12,
    alignItems: 'start',
  } as const;
```

- [ ] **Step 3: Lancer la suite OpenMatches**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/OpenMatches.test.tsx`
Expected: PASS (jsdom = viewport étroit, la grille reste 1 colonne, aucune assertion de colonnes).

- [ ] **Step 4: Commit (uniquement ce hunk si WIP étranger présent)**

```bash
git add frontend/components/openmatch/OpenMatches.tsx
git commit -m "polish(parties): grille des parties ouvertes en 3 colonnes sur ecran large"
```

---

### Task 4: Clamp interne du profil (formulaire à ~760px)

À 1080, les cartes de formulaire du profil s'étireraient sur toute la colonne — pénible à lire et à remplir. On clampe **tout le contenu sous le header** (titre + nav de sections + sections) à 760 px centré, pour que titre et cartes restent alignés.

**Files:**
- Modify: `frontend/app/me/profile/page.tsx:330-618` (deux insertions)
- Test (non-régression) : `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1: Ouvrir le wrapper de clamp après le header**

Dans `frontend/app/me/profile/page.tsx`, le JSX a cette structure :

```tsx
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        {slug && club ? (
          <div ref={headerRef}><ClubNav club={club} /></div>
        ) : (
          /* header plateforme */
        )}

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, ... }}>
          Mon profil
        </div>
        ...
      </div>
    </Screen>
```

Insérer l'ouverture du wrapper **juste après la fermeture du conditionnel de header** (après le `)}` qui suit le bloc `<BackButton …/ProfileMenu>`), c'est-à-dire juste avant le `<div>` du titre « Mon profil » :

```tsx
        {/* Clamp desktop : le shell fait 1080, le formulaire reste lisible à 760 centré. */}
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
```

- [ ] **Step 2: Fermer le wrapper avant la fin du conteneur**

Ajouter le `</div>` de fermeture correspondant **juste avant** le `</div>` final du conteneur `paddingBottom: 48` (dernière ligne avant `</Screen>`, ligne ~618). Ne pas ré-indenter les centaines de lignes intermédiaires (JSX s'en moque) — un commentaire suffit :

```tsx
        </div>{/* /clamp 760 */}
      </div>
    </Screen>
```

- [ ] **Step 3: Vérifier la compilation TypeScript du fichier**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "me/profile" ; echo "exit=$?"`
Expected: aucune erreur sur `me/profile` (grep vide). D'autres erreurs de WIP parallèle peuvent apparaître ailleurs — les ignorer si elles ne concernent pas nos fichiers.

- [ ] **Step 4: Lancer la suite MeProfile**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/MeProfile.test.tsx`
Expected: PASS (le wrapper est un div neutre, aucune requête RTL ne cible la structure).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/me/profile/page.tsx
git commit -m "polish(profil): formulaire clampe a 760px dans la colonne 1080"
```

---

### Task 5: Passe de vérification visuelle + polish final

C'est la garde du projet : des composants ont pu être calibrés implicitement pour 820 (heros, kiosque d'annonces, rails snap-scroll, grille de créneaux). On vérifie TOUT, on corrige ce qui s'étire mal.

**Files:**
- Possiblement modifiés selon constats (pattern de fix ci-dessous)

- [ ] **Step 1: Invoquer la skill `verify` (session authentifiée, stack locale démarrée)**

Pages à capturer, chacune en **desktop 1280** ET **1440**, thème **clair + sombre**, puis **mobile 390 en non-régression** (⚠️ piège d'émulation : `mobile:false` + width fixe 390, sinon le viewport s'auto-ajuste et masque les débordements) :

1. `/` (club-house — hôte club `padel-arena-paris.localhost:3000`)
2. `/reserver` (vue cartes ET vue grille via le toggle ☰/⊞)
3. `/parties` (vérifier la grille 3 colonnes à 1280+)
4. `/events` + une fiche `/events/[id]` + une fiche `/tournois/[id]`
5. `/me/profile` (clamp 760 : titre et cartes alignés, centrés)
6. `/me/reservations` (les 3 onglets, dont le calendrier mensuel)
7. `/me/messages` (split desktop liste + fil)
8. `/me/friends`
9. `/club` (page vitrine)
10. Hôte plateforme `localhost:3000` : `/` (vitrine anonyme + connecté), `/clubs`, `/tournois` (calendrier national dans le cadre Screen)

- [ ] **Step 2: Critères de validation par page**

- Aucun débordement horizontal : `document.documentElement.scrollWidth <= innerWidth` partout (desktop et 390).
- Rien ne « flotte » : pas de section mono-colonne étirée sur 1040px de texte, pas de hero cassé, pas de rail snap dont les cartes s'étirent.
- Le `ClubNav` occupe la même largeur sur toutes les pages d'un même hôte.

- [ ] **Step 3: Corriger les étirements constatés (pattern unique)**

Pour toute section qui s'étire mal, appliquer le même pattern que la Task 4 — clamp interne au **contenu**, jamais au shell :

```tsx
<div style={{ maxWidth: 760, margin: '0 auto' }}>…contenu étroit…</div>
```

(760 pour du formulaire/lecture ; 900 acceptable pour des listes denses. Ne PAS surcharger `Screen style={{ maxWidth }}` par page — le ClubNav sauterait.)

- [ ] **Step 4: Re-vérifier les pages corrigées (mêmes viewports)**

Re-capturer uniquement les pages touchées au Step 3. Expected: critères du Step 2 tous verts.

- [ ] **Step 5: Type-check scopé + suites des composants touchés au Step 3**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur sur les fichiers du périmètre (ignorer les erreurs d'un WIP parallèle hors périmètre, cf. mémoire « frontend jest doesn't type-check »).
Puis lancer la suite Jest de chaque composant modifié au Step 3 (ex. `node node_modules/jest/bin/jest.js __tests__/<Composant>.test.tsx`). Expected: PASS.

- [ ] **Step 6: Commit final (uniquement les fichiers du polish)**

```bash
git add <fichiers du Step 3 uniquement>
git commit -m "polish(desktop): ajustements largeur 1080 apres verification visuelle"
```

---

## Self-review (fait à l'écriture du plan)

- **Couverture spec :** §Changements 1 → Task 1 ; §3 (TournamentFinder) → Task 2 ; §2 OpenMatches → Task 3 ; §2 profil → Task 4 ; §2 « autres pages » + §Vérification → Task 5 ; §Mobile → Step mobile 390 de Task 5. Hors périmètre respecté (aucune tâche ne touche admin/superadmin/auth/modales).
- **Placeholders :** aucun — chaque étape porte le code ou la commande exacte.
- **Cohérence :** le clamp 760 est le même pattern en Task 4 et Task 5 ; `useIsDesktop` déjà importé dans OpenMatches (utilisé ligne 54).
