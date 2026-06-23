# Profil : Sport préféré dédié + niveau padel-only + menu de navigation — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur `/me/profile`, sortir « Sport préféré » dans une région dédiée remontée près du haut, simplifier « Mon niveau » en padel-only, et ajouter un menu collant de navigation intra-page sans scroll horizontal mobile.

**Architecture :** Changement 100 % frontend. Un nouveau composant `ProfileSectionNav` (barre collante, scroll-spy, défilement doux, anti-scroll-horizontal) ; `app/me/profile/page.tsx` réordonne ses `<section>`, extrait « Sport préféré » dans sa propre carte, masque le sélecteur de sport du niveau (mono-sport) et câble le menu avec un offset mesuré sous le `ClubNav` collant.

**Tech Stack :** Next.js 16 (client components), React 19, TypeScript, composant `Icon` maison, thème via `useTheme()`, tests Jest + React Testing Library (jsdom), `IntersectionObserver` / `ResizeObserver`.

**Spec :** `docs/superpowers/specs/2026-06-23-profil-sport-prefere-menu-design.md`

**Branche :** `feat/profil-sport-prefere-menu` (déjà créée, contient la spec).

---

## Structure des fichiers

- **Créer** `frontend/components/profile/ProfileSectionNav.tsx` — le menu collant (barre, scroll-spy, scroll au clic, offset). Responsabilité unique : la navigation intra-page.
- **Créer** `frontend/__tests__/ProfileSectionNav.test.tsx` — tests unitaires du menu.
- **Modifier** `frontend/components/ui/Icon.tsx` — ajouter une icône `ball` (sport).
- **Modifier** `frontend/jest.setup.ts` — stubs jsdom `IntersectionObserver` + `ResizeObserver`.
- **Modifier** `frontend/app/me/profile/page.tsx` — réordonnancement, carte « Sport préféré » dédiée, niveau padel-only, intégration du menu + offset header.
- **Modifier** `frontend/__tests__/MeProfile.test.tsx` — adapter les tests niveau cassés, ajouter les tests « région dédiée » + « menu ».

Toutes les commandes ci-dessous s'exécutent depuis `frontend/` :
```bash
cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova/frontend"
```

---

### Task 1 : Stubs jsdom (IntersectionObserver + ResizeObserver)

Le menu et la page utilisent ces deux API, absentes de jsdom. Stubs neutres globaux pour ne pas faire planter les tests qui ne les ciblent pas (les tests qui les ciblent surchargeront localement).

**Files:**
- Modify: `frontend/jest.setup.ts`

- [ ] **Step 1 : Ajouter les stubs à la fin de `jest.setup.ts`**

Ajouter après le bloc `matchMedia` existant :

```typescript
// jsdom n'implémente ni IntersectionObserver ni ResizeObserver. Stubs neutres :
// les tests qui veulent piloter l'intersection surchargent global.IntersectionObserver localement.
class IOStub {
  constructor(_cb: unknown, _opts?: unknown) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
class ROStub {
  constructor(_cb: unknown) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error - stub jsdom
global.IntersectionObserver = IOStub;
// @ts-expect-error - stub jsdom
global.ResizeObserver = ROStub;
```

- [ ] **Step 2 : Vérifier que la suite tourne encore**

Run: `npm test -- MeProfile`
Expected: PASS (les tests existants ne régressent pas avec les stubs en place).

- [ ] **Step 3 : Commit**

```bash
git add jest.setup.ts
git commit -m "test(setup): stubs jsdom IntersectionObserver + ResizeObserver"
```

---

### Task 2 : Icône `ball` (sport)

**Files:**
- Modify: `frontend/components/ui/Icon.tsx:8` (union `IconName`) et `:56-57` (table `paths`)

- [ ] **Step 1 : Ajouter `ball` au type `IconName`**

Modifier la dernière ligne de l'union (ligne 8) :

```typescript
  | 'share' | 'download' | 'ball';
```

- [ ] **Step 2 : Ajouter le tracé `ball` dans la table `paths`**

Juste après la ligne `download: <>…</>,` (ligne 56), ajouter une entrée (balle stylisée avec la couture incurvée) :

