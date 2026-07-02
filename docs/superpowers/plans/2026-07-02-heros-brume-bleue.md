# Heros « brume bleue » partout — Plan d'implémentation (Lot 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adoucir tous les grands bandeaux de l'app : le dégradé signature `HERO_GRADIENT` passe en **brume bleue** (lavis clair `#e3edf9 → #c8daf0`) et ses consommateurs basculent en **texte encre** — fiche tournoi, fiche event, hero club-house « À la une », carte partenaire « à la une ».

**Architecture :** `HERO_GRADIENT` est défini à un seul endroit (`components/agenda/AgendaHero.tsx`). On change sa valeur + on passe `AgendaHero`/`HeroPill` en encre ; puis on met à jour les 2 autres consommateurs qui posaient du texte blanc en dur (`HeroAnnouncement`, `PartnerOffers`). Purement visuel, **aucune migration, aucun changement backend**.

**Tech Stack :** Frontend Next.js/React + React Testing Library.

**Spec :** `docs/superpowers/specs/2026-07-02-checkout-reservation-page-design.md` (section « Heros brume bleue »)

> ⚠️ **Prérequis :** ce lot s'applique de préférence **après** le Lot 1 (checkout) — `CheckoutHero` utilise déjà la brume bleue en dur ; à la fin de ce lot, `CheckoutHero` importera `HERO_GRADIENT` pour la DRY (Task 4). Worktree & discipline de test identiques au Lot 1 (suites scopées, tsc, subagents ne committent pas). Les heros posés sur une **image de fond** (`imageUrl`) gardent le texte blanc sur overlay sombre — hors périmètre.

## Inventaire des consommateurs (fait — ne pas re-chercher)

- **Source** : `components/agenda/AgendaHero.tsx` — `HERO_GRADIENT` (l. 12), `HeroPill` (l. 18-30), `AgendaHero` (`color:'#fff'` l. 53, fill `#fff` sur piste `rgba(255,255,255,.25)` l. 64-65, sous-titre `opacity` l. 60, badge places l. 71-74).
- `components/tournament/TournamentHero.tsx` — habillage d'`AgendaHero` (hérite du changement ; **vérifier** qu'il ne pose pas de blanc en dur).
- `components/clubhouse/HeroAnnouncement.tsx` — `background: HERO_GRADIENT` (l. 26) + `color:'#fff'` (l. 41) + CTA `#fff`/`#1d2733` (l. 29).
- `components/clubhouse/PartnerOffers.tsx` — bloc « à la une » `HERO_GRADIENT` + `color:'#fff'` (l. 158), chips `onGradient` blancs (l. 79-102), chevron `rgba(255,255,255,0.8)` (l. 174).
- Pages consommatrices (n'ont pas de couleur en dur, juste les composants) : `app/tournois/[id]/page.tsx`, `app/events/[id]/page.tsx`, `app/cours/[id]/page.tsx`.

## Palette encre-sur-brume (constantes de ce lot)

- Dégradé : `linear-gradient(115deg, #e3edf9, #c8daf0)`.
- Texte principal : `th.text` (`#181510`). Sous-titre : `th.text` à `opacity 0.65` (ou `th.textMute`).
- Pill neutre : fond `rgba(24,21,14,0.06)`, texte `th.text`. Pill `strong` : fond `#fff`, texte `th.text`. Pill `urgent` : fond `ACCENTS.coral`, texte `#fff` (inchangé).
- Jauge : piste `rgba(24,21,14,0.10)`, barre `ACCENTS.blue`.
- Pastille timer (checkout) : fond `#fff`, texte encre — déjà posé en Lot 1.

---

## Task 1 : `AgendaHero` + `HeroPill` — brume bleue + encre

**Files:**
- Modify: `frontend/components/agenda/AgendaHero.tsx`
- Test: `frontend/__tests__/TournamentHero.test.tsx` (assertions de contenu conservées ; vérifier qu'aucune n'assertait `color:'#fff'`)

- [ ] **Step 1 : Changer le dégradé** — l. 12 :
```ts
export const HERO_GRADIENT = `linear-gradient(115deg, #e3edf9, #c8daf0)`;
```
Le const `HERO_NAVY` (l. 9) devient inutilisé → le supprimer (et ajuster le commentaire l. 7-8).

- [ ] **Step 2 : `HeroPill` en encre** — l. 18-30, remplacer le `style` :
```tsx
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontWeight: 700,
      fontSize: 12.5, letterSpacing: 0.3, padding: '5px 11px', borderRadius: 999, whiteSpace: 'nowrap',
      background: urgent ? ACCENTS.coral : strong ? '#fff' : 'rgba(24,21,14,0.06)',
      color: urgent ? '#fff' : th.text,
    }}>
```
(Icône d'urgence : voir Task appelante — le `color="#fff"` passé à `<Icon name="clock">` dans `AgendaHero` l. 57 doit devenir `th.text` quand non urgent ; le countdown urgent garde `#fff` sur coral. Gérer avec une variable locale.)

- [ ] **Step 3 : `AgendaHero` en encre** — dans le JSX (l. 51-77) :
  - div hero (l. 53) : `color: '#fff'` → `color: th.text` ; garder `background: HERO_GRADIENT`.
  - countdown pill (l. 57) : icône `color` = `countdown.urgent ? '#fff' : th.text`.
  - sous-titre (l. 60) : `opacity: 0.85` → `opacity: 0.65` (sur encre).
  - jauge (l. 64-65) : piste `background: 'rgba(24,21,14,0.10)'` ; barre `background: ACCENTS.blue` (au lieu de `#fff`).
  - badge places (l. 71-74) : cas non-urgent `opacity: 0.95` → `opacity: 0.7` ; cas urgent inchangé (coral + `#fff`).
  - `data-testid="agenda-hero"` et `data-testid="hero-fill"` **conservés** (contrat de test).

