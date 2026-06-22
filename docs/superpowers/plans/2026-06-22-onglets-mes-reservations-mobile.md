# Onglets « Mes réservations » adaptés au mobile — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur écran < 480 px, afficher les 4 onglets de `/me/reservations` en icône empilée + libellé court (compteurs en pastilles), sans rien changer au rendu desktop.

**Architecture:** On étend le composant partagé `Segmented` (`frontend/components/ui/atoms.tsx`) avec deux champs **optionnels** par option (`icon`, `count`). Quand une option porte une icône, le bouton reçoit des classes CSS dédiées (`sp-seg-*`) ; un bloc `@media (max-width: 480px)` dans `globals.css` bascule alors la disposition texte → icône empilée. Les couleurs viennent du thème en style inline ; le responsive est 100 % CSS (pas de JS, pas d'hydration mismatch). Les 5 autres usages de `Segmented` ne passent aucun de ces champs → comportement identique.

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (+ `@media` natifs dans `globals.css`), Jest + React Testing Library, styles inline thémés via `ThemeProvider`.

---

## Note d'isolation (avant de commencer)

L'arbre `main` contient du WIP utilisateur en cours (`backend/package.json`, `backend/src/services/icon.service.ts` + son test, `backend/prisma/seed-matches.ts`). **Cette feature est 100 % frontend.** Isoler le travail sur une branche `feat/onglets-resa-mobile` (idéalement un worktree hors OneDrive, cf. historique projet) et ne `git add` que les fichiers listés dans chaque tâche — **ne jamais embarquer le WIP utilisateur**.

Premier commit de la branche : ajouter les deux documents de conception déjà écrits.

```bash
git add docs/superpowers/specs/2026-06-22-onglets-mes-reservations-mobile-design.md \
        docs/superpowers/plans/2026-06-22-onglets-mes-reservations-mobile.md
git commit -m "docs: spec + plan onglets Mes réservations sur mobile"
```

---

## File Structure

- `frontend/components/ui/atoms.tsx` — **modifié** : `interface SegOption` gagne `icon?`/`count?` ; `Segmented` rend l'icône + la pastille + le compteur inline quand `icon` est fourni. `Icon`/`IconName` y sont **déjà importés** (ligne 10).
- `frontend/app/globals.css` — **modifié** : ajout des classes `.sp-seg-tab` / `.sp-seg-icon` / `.sp-seg-badge` / `.sp-seg-count-inline` + le bloc `@media (max-width: 480px)`.
- `frontend/app/me/reservations/page.tsx` — **modifié** : l'appel `<Segmented>` passe `icon` + `count` et un libellé sans compteur.
- `frontend/__tests__/Segmented.test.tsx` — **créé** : tests unitaires du nouveau rendu (icône/compteur) et de la non-régression (option sans icône).

---

## Task 1 : `Segmented` accepte une icône et un compteur par option

**Files:**
- Test : `frontend/__tests__/Segmented.test.tsx` (créer)
- Modify : `frontend/components/ui/atoms.tsx` (interface `SegOption` ~ligne 188, fonction `Segmented` lignes 190-211)

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/Segmented.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { Segmented } from '../components/ui/atoms';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('Segmented', () => {
  it('rend une icône et le compteur quand ils sont fournis', () => {
    wrap(
      <Segmented
        value="upcoming"
        onChange={() => {}}
        options={[
          { value: 'calendar', label: 'Calendrier', icon: 'calendar' },
          { value: 'upcoming', label: 'À venir', icon: 'clock', count: 3 },
        ]}
      />,
    );
    const upcoming = screen.getByText('À venir').closest('button')!;
    expect(upcoming.querySelector('svg')).toBeInTheDocument(); // icône rendue
    expect(upcoming.textContent).toContain('3');                // compteur présent
    const calendar = screen.getByText('Calendrier').closest('button')!;
    expect(calendar.querySelector('.sp-seg-badge')).toBeNull(); // pas de pastille sans count
  });

  it('reste un simple bouton texte quand aucune icône (autres usages inchangés)', () => {
    wrap(
      <Segmented
        value="x"
        onChange={() => {}}
        options={[{ value: 'x', label: 'Privé' }, { value: 'y', label: 'Public' }]}
      />,
    );
    const tab = screen.getByText('Privé').closest('button')!;
    expect(tab.querySelector('svg')).toBeNull();
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

Run (depuis `frontend/`) : `npm test -- Segmented.test.tsx --watchAll=false`
Attendu : ÉCHEC — soit erreur TypeScript (`icon`/`count` inconnus sur les options), soit assertion `querySelector('svg')` qui ne trouve rien (pas encore d'icône rendue).

- [ ] **Step 3 : Implémenter le rendu**

Dans `frontend/components/ui/atoms.tsx`, remplacer l'interface (~ligne 188) :

```tsx
interface SegOption<T> { value: T; label: string; icon?: IconName; count?: number; }
```

Puis remplacer le corps de `Segmented` (lignes 190-211) par :

```tsx
export function Segmented<T extends string | number>({
  options, value, onChange,
}: { options: SegOption<T>[]; value: T; onChange: (v: T) => void }) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', gap: 4, background: th.surface2, borderRadius: 13, padding: 4 }}>
      {options.map((o) => {
        const active = o.value === value;
        const withIcon = o.icon != null;
        return (
          <button key={String(o.value)} onClick={() => onChange(o.value)}
            className={withIcon ? 'sp-seg-tab' : undefined}
            style={{
              flex: 1, border: 'none', cursor: 'pointer', borderRadius: 10, padding: '10px 6px',
              fontFamily: th.fontUI, fontWeight: active ? 700 : 600, fontSize: 14.5,
              background: active ? th.surface : 'transparent',
              color: th.text,
              boxShadow: active ? th.shadowSoft : 'none', transition: 'all .15s',
            }}>
            {withIcon && (
              <span className="sp-seg-icon">
                <Icon name={o.icon!} size={20} color={active ? th.accent : th.textFaint} />
                {o.count != null && (
                  <span className="sp-seg-badge" style={{ background: th.accent, color: th.onAccent }}>{o.count}</span>
                )}
              </span>
            )}
            {withIcon ? <span className="sp-seg-label">{o.label}</span> : o.label}
            {withIcon && o.count != null && <span className="sp-seg-count-inline">{` · ${o.count}`}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

Notes :
- `Icon` et `IconName` sont **déjà importés** en haut du fichier (ligne 10) — ne rien ajouter.
- `th.onAccent` existe (déjà utilisé dans `app/me/reservations/page.tsx:154`).
- On a abandonné le flag `responsive` de la spec : on se base simplement sur la présence d'`icon` (plus simple, même résultat, zéro impact sur les autres usages).

- [ ] **Step 4 : Lancer le test et vérifier qu'il passe**

Run (depuis `frontend/`) : `npm test -- Segmented.test.tsx --watchAll=false`
Attendu : PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/__tests__/Segmented.test.tsx frontend/components/ui/atoms.tsx
git commit -m "feat(ui): Segmented accepte icône + compteur par option"
```

---

## Task 2 : CSS responsive (icône empilée + pastille sous 480 px)

**Files:**
- Modify : `frontend/app/globals.css` (ajouter à la fin)

Pas de test unitaire : jsdom n'évalue pas les media queries. La vérification est visuelle (Task 4).

- [ ] **Step 1 : Ajouter les règles CSS**

À la fin de `frontend/app/globals.css`, ajouter :

```css
/* ── Onglets Segmented adaptatifs (page « Mes réservations ») ──────────────
   Desktop : texte simple (rendu inchangé). Mobile (<480px) : icône empilée
   + libellé court, le compteur passe en pastille. N'affecte que les onglets
   qui portent une icône. */
.sp-seg-tab { position: relative; }
.sp-seg-icon { display: none; }   /* icône masquée hors mobile */
.sp-seg-badge { display: none; }  /* pastille masquée hors mobile */

@media (max-width: 480px) {
  .sp-seg-tab {
    display: flex; flex-direction: column; align-items: center;
    gap: 4px; padding: 7px 2px;
  }
  .sp-seg-icon { display: inline-flex; }
  .sp-seg-label { font-size: 11px; }
  .sp-seg-count-inline { display: none; }   /* le compteur devient une pastille */
  .sp-seg-badge {
    display: flex; align-items: center; justify-content: center;
    position: absolute; top: 3px; right: 8px;
    min-width: 15px; height: 15px; padding: 0 4px;
    border-radius: 8px; font-size: 9px; font-weight: 800; line-height: 1;
  }
}
```

- [ ] **Step 2 : Vérifier que la suite de tests reste verte**

Run (depuis `frontend/`) : `npm test -- Segmented.test.tsx --watchAll=false`
Attendu : PASS (le CSS n'affecte pas le DOM en jsdom).

- [ ] **Step 3 : Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(ui): onglets Segmented empilés icône+pastille sur mobile (<480px)"
```

---

## Task 3 : Brancher la page `/me/reservations`

**Files:**
- Modify : `frontend/app/me/reservations/page.tsx` (lignes 174-180, l'appel `<Segmented>`)

- [ ] **Step 1 : Mettre à jour l'appel `<Segmented>`**

Dans `frontend/app/me/reservations/page.tsx`, remplacer le bloc `options` (lignes 175-180) par :

```tsx
          <Segmented<'upcoming' | 'past' | 'calendar' | 'matches'> value={tab} onChange={setTab}
            options={[
              { value: 'calendar', label: 'Calendrier', icon: 'calendar' },
              { value: 'upcoming', label: 'À venir', icon: 'clock', count: upcoming.length },
              { value: 'past', label: 'Passées', icon: 'check', count: past.length },
              ...(levelEnabled ? [{ value: 'matches' as const, label: 'Matchs', icon: 'trophy' as const }] : []),
            ]} />
```

Changements : les compteurs sortent du libellé (`'À venir · 3'` → `label: 'À venir'` + `count`), et chaque onglet reçoit son icône (`calendar` / `clock` / `check` / `trophy`).

- [ ] **Step 2 : Vérifier que le test de la page reste vert**

Run (depuis `frontend/`) : `npm test -- MyReservationsCalendar.test.tsx --watchAll=false`
Attendu : PASS. (Le test interroge `getByText('Calendrier')` et `getByText(/À venir/)` : ces libellés restent rendus tels quels dans le `<span className="sp-seg-label">`.)

- [ ] **Step 3 : Vérifier le typage**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Attendu : aucune erreur. (Si TS se plaint de l'`icon` du spread `matches`, le `as const` est déjà là ; vérifier que les icônes inline sont bien des `IconName` valides : `calendar`, `clock`, `check`, `trophy` le sont.)

- [ ] **Step 4 : Commit**

```bash
git add frontend/app/me/reservations/page.tsx
git commit -m "feat(reservations): barre d'onglets adaptee mobile (icones + compteurs)"
```

---

## Task 4 : Vérification finale (gate + contrôle visuel)

**Files:** aucun (vérification).

- [ ] **Step 1 : Lancer toute la suite frontend**

Run (depuis `frontend/`) : `npm test -- --watchAll=false`
Attendu : toute la suite verte (dont `Segmented`, `MyReservationsCalendar`, `Pill`).

- [ ] **Step 2 : Type-check complet**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Attendu : 0 erreur.

- [ ] **Step 3 : Contrôle visuel**

Lancer le front (`npm run dev` dans `frontend/`, le backend doit tourner aussi), ouvrir `/me/reservations` connecté :
- Fenêtre **large (≥ 480 px)** : barre identique à aujourd'hui (4 onglets texte, « À venir · N »).
- Fenêtre **étroite (< 480 px, devtools mobile)** : onglets en icône empilée + libellé court, pastilles de compteur sur « À venir » / « Passées », icône de l'onglet actif en couleur d'accent. Aucun débordement, « Matchs » entièrement visible.

- [ ] **Step 4 : Revue finale**

Relire le diff complet (`git diff main...HEAD`) : confirmer qu'aucun fichier hors périmètre (notamment le WIP backend) n'a été touché, et que les 4 fichiers attendus sont bien là.

---

## Self-review (couverture spec)

- **Desktop inchangé** → Task 1 (rendu texte conservé quand pas de mobile) + Task 2 (le CSS ne s'applique qu'à < 480 px) + Task 4 step 3 (contrôle visuel desktop). ✓
- **Mobile : icône empilée + libellé court** → Task 2 (`@media`) + Task 3 (icônes câblées). ✓
- **Compteurs → pastilles** → Task 1 (`.sp-seg-badge`) + Task 2 (style pastille mobile). ✓
- **Icônes `calendar`/`clock`/`check`/`trophy`** → Task 3. ✓
- **Actif = accent, inactif = `textFaint`** → Task 1 (`color={active ? th.accent : th.textFaint}`). ✓
- **Aucun impact sur les 5 autres usages** → Task 1 (rendu sans icône inchangé) + test de non-régression. ✓
- **Seuil 480 px ajustable** → Task 2 (une seule valeur dans le `@media`). ✓
- **Tests existants verts + nouveau test** → Task 1 (nouveau test), Task 3/4 (non-régression). ✓