```typescript
    ball: <><circle cx="12" cy="12" r="9" {...p} /><path d="M5 7c5 1.5 9 5.5 11 12M19 7c-5 1.5-9 5.5-11 12" {...p} /></>,
```

- [ ] **Step 3 : Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit`
Expected: aucune erreur liée à `Icon.tsx` (la table `paths: Record<IconName, ReactNode>` exige une entrée pour chaque nom → si `ball` manquait, TS échouerait).

- [ ] **Step 4 : Commit**

```bash
git add components/ui/Icon.tsx
git commit -m "feat(icon): ajoute l'icône ball pour le sport"
```

---

### Task 3 : Composant `ProfileSectionNav`

Barre collante, une ligne, items en `flex:1` (jamais de scroll horizontal ; sous 360px le libellé s'efface). Sticky sous le header (`topOffset`). Scroll-spy via `IntersectionObserver`. Défilement doux au clic via `scrollIntoView`. Expose l'offset d'ancrage en variable CSS `--profile-anchor` pour le `scroll-margin-top` des sections.

**Files:**
- Create: `frontend/components/profile/ProfileSectionNav.tsx`
- Test: `frontend/__tests__/ProfileSectionNav.test.tsx`

- [ ] **Step 1 : Écrire le test unitaire (qui échoue)**

Créer `frontend/__tests__/ProfileSectionNav.test.tsx` :

```tsx
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ProfileSectionNav, ProfileNavItem } from '../components/profile/ProfileSectionNav';
import { ThemeProvider } from '../lib/ThemeProvider';

const items: ProfileNavItem[] = [
  { id: 'identite', icon: 'user', label: 'Identité' },
  { id: 'sport', icon: 'ball', label: 'Sport' },
  { id: 'niveau', icon: 'chart', label: 'Niveau' },
];