- [ ] **Step 4 : Vérifier**

Run: `cd frontend && npx jest TournamentHero` → PASS (assertions de contenu inchangées). Si une assertion vérifiait une couleur blanche, la mettre à jour vers la nouvelle valeur.
Run: `cd frontend && npx tsc --noEmit` → OK.

- [ ] **Step 5 : (coordinateur) commit** — `AgendaHero.tsx` (+ test si touché).

---

## Task 2 : `HeroAnnouncement` — texte encre

**Files:**
- Modify: `frontend/components/clubhouse/HeroAnnouncement.tsx`
- Test: `frontend/__tests__/HeroAnnouncement.test.tsx` (existe — vérifier)

- [ ] **Step 1 : Passer la carte en encre**
  - l. 41 : `color: '#fff'` → `color: th.text` (récupérer `th` via `useTheme()` s'il n'est pas déjà en scope).
  - CTA (l. 29) : `background: '#fff', color: '#1d2733'` → conserver un CTA lisible sur brume : `background: th.text, color: th.onAccent`? Non — sur fond clair un CTA encre plein est net : `background: '#181510', color: '#f7f6f0'`. Appliquer.
  - Tout autre `#fff`/`rgba(255,255,255,…)` du composant posé sur le dégradé → encre / `rgba(24,21,14,…)` (relire le fichier entier, il est court ~88 l.). Le cas `imageUrl` (fond image, `heroStyle` = image) **garde le texte blanc** : gater la couleur sur `hasImage` (`color: hasImage ? '#fff' : th.text`).

- [ ] **Step 2 : Vérifier**

Run: `cd frontend && npx jest HeroAnnouncement` → PASS. `tsc` → OK.

- [ ] **Step 3 : (coordinateur) commit.**

---

## Task 3 : `PartnerOffers` (carte « à la une ») — texte encre

**Files:**
- Modify: `frontend/components/clubhouse/PartnerOffers.tsx`
- Test: `frontend/__tests__/PartnerOffers.test.tsx`

- [ ] **Step 1 : Passer le bloc featured en encre**
  - l. 158 : `color: '#fff'` → `color: th.text` sur le bloc `background: HERO_GRADIENT`.
  - chips `onGradient` (l. 79-102) : quand `onGradient` (= sur le dégradé), remplacer `#fff`/`rgba(255,255,255,…)` par encre / `rgba(24,21,14,…)` : bordure `rgba(24,21,14,0.18)`, fond `rgba(24,21,14,0.06)`, texte `th.text` ; l'urgent reste coral+`#fff`.
  - chevron (l. 174) : `color="rgba(255,255,255,0.8)"` → `color={th.textMute}`.
  - Le logo sur tuile blanche (`background:'#fff'`, l. 72) reste **blanc** (c'est une tuile, pas du texte) — inchangé.

- [ ] **Step 2 : Vérifier**

Run: `cd frontend && npx jest PartnerOffers` → PASS. `tsc` → OK.

- [ ] **Step 3 : (coordinateur) commit.**

---

## Task 4 : DRY — `CheckoutHero` réutilise `HERO_GRADIENT` + revue de contraste

**Files:**
- Modify: `frontend/components/checkout/CheckoutHero.tsx` (du Lot 1)
- Test: relance des suites heros + `CheckoutHero`

- [ ] **Step 1 : DRY** — dans `CheckoutHero` (Lot 1), remplacer le dégradé en dur `linear-gradient(115deg, #e3edf9, #c8daf0)` par un `import { HERO_GRADIENT } from '@/components/agenda/AgendaHero'` (les deux valeurs sont désormais identiques → une seule source de vérité). Ne rien changer d'autre.

- [ ] **Step 2 : Revue de contraste (manuelle)** — vérifier sur `/reserver/confirmer`, `/tournois/[id]`, `/events/[id]`, club-house : texte encre lisible sur la brume (ratio largement > 4.5:1), pills lisibles, jauges visibles, les badges coral d'urgence ressortent. Corriger toute couleur oubliée (grep `#fff` sur les fichiers touchés pour repérer un résidu posé sur le dégradé).

- [ ] **Step 3 : Vérifier (scopé)**

Run: `cd frontend && npx jest CheckoutHero TournamentHero HeroAnnouncement PartnerOffers TournamentDetail EventDetail` → tout PASS.
Run: `cd frontend && npx tsc --noEmit` → OK.

- [ ] **Step 4 : (coordinateur) commit.**

---

## Vérification finale

- [ ] `cd frontend && npx jest CheckoutHero TournamentHero HeroAnnouncement PartnerOffers TournamentDetail EventDetail` → PASS ; `tsc` clean.
- [ ] `grep -rn "HERO_NAVY" frontend/` → aucun résultat (const supprimée).
- [ ] `grep -rn "'#fff'" frontend/components/agenda/AgendaHero.tsx frontend/components/clubhouse/HeroAnnouncement.tsx frontend/components/clubhouse/PartnerOffers.tsx` → il ne reste que les blancs **volontaires** (pill `strong`, tuile logo, cas `imageUrl`).
- [ ] (Manuel) Les 4 surfaces (checkout, tournoi, event, club-house) montrent le même hero brume bleue à texte encre, urgence coral lisible.

## Notes

- Purement visuel, **aucune migration ni backend**. `data-testid` conservés (contrat de test).
- Livrable indépendamment du Lot 1 côté code, mais la **Task 4 (DRY)** suppose que `CheckoutHero` (Lot 1) existe — la faire en dernier, ou la sauter si le Lot 1 n'est pas encore mergé (et la reprendre au merge).
- Commits ciblés par fichiers explicites.