// IO mock local capturant le callback pour simuler l'intersection
let ioCb: ((entries: unknown[]) => void) | null = null;
beforeEach(() => {
  ioCb = null;
  // @ts-expect-error - mock local
  global.IntersectionObserver = class {
    constructor(cb: (e: unknown[]) => void) { ioCb = cb; }
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
  // jsdom n'implémente pas scrollIntoView
  Element.prototype.scrollIntoView = jest.fn();
});

function renderNav() {
  return render(
    <ThemeProvider>
      <ProfileSectionNav items={items} topOffset={0} />
      <section id="identite">A</section>
      <section id="sport">B</section>
      <section id="niveau">C</section>
    </ThemeProvider>,
  );
}

describe('ProfileSectionNav', () => {
  it('rend tous les items dans une nav nommée', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: /sections du profil/i });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText('Identité')).toBeInTheDocument();
    expect(screen.getByText('Sport')).toBeInTheDocument();
    expect(screen.getByText('Niveau')).toBeInTheDocument();
  });

  it('le premier item est actif par défaut', () => {
    renderNav();
    expect(screen.getByText('Identité').closest('button')).toHaveAttribute('aria-current', 'true');
  });

  it('cliquer un item défile vers sa section et l\'active', () => {
    renderNav();
    fireEvent.click(screen.getByText('Niveau'));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText('Niveau').closest('button')).toHaveAttribute('aria-current', 'true');
  });

  it('scroll-spy : la section visible devient active', () => {
    renderNav();
    act(() => {
      ioCb?.([{ isIntersecting: true, target: { id: 'sport' }, boundingClientRect: { top: 10 } }]);
    });
    expect(screen.getByText('Sport').closest('button')).toHaveAttribute('aria-current', 'true');
  });
});
```

- [ ] **Step 2 : Lancer le test pour le voir échouer**

Run: `npm test -- ProfileSectionNav`
Expected: FAIL (`Cannot find module '../components/profile/ProfileSectionNav'`).

- [ ] **Step 3 : Implémenter le composant**

Créer `frontend/components/profile/ProfileSectionNav.tsx` :

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon, IconName } from '@/components/ui/Icon';
import { useTheme } from '@/lib/ThemeProvider';

export type ProfileNavItem = { id: string; icon: IconName; label: string };

const GAP = 8; // marge entre la barre collante et le titre de section ancré

// Menu de navigation intra-page du profil. Une seule ligne (icône au-dessus, libellé
// court en dessous), items en flex:1 → jamais de scroll horizontal ; sous 360px le
// libellé s'efface, l'icône reste. Collant sous le header (topOffset = hauteur du
// ClubNav collant, 0 sur l'hôte plateforme). Surligne la section visible et défile
// en douceur au clic. Expose --profile-anchor (offset des ancres) pour scroll-margin-top.
export function ProfileSectionNav({ items, topOffset = 0 }: { items: ProfileNavItem[]; topOffset?: number }) {
  const { th } = useTheme();
  const navRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  // Variable CSS pour le scroll-margin-top des sections (= header + barre + marge).
  useEffect(() => {
    const h = navRef.current?.offsetHeight ?? 0;
    document.documentElement.style.setProperty('--profile-anchor', `${topOffset + h + GAP}px`);
  }, [topOffset, items.length]);

  // Scroll-spy : la section la plus haute sous la ligne des barres collantes gagne.
  useEffect(() => {
    const offset = topOffset + (navRef.current?.offsetHeight ?? 0) + GAP;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        const top = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        setActive((top.target as HTMLElement).id);
      },
      { rootMargin: `-${offset}px 0px -55% 0px`, threshold: 0 },
    );
    items.forEach((it) => { const el = document.getElementById(it.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [items, topOffset]);

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <nav
      ref={navRef}
      className="psn"
      aria-label="Sections du profil"
      style={{
        position: 'sticky', top: topOffset, zIndex: 40, display: 'flex', gap: 4,
        background: th.surface, border: `1px solid ${th.line}`, borderRadius: 16,
        padding: 6, margin: '14px 20px 0', boxShadow: th.shadowSoft,
      }}
    >
      <style>{`@media (max-width:360px){ .psn .psn-lbl { display:none; } }`}</style>
      {items.map((it) => {
        const on = active === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => go(it.id)}
            aria-current={on ? 'true' : undefined}
            style={{
              flex: '1 1 0', minWidth: 0, cursor: 'pointer', border: 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              borderRadius: 11, padding: '6px 2px',
              background: on ? th.accent : 'transparent', color: on ? th.onAccent : th.textMute,
              fontFamily: th.fontUI, transition: 'background .15s, color .15s',
            }}
          >
            <Icon name={it.icon} size={16} color={on ? th.onAccent : th.textMute} />
            <span className="psn-lbl" style={{ fontSize: 10, fontWeight: 600, lineHeight: 1.1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4 : Lancer le test pour le voir passer**

Run: `npm test -- ProfileSectionNav`
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add components/profile/ProfileSectionNav.tsx __tests__/ProfileSectionNav.test.tsx
git commit -m "feat(profil): composant ProfileSectionNav (menu collant, scroll-spy, anti-scroll-horizontal)"
```

---

### Task 4 : « Mon niveau » padel-only (suppression du sélecteur de sport)

Masquer le sélecteur PillTabs « Sport du niveau », titre dynamique « Mon niveau · Padel », fixer `ratingSport` au padel (découplé du sport préféré). Adapter les tests niveau existants qui dépendaient du sélecteur.

**Files:**
- Modify: `frontend/app/me/profile/page.tsx`
- Modify: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Découpler `ratingSport` du sport préféré**

Dans `page.tsx`, supprimer la ligne d'initialisation (≈ ligne 92-93) :

```typescript
        // Initialiser le sport du niveau sur le sport préféré
        if (p.preferredSport?.key) setRatingSport(p.preferredSport.key);
```

(`ratingSport` reste à sa valeur par défaut `'padel'`, cf. `useState<string>('padel')`.)

- [ ] **Step 2 : Calculer le nom du sport et le drapeau d'affichage du sélecteur**

Dans le corps de rendu, juste après les définitions de styles (après `readonlyRow`, avant `const avatarSrc = …` ≈ ligne 228), ajouter :

```typescript
  // Niveau : on ne gère que le padel aujourd'hui. Le sélecteur de sport réapparaîtra
  // quand l'utilisateur aura un niveau sur 2+ sports (à brancher sur un futur signal
  // multi-sport ; tant qu'il n'existe pas, le drapeau reste false).
  const showLevelSportPicker = false;
  const levelSportName = sports.find((s) => s.key === ratingSport)?.name ?? 'Padel';
```

- [ ] **Step 3 : Adapter la section « Mon niveau »**

Remplacer l'ouverture de la section niveau (≈ lignes 295-310). Avant :

```tsx
            {club?.levelSystemEnabled !== false && (
              <section style={card} aria-label="Mon niveau padel">
                <div style={cardTitle}>Mon niveau</div>
                {sports.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={label}>Sport du niveau</span>
                    <div role="group" aria-label="Sport du niveau">
                      <PillTabs
                        options={sports.map((s) => ({ value: s.key, label: s.name }))}
                        value={ratingSport}
                        onChange={setRatingSport}
                        size="sm"
                      />
                    </div>
                  </div>
                )}
```

Après :

```tsx
            {club?.levelSystemEnabled !== false && (
              <section id="niveau" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Mon niveau">
                <div style={cardTitle}>Mon niveau · {levelSportName}</div>
                {showLevelSportPicker && sports.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={label}>Sport du niveau</span>
                    <div role="group" aria-label="Sport du niveau">
                      <PillTabs
                        options={sports.map((s) => ({ value: s.key, label: s.name }))}
                        value={ratingSport}
                        onChange={setRatingSport}
                        size="sm"
                      />
                    </div>
                  </div>
                )}
```

(Le reste de la section — `rating && !calibrating ? … : …` et la balise `</section>` — est inchangé.)

- [ ] **Step 4 : Remplacer les deux tests niveau cassés**

Dans `MeProfile.test.tsx`, **supprimer** les tests `'niveau par sport : changer de sport recharge le rating'` et `'niveau par sport : le calibrage utilise le sport sélectionné'` (≈ lignes 186-223) et les remplacer par :

```tsx
  it('niveau : padel uniquement, sans sélecteur de sport, découplé du sport préféré', async () => {
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
      { id: 'sport-tennis', key: 'tennis', name: 'Tennis', icon: '🎾', published: true },
    ]);
    api.getMyRating.mockResolvedValue({ level: 5.2, calibrated: true, gamesPlayed: 10, tier: 'CONFIRMED', sport: 'padel' });
    api.getMyProfile.mockResolvedValue({ ...profile, preferredSport: { id: 'sport-tennis', key: 'tennis', name: 'Tennis' } });
    wrap();
    const region = await screen.findByRole('region', { name: /mon niveau/i });
    expect(region).toHaveTextContent(/Padel/);
    expect(screen.queryByRole('group', { name: /sport du niveau/i })).not.toBeInTheDocument();
    // Le rating chargé est celui du padel, jamais du sport préféré (tennis).
    await waitFor(() => expect(api.getMyRating).toHaveBeenCalledWith(expect.any(String), 'padel'));
    expect(api.getMyRating).not.toHaveBeenCalledWith(expect.any(String), 'tennis');
  });

  it('niveau : le calibrage utilise le padel', async () => {
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
    ]);
    api.getMyRating.mockResolvedValue(null); // → LevelCalibration s'affiche
    api.calibrateRating.mockResolvedValue({ level: 4.0, calibrated: true, gamesPlayed: 0, tier: 'UPPER_INTERMEDIATE', sport: 'padel' });
    wrap();
    const skipBtn = await screen.findByRole('button', { name: /passer|skip/i });
    fireEvent.click(skipBtn);
    await waitFor(() => expect(api.calibrateRating).toHaveBeenCalledWith(null, expect.any(String), 'padel'));
  });
```

- [ ] **Step 5 : Corriger le test « club OFF »**

Remplacer le corps du test `'club OFF : pas de section niveau'` (≈ ligne 134-139) — l'ancienne assertion testait un texte qui n'apparaît jamais. Nouvelle version :

```tsx
  it('club OFF : pas de section niveau', async () => {
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo', levelSystemEnabled: false }, loading: false };
    wrap();
    await screen.findByText('Eric');
    expect(screen.queryByRole('region', { name: /mon niveau/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 6 : Lancer les tests niveau**

Run: `npm test -- MeProfile`
Expected: PASS (dont les 3 tests niveau ci-dessus ; aucun test ne référence plus « sport du niveau »).

- [ ] **Step 7 : Commit**

```bash
git add app/me/profile/page.tsx __tests__/MeProfile.test.tsx
git commit -m "feat(profil): section Mon niveau en padel-only (sélecteur de sport masqué, titre dynamique)"
```

---

### Task 5 : Carte « Sport préféré » dédiée (extraite de Préférences)

Sortir le bloc « Sport préféré » de la carte « Préférences » et en faire une `<section>` autonome placée **juste après Identité**, avant « Mon niveau ».

**Files:**
- Modify: `frontend/app/me/profile/page.tsx`
- Modify: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Écrire le test (région dédiée) — il échouera**

Dans `MeProfile.test.tsx`, ajouter ce test (après `'enregistre le sport préféré'`) :

```tsx
  it('« Sport préféré » est une région dédiée, hors de Préférences', async () => {
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
    ]);
    wrap();
    const sportRegion = await screen.findByRole('region', { name: 'Sport préféré' });
    expect(sportRegion).toBeInTheDocument();
    // Le pill 'Aucun' du sport préféré est bien DANS la région dédiée…
    expect(within(sportRegion).getByText('Aucun')).toBeInTheDocument();
    // …et PAS dans la région Préférences.
    const prefRegion = screen.getByRole('region', { name: 'Préférences' });
    expect(within(prefRegion).queryByText('Sport préféré')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2 : Le voir échouer**

Run: `npm test -- MeProfile -t "région dédiée"`
Expected: FAIL (la région « Sport préféré » n'existe pas encore ; il y a une section sans nom accessible).

- [ ] **Step 3 : Donner un nom accessible à la carte Préférences**

Dans `page.tsx`, la section Préférences a déjà `aria-label="Préférences"` (≈ ligne 358) → OK, rien à faire ici. Vérifier juste qu'il est présent.

- [ ] **Step 4 : Retirer le bloc « Sport préféré » de Préférences**

Supprimer ce bloc dans la section Préférences (≈ lignes 380-392) :

```tsx
              {sports.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={label}>Sport préféré</span>
                  <div role="group" aria-label="Sport préféré">
                    <PillTabs
                      options={[{ value: '', label: 'Aucun' }, ...sports.map((s) => ({ value: s.id, label: s.name }))]}
                      value={profile.preferredSport?.id ?? ''}
                      onChange={handlePreferredSport}
                      size="sm"
                    />
                  </div>
                </div>
              )}
```

- [ ] **Step 5 : Insérer la carte « Sport préféré » dédiée après Identité**

Juste après la fermeture de la section Identité (`</section>` ≈ ligne 292), avant la section « Mon niveau », insérer :

```tsx
            {/* Sport préféré — région dédiée, distincte du niveau par sport */}
            {sports.length > 0 && (
              <section id="sport" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Sport préféré">
                <div style={cardTitle}>Sport préféré</div>
                <div role="group" aria-label="Sport préféré">
                  <PillTabs
                    options={[{ value: '', label: 'Aucun' }, ...sports.map((s) => ({ value: s.id, label: s.name }))]}
                    value={profile.preferredSport?.id ?? ''}
                    onChange={handlePreferredSport}
                    size="sm"
                  />
                </div>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Met en avant ce sport dans l’app.</span>
              </section>
            )}
```

- [ ] **Step 6 : Lancer les tests**

Run: `npm test -- MeProfile`
Expected: PASS (le test « région dédiée » + `'enregistre le sport préféré'` passent ; ce dernier cible toujours `role="group"` name « Sport préféré », désormais dans la carte dédiée).

- [ ] **Step 7 : Commit**

```bash
git add app/me/profile/page.tsx __tests__/MeProfile.test.tsx
git commit -m "feat(profil): carte Sport préféré dédiée, remontée après Identité"
```

---

### Task 6 : Intégrer le menu + ids d'ancres + offset sous le ClubNav

Ajouter les `id` + `scroll-margin-top` sur toutes les sections, mesurer la hauteur du `ClubNav` collant, construire la liste d'items et rendre `ProfileSectionNav`.

**Files:**
- Modify: `frontend/app/me/profile/page.tsx`
- Modify: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Importer le composant et les hooks**

En tête de `page.tsx`, ajouter l'import (après l'import `ClubNav` ≈ ligne 17) :

```typescript
import { ProfileSectionNav, ProfileNavItem } from '@/components/profile/ProfileSectionNav';
```

S'assurer que `useEffect`, `useRef`, `useState` sont importés depuis `react` (ligne 1 importe déjà `useEffect, useRef, useState`). OK.

- [ ] **Step 2 : Mesurer la hauteur du header collant (ClubNav)**

Ajouter l'état + ref près des autres `useState` (après `const { slug, club } = useClub();` ≈ ligne 34) :

```typescript
  // Hauteur du ClubNav collant : sert d'offset au menu de navigation (0 sur l'hôte plateforme).
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(0);
```

Puis ajouter cet effet près des autres `useEffect` (après celui de `getSports` ≈ ligne 80) :

```typescript
  useEffect(() => {
    const el = headerRef.current;
    if (!el) { setHeaderH(0); return; }
    const update = () => setHeaderH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slug, club]);
```

- [ ] **Step 3 : Envelopper `ClubNav` dans le ref**

Modifier la branche header (≈ lignes 235-236). Avant :

```tsx
        {slug && club ? (
          <ClubNav club={club} />
        ) : (
```

Après :

```tsx
        {slug && club ? (
          <div ref={headerRef}><ClubNav club={club} /></div>
        ) : (
```

- [ ] **Step 4 : Construire la liste d'items du menu**

Dans le corps de rendu, après `const levelSportName = …` (Task 4, Step 2), ajouter :

```typescript
  // Items du menu = sections réellement rendues (pas d'ancre morte).
  const navItems: ProfileNavItem[] = [
    { id: 'identite', icon: 'user', label: 'Identité' },
    ...(sports.length > 0 ? [{ id: 'sport', icon: 'ball', label: 'Sport' } as ProfileNavItem] : []),
    ...(club?.levelSystemEnabled !== false ? [{ id: 'niveau', icon: 'chart', label: 'Niveau' } as ProfileNavItem] : []),
    { id: 'infos', icon: 'info', label: 'Infos' },
    { id: 'preferences', icon: 'settings', label: 'Préf.' },
    { id: 'securite', icon: 'lock', label: 'Sécu.' },
    ...(slug && club && membership ? [{ id: 'licence', icon: 'ticket', label: 'Licence' } as ProfileNavItem] : []),
  ];
```

- [ ] **Step 5 : Rendre le menu + ajouter id/scroll-margin sur les sections restantes**

Dans la branche « chargé » (`loading || !profile ? … : (`), remplacer le wrapper unique par un fragment contenant le menu puis le conteneur de cartes. Avant (≈ ligne 261-262) :

```tsx
        ) : (
          <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
```

Après :

```tsx
        ) : (
          <>
            <ProfileSectionNav items={navItems} topOffset={headerH} />
            <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
```

Et fermer le fragment : la balise `</div>` qui ferme ce conteneur (juste avant `)}` ≈ ligne 441) devient :

```tsx
            </div>
          </>
        )}
```

Ajouter `id` + `scrollMarginTop` aux sections qui n'en ont pas encore :

- Identité (≈ ligne 265) : `<section style={card} aria-label="Identité">` →
  `<section id="identite" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Identité">`
- Informations (≈ ligne 330) : `<section style={card} aria-label="Informations">` →
  `<section id="infos" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Informations">`
- Préférences (≈ ligne 358) : `<section style={card} aria-label="Préférences">` →
  `<section id="preferences" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Préférences">`
- Mot de passe (≈ ligne 396) : `<section style={card} aria-label="Mot de passe">` →
  `<section id="securite" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Mot de passe">`
- Licence (≈ ligne 429) : `<section style={card} aria-label="Licence">` →
  `<section id="licence" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Licence">`

(« Sport préféré » id=`sport` et « Mon niveau » id=`niveau` ont déjà été posés aux Tasks 4 et 5.)

- [ ] **Step 6 : Ajouter le test d'intégration du menu**

Dans `MeProfile.test.tsx`, ajouter :

```tsx
  it('affiche le menu de navigation listant les régions rendues', async () => {
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
    ]);
    wrap();
    const nav = await screen.findByRole('navigation', { name: /sections du profil/i });
    expect(within(nav).getByText('Identité')).toBeInTheDocument();
    expect(within(nav).getByText('Sport')).toBeInTheDocument();
    expect(within(nav).getByText('Infos')).toBeInTheDocument();
    expect(within(nav).getByText('Préf.')).toBeInTheDocument();
    expect(within(nav).getByText('Sécu.')).toBeInTheDocument();
  });

  it('le menu omet « Niveau » quand le club a désactivé les niveaux', async () => {
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo', levelSystemEnabled: false }, loading: false };
    api.getSports.mockResolvedValue([
      { id: 'sport-padel', key: 'padel', name: 'Padel', icon: '🎾', published: true },
    ]);
    wrap();
    const nav = await screen.findByRole('navigation', { name: /sections du profil/i });
    expect(within(nav).queryByText('Niveau')).not.toBeInTheDocument();
  });
```

- [ ] **Step 7 : Lancer toute la suite du profil**

Run: `npm test -- MeProfile`
Expected: PASS (tous les tests, anciens adaptés + nouveaux).

- [ ] **Step 8 : Commit**

```bash
git add app/me/profile/page.tsx __tests__/MeProfile.test.tsx
git commit -m "feat(profil): menu de navigation collant + ancres de sections (offset sous ClubNav)"
```

---

### Task 7 : Vérification finale

**Files:** aucun (vérification).

- [ ] **Step 1 : Suite de tests frontend complète**

Run: `npm test`
Expected: PASS, aucune régression (notamment `ProfileSectionNav`, `MeProfile`, `ProfileMenu`, `AdminLayout`).

- [ ] **Step 2 : Typecheck**

Run: `npx tsc --noEmit`
Expected: aucune erreur de type.

- [ ] **Step 3 : Vérification visuelle manuelle (dev)**

Démarrer le front (`npm run dev`) et ouvrir `/me/profile` :
- « Sport préféré » est une carte dédiée juste après Identité ; absente de « Préférences ».
- « Mon niveau · Padel » sans rangée de pastilles de sport.
- Le menu colle en haut au scroll, surligne la section visible, défile au clic sans masquer les titres.
- Réduire la fenêtre à ~320px : le menu reste sur une ligne, **aucune barre de défilement horizontale** (le libellé s'efface sous 360px, l'icône reste).
- Sur un sous-domaine club : le menu se cale sous le `ClubNav` sans le chevaucher.

- [ ] **Step 4 : Mettre à jour le CLAUDE.md (section profil)**

Ajouter une note d'évolution sous la section « page profil dédiée » de `palova/CLAUDE.md` résumant : carte « Sport préféré » dédiée + remontée, « Mon niveau » padel-only (sélecteur masqué, drapeau `showLevelSportPicker` pour le futur multi-sport), composant `ProfileSectionNav` (menu collant, scroll-spy, anti-scroll-horizontal, offset mesuré sous `ClubNav`).

```bash
git add ../CLAUDE.md
git commit -m "docs: note d'évolution page profil (Sport préféré dédié, niveau padel-only, menu nav)"
```

---

## Self-review (effectuée)

**Couverture spec :**
- Région « Sport préféré » dédiée + remontée → Task 5. ✓
- Niveau padel-only + sélecteur adaptatif (drapeau futur) → Task 4. ✓
- Menu collant icônes+libellé, sans scroll horizontal → Task 3 (flex:1 + masquage libellé <360px). ✓
- Offset sous ClubNav + scroll-spy + défilement doux → Tasks 3 & 6. ✓
- Icône « Sport » additive → Task 2. ✓
- Tests (composant + page, dont mise à jour des tests cassés) → Tasks 3-6. ✓

**Placeholders :** aucun ; tout le code est fourni. `showLevelSportPicker = false` est l'implémentation fidèle voulue par la spec (mono-sport), commentée, pas un TODO.

**Cohérence des types :** `ProfileNavItem` défini en Task 3, importé et utilisé identiquement en Task 6 ; `IconName` étendu en Task 2 couvre `'ball'` utilisé en Task 6 ; `topOffset`/`items` cohérents entre composant et appelant.
