# Cohérence UI/UX — Plan d'exécution des 8 chantiers de l'audit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Résorber les incohérences graphiques/UX relevées par l'audit du 2026-07-17 (rapport : https://claude.ai/code/artifact/61793443-20cd-4c3d-b3e7-04b657b6cbca) — sémantique des erreurs, confirmations, couleurs en dur, deux générations de cartes/boutons/dialogs/titres, bugs visuels ponctuels, retard superadmin.

**Architecture:** 9 lots (A→I) **indépendamment livrables**, ordonnés par gravité. Chaque lot = une passe mécanique guidée par un motif canonique déjà présent dans le design system (`dangerBanner`, `ConfirmDialog`, `cardStyle`, `Btn`…) + quelques nouveaux atomes minces (`RetryButton`, `TopSheetShell`, `PageTitle`, `Loading`, `EmptyState`). 100 % frontend sauf D7 (copies de notifications, backend) — **aucune migration DB nulle part**.

**Tech Stack:** Next.js 16 / React, styles inline via tokens `th` (`frontend/lib/theme.ts`), Jest + RTL, tsc comme gate de types.

---

## Contexte projet pour l'exécutant (à lire avant toute tâche)

- **Répertoire frontend :** `frontend/`. Tous les chemins ci-dessous sont relatifs à la racine du repo `C:\ProjetsIA\05_PERSO\RESERVE\palova`.
- **Shims npm cassés sur ce poste** : jamais `npx jest` / `npx tsc`. Utiliser :
  - Tests : `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/Fichier.test.tsx`
  - Types : `cd frontend; node node_modules/typescript/bin/tsc --noEmit` (scoper la lecture des erreurs à tes fichiers : du WIP parallèle peut exister).
  - Backend : `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/email/__tests__/notifications.reminders.test.ts`
- **Suite complète frontend** : ~6 échecs `BookingModal*` connus en run global (flake d'isolation, passent seuls). Vérifier par suites ciblées.
- **Numéros de ligne** : donnés à titre indicatif (audit du 17/07) — **toujours re-localiser par grep** avant d'éditer, le code bouge.
- **Ne PAS toucher** (points forts à préserver) : `HERO_GRADIENT`/`HERO_INK` (encre fixe voulue), `overflow-x: clip` de `globals.css`, la mécanique SaveBar de settings/profil, `AuthShell`/`ContentShell`, le jumelage Paiements↔Caisse.
- **Commits** : un commit par tâche, message `fix(frontend): …` ou `refactor(frontend): …`, footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Ne jamais pousser sans demande.
- **Vérification visuelle** : la skill projet `verify` (`.claude/skills/verify/SKILL.md`) documente la recette CDP (hôte club `http://padel-arena-paris.localhost:3000`, cookie `token` via login API, thème via `localStorage['palova-theme']`, viewport 390 en `mobile:false`). Comptes : `test@palova.fr`, `owner@palova.fr`, `super@palova.fr` (password123).
- **Décisions produit déjà tranchées pour ce plan** (revalider avec Eric seulement si un test/usage contredit) :
  1. Une erreur ne porte JAMAIS `th.accent` — toujours `dangerBanner(th)`.
  2. CTA noirs de la vitrine plateforme (`AnonymousView`) : **conservés** (choix de marque), hors périmètre du Lot F.
  3. Sur `/club`, quand le club a saisi un `openingHoursText`, le texte libre fait foi : la chip dérivée « Ouvert · jusqu'à… » est masquée dans la carte Infos pratiques (elle reste sur le hero/vitrine).
  4. Notifications : passage au **vouvoiement** (aligné sur toute l'app).

---

## Lot A — Toutes les erreurs passent à `dangerBanner(th)`

Le helper canonique existe déjà :

```ts
// frontend/lib/theme.ts:161 (existant, ne pas modifier)
export function dangerBanner(th: Theme): CSSProperties {
  return {
    background: `${ACCENTS.coral}1f`,
    color: th.danger,
    boxShadow: `inset 0 0 0 1px ${ACCENTS.coral}55`,
    borderRadius: 10,
    padding: '10px 12px',
    fontFamily: th.fontUI,
    fontSize: 13.5,
    fontWeight: 600,
  };
}
```

**Transformation unique appliquée dans tout le lot** — remplacer le style inline du bandeau d'erreur par le helper :

```tsx
// AVANT (motif « bleu accent », le plus répandu — variantes de padding/radius possibles)
{error && (
  <div style={{ background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 14 }}>
    {error}
  </div>
)}

// APRÈS (partout identique)
{error && <div style={dangerBanner(th)}>{error}</div>}
```

+ ajouter `dangerBanner` à l'import existant de `@/lib/theme` (ou créer `import { dangerBanner } from '@/lib/theme';`). Ne pas toucher au texte du message ni aux marges externes (`marginBottom` etc. — les garder sur un wrapper ou les fusionner via `style={{ ...dangerBanner(th), marginBottom: 12 }}`).

### Task A1 : Les 3 panneaux sombres des fiches publiques

**Files:**
- Modify: `frontend/app/tournois/[id]/page.tsx` (~l.193)
- Modify: `frontend/app/events/[id]/page.tsx` (~l.162)
- Modify: `frontend/app/cours/[id]/page.tsx` (~l.166)

- [ ] **Step 1 : Localiser** — `Grep pattern:"#3a1d1d" path:frontend` → exactement 3 fichiers attendus.
- [ ] **Step 2 : Remplacer** dans chacun le bloc `background: '#3a1d1d', color: '#ff6b6b', …` par `style={dangerBanner(th)}` (+ import). Conserver le contenu du message.
- [ ] **Step 3 : Vérifier zéro reste** — `Grep pattern:"#3a1d1d|#ff6b6b" path:frontend` → 0 résultat.
- [ ] **Step 4 : Tests ciblés** — `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentDetail.test.tsx __tests__/EventDetail.test.tsx` (si ces suites n'existent pas sous ces noms exacts : `node node_modules/jest/bin/jest.js -t "tournoi"` pour repérer, puis lancer les suites qui montent ces pages). Attendu : vert.
- [ ] **Step 5 : Commit** — `fix(frontend): fiches publiques - bandeau erreur dangerBanner (audit UI lot A)`

### Task A2 : Les bandeaux coral pleins (admin)

**Files (motif `background: '#ff7a4d', color: '#fff'` ou proche) :**
- Modify: `frontend/app/admin/comptabilite/page.tsx` (~132), `frontend/app/admin/caisse/page.tsx` (~189 et ~288), `frontend/app/admin/packages/page.tsx` (~189), `frontend/app/admin/planning/page.tsx` (~718, ~867), `frontend/components/admin/planning/CreateEventModal.tsx` (~220), `frontend/components/admin/offers/OfferStudio.tsx` (~159), `frontend/components/admin/members/PackageBalanceDialog.tsx` (~85)

- [ ] **Step 1 : Localiser** — `Grep pattern:"background: '#ff7a4d'" path:frontend output_mode:content -n:true` et traiter uniquement les occurrences qui affichent un message d'erreur (pas les pastilles décoratives).
- [ ] **Step 2 : Remplacer** par `dangerBanner(th)` (transformation du lot).
- [ ] **Step 3 : Tests** — suites des pages touchées : `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminPackages.test.tsx __tests__/AdminPlanning.test.tsx __tests__/CreateEventModal.test.tsx __tests__/AdminCaisse.test.tsx` (⚠️ `AdminCaisse` a un échec pré-existant connu — ne corriger que si lié). Attendu : pas de NOUVEL échec.
- [ ] **Step 4 : Commit** — `fix(frontend): bandeaux erreur admin coral plein -> dangerBanner (audit UI lot A)`

### Task A3 : Les bandeaux bleu accent — auth + surfaces joueur

**Files:**
- Modify: `frontend/app/login/page.tsx` (~73), `frontend/app/register/page.tsx` (~79), `frontend/app/forgot-password/page.tsx` (~58), `frontend/components/auth/ResetPasswordForm.tsx` (~70), `frontend/components/auth/VerifyCodeForm.tsx` (~65), `frontend/app/clubs/new/page.tsx` (~97), `frontend/app/courts/[id]/page.tsx` (~151), `frontend/app/me/matches/page.tsx` (~76), `frontend/app/me/reservations/page.tsx` (~205), `frontend/app/me/profile/page.tsx` (~246), `frontend/components/openmatch/OpenMatches.tsx` (~199), `frontend/components/openmatch/OpenMatchDetail.tsx` (~100), `frontend/components/BookingModal.tsx` (~442, ~636)

- [ ] **Step 1 : Localiser précisément** — pour chaque fichier, `Grep pattern:"background: th.accent" -n:true` et ne remplacer QUE les blocs qui rendent `error`/message d'échec (le bleu accent reste légitime pour les CTA/pills actifs).
- [ ] **Step 2 : Remplacer** par `dangerBanner(th)`.
- [ ] **Step 3 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/LoginPage.test.tsx __tests__/RegisterPage.test.tsx __tests__/ForgotPassword.test.tsx __tests__/VerifyCodeForm.test.tsx __tests__/NewClubPage.test.tsx __tests__/MeProfile.test.tsx __tests__/OpenMatches.test.tsx __tests__/BookingModal.test.tsx`. Attendu : vert (BookingModal : lancer seul si flake).
- [ ] **Step 4 : Commit** — `fix(frontend): erreurs auth+joueur en dangerBanner, plus jamais bleu accent (audit UI lot A)`

### Task A4 : Les bandeaux bleu accent — admin + superadmin + dialogs

**Files:**
- Modify: `frontend/app/admin/club/page.tsx` (~138), `frontend/app/admin/courts/page.tsx` (~227), `frontend/app/admin/settings/page.tsx` (~220), `frontend/app/admin/members/page.tsx` (~254), `frontend/app/admin/members/[userId]/page.tsx` (~159), `frontend/app/admin/reservations/page.tsx` (~387), `frontend/app/admin/encaissement/page.tsx` (~391), `frontend/app/admin/announcements/page.tsx` (~83), `frontend/app/admin/sponsors/page.tsx` (~107), `frontend/app/superadmin/sports/page.tsx` (~89), `frontend/components/superadmin/TierChangeDialog.tsx` (~106), `frontend/components/superadmin/ChangeSlugDialog.tsx` (~83), `frontend/components/admin/members/MemberPanel.tsx` (~79)

- [ ] **Step 1–2 :** même localisation + transformation que A3.
- [ ] **Step 3 : Garde anti-régression globale** — `Grep pattern:"background: th\.accent" path:frontend output_mode:content -n:true` : vérifier manuellement que CHAQUE occurrence restante est un élément actif/CTA, aucune n'affiche une erreur.
- [ ] **Step 4 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminSettings.test.tsx __tests__/AdminMembersFilters.test.tsx __tests__/AdminReservations.test.tsx __tests__/AdminEncaissement.test.tsx __tests__/SuperAdminClubs.test.tsx`. Attendu : vert.
- [ ] **Step 5 : Commit** — `fix(frontend): erreurs admin/superadmin en dangerBanner (audit UI lot A)`

### Task A5 : `me/coaching` + `me/refereeing` consomment le helper

**Files:**
- Modify: `frontend/app/me/coaching/page.tsx` (~76-80), `frontend/app/me/refereeing/page.tsx` (~117-121)

- [ ] **Step 1 :** Ces deux pages réimplémentent à la main le lavis coral (bon rendu, mauvaise duplication). Remplacer l'objet inline par `dangerBanner(th)`, supprimer le style local.
- [ ] **Step 2 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeCoaching.test.tsx __tests__/MeRefereeing.test.tsx` (adapter les noms si besoin via `ls frontend/__tests__ | findstr -i "coach referee"`). Attendu : vert.
- [ ] **Step 3 : tsc** — `node node_modules/typescript/bin/tsc --noEmit` (aucune nouvelle erreur dans les fichiers du lot).
- [ ] **Step 4 : Vérif visuelle** — via la skill `verify` : forcer une erreur est difficile ; capturer au minimum `/login` (soumettre vide déclenche l'erreur ? sinon capture statique) en clair + sombre pour valider le lavis coral. Alternative rapide : monter `LoginPage.test` déjà vert et s'appuyer sur A3.
- [ ] **Step 5 : Commit** — `refactor(frontend): coaching/refereeing consomment dangerBanner (audit UI lot A)`

---

## Lot B — Confirmations : plus aucune destruction muette, plus de `window.confirm`

`ConfirmDialog` (existant, `frontend/components/ui/ConfirmDialog.tsx`) — props : `title`, `detail?`, `message?`, `confirmLabel?` (défaut « Confirmer »), `cancelLabel?` (défaut « Retour »), `busy?`, `confirmDisabled?`, `onConfirm`, `onCancel`.

**Motif canonique du lot** (état + dialog) :

```tsx
const [pendingDelete, setPendingDelete] = useState<string | null>(null); // id à supprimer

// Le bouton Supprimer n'appelle plus remove(id) mais :
<button onClick={() => setPendingDelete(s.id)}>Supprimer</button>

// En fin de JSX de la page :
{pendingDelete && (
  <ConfirmDialog
    title="Supprimer ?"
    message="Cette action est définitive."
    confirmLabel="Supprimer"
    onConfirm={() => { const id = pendingDelete; setPendingDelete(null); remove(id); }}
    onCancel={() => setPendingDelete(null)}
  />
)}
```

### Task B1 : Sponsors — suppression confirmée (TDD)

**Files:**
- Modify: `frontend/app/admin/sponsors/page.tsx` (~l.94, fonction `remove`)
- Test: `frontend/__tests__/AdminSponsors.test.tsx` (créer si absent — vérifier d'abord : `ls frontend/__tests__ | findstr -i sponsor`)

- [ ] **Step 1 : Écrire le test qui échoue** — dans la suite existante (ou une nouvelle, en copiant le boilerplate de mocks d'une suite admin voisine comme `AdminAnnouncements.test.tsx` : mock `ThemeProvider`, `useAuth`, `useClub`, `api`) :

```tsx
it('demande confirmation avant de supprimer un partenaire', async () => {
  render(<AdminSponsorsPage />);
  await screen.findByText('Babolat');                       // ligne seedée par le mock api
  fireEvent.click(screen.getAllByText('Supprimer')[0]);
  expect(api.adminDeleteSponsor).not.toHaveBeenCalled();    // rien avant confirmation
  fireEvent.click(screen.getByText('Supprimer', { selector: 'button:last-of-type' })); // bouton du dialog
  await waitFor(() => expect(api.adminDeleteSponsor).toHaveBeenCalledWith(expect.anything(), 'sp-1', expect.anything()));
});
```

(Adapter les noms `adminDeleteSponsor`/`sp-1` aux vrais noms lus dans la page — étape de lecture obligatoire avant d'écrire le test.)
- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminSponsors.test.tsx` → FAIL (la suppression part immédiatement).
- [ ] **Step 3 : Implémenter** le motif canonique du lot dans la page.
- [ ] **Step 4 : Vérifier le vert** — même commande → PASS.
- [ ] **Step 5 : Commit** — `fix(admin): confirmation avant suppression d'un partenaire (audit UI lot B)`

### Task B2 : Annonces — suppression confirmée

**Files:**
- Modify: `frontend/app/admin/announcements/page.tsx` (~l.64)
- Test: `frontend/__tests__/AdminAnnouncements.test.tsx` (existant)

- [ ] **Step 1 :** Ajouter à la suite existante le même test que B1 (adapté : `adminDeleteAnnouncement`). Vérifier l'échec.
- [ ] **Step 2 :** Implémenter le motif canonique. Vérifier le vert.
- [ ] **Step 3 : Commit** — `fix(admin): confirmation avant suppression d'une annonce (audit UI lot B)`

### Task B3 : Events — suppression confirmée

**Files:**
- Modify: `frontend/app/admin/events/page.tsx` (~l.69, `removeEvent`)
- Test: `frontend/__tests__/AdminEvents.test.tsx` (existant)

- [ ] **Step 1 :** Même démarche que B2 (le bouton « Supprimer » n'apparaît que sur un event à 0 inscrit — reprendre la fixture existante de la suite qui l'affiche). Test rouge → implémentation → vert.
- [ ] **Step 2 : Commit** — `fix(admin): confirmation avant suppression d'un event (audit UI lot B)`

### Task B4 : Éradiquer `window.confirm`

**Files:**
- Modify: `frontend/app/admin/planning/page.tsx` (~583), `frontend/app/admin/pages/page.tsx` (~179 et ~256), `frontend/app/superadmin/sports/page.tsx` (~70)

- [ ] **Step 1 : Localiser** — `Grep pattern:"window.confirm|confirm\(" path:frontend/app output_mode:content -n:true` → 4 occurrences attendues.
- [ ] **Step 2 : Remplacer** chacune par le motif canonique `ConfirmDialog` (état `pendingX` + dialog), libellés en français décrivant l'objet (« Supprimer cette page ? », « Supprimer ce sport du catalogue ? », etc.).
- [ ] **Step 3 : Vérifier zéro reste** — même grep → 0.
- [ ] **Step 4 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminPlanning.test.tsx` + tsc. Attendu : vert.
- [ ] **Step 5 : Commit** — `fix(frontend): window.confirm -> ConfirmDialog partout (audit UI lot B)`

---

## Lot C — Couleurs sémantiques : zéro hex sauvage

### Task C1 : Nouveau token `successInk` (TDD léger via tsc)

**Files:**
- Modify: `frontend/lib/theme.ts`

- [ ] **Step 1 :** Ajouter au type `Theme` (près de `danger`/`success`/`warning`, ~l.68-73) :

```ts
  /** Vert de succès LISIBLE en texte sur fond neutre (le vert vif success sert aux fonds/jauges). */
  successInk: string;
```

et dans les deux palettes : daylight (~l.108) `successInk: '#1c7a4f',` — floodlit (~l.136) `successInk: ACCENTS.emerald,`.
- [ ] **Step 2 :** `node node_modules/typescript/bin/tsc --noEmit` → vert.
- [ ] **Step 3 : Commit** — `feat(frontend): token th.successInk (audit UI lot C)`

### Task C2 : Supprimer les 7 `const CORAL` locales

**Files:**
- Modify: `frontend/app/admin/encaissement/page.tsx:23`, `frontend/app/admin/reservations/page.tsx:22`, `frontend/app/admin/members/page.tsx:37`, `frontend/components/admin/caisse/QueueList.tsx:9`, `frontend/components/admin/caisse/CashRegister.tsx:14`, `frontend/components/admin/ReservationCollect.tsx:12`, `frontend/components/admin/CollectPanel.tsx:20`

- [ ] **Step 1 :** Dans chaque fichier, supprimer `const CORAL = '#ff7a4d';` et remplacer les usages par `ACCENTS.coral` (import `ACCENTS` depuis `@/lib/theme`).
- [ ] **Step 2 :** `Grep pattern:"const CORAL" path:frontend` → 0.
- [ ] **Step 3 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminEncaissement.test.tsx __tests__/AdminReservations.test.tsx __tests__/CashRegister.test.tsx __tests__/CollectPanel.test.tsx` → vert.
- [ ] **Step 4 : Commit** — `refactor(frontend): const CORAL locales -> ACCENTS.coral (audit UI lot C)`

### Task C3 : Sweep des `#ff7a4d` restants

**Files:** ~45 occurrences restantes dans ~26 fichiers (hors `theme.ts` et `playerColors.ts`, seuls dépositaires légitimes).

- [ ] **Step 1 : Inventaire** — `Grep pattern:"#ff7a4d" path:frontend output_mode:content -n:true`.
- [ ] **Step 2 : Règle de remplacement, appliquée occurrence par occurrence :**
  - le hex exprime une **erreur / un danger / un impayé** (texte) → `th.danger` ;
  - il exprime une **urgence / un accent décoratif** (chip countdown, liseré, jauge) → `ACCENTS.coral` ;
  - il sert de **fond de lavis** `#ff7a4d1a`-style → `` `${ACCENTS.coral}1f` `` (aligné sur `dangerBanner`).
- [ ] **Step 3 : Garde** — `Grep pattern:"#ff7a4d" path:frontend` → uniquement `lib/theme.ts` + `lib/playerColors.ts`.
- [ ] **Step 4 :** tsc + suites des fichiers les plus touchés (au minimum `__tests__/caisse.test.ts`, `__tests__/OpenMatchCard.test.tsx`). Attendu : vert.
- [ ] **Step 5 : Commit** — `refactor(frontend): plus de coral en dur hors palette (audit UI lot C)`

### Task C4 : Unifier les verts « succès »

**Files (occurrences relevées) :** `frontend/components/admin/PaymentDots.tsx:6` (`SETTLED_COLOR #34b888`), `frontend/lib/reservationType.ts:5` (`COACHING #34b888`), `frontend/app/club/page.tsx:147` (`#34b27b` en dur), `frontend/app/admin/tournaments/page.tsx:293` + `frontend/app/admin/events/page.tsx:242` (`'#1c7a4f'`), `frontend/app/admin/moderation/page.tsx:196,198` (`'#1b7a4e'`), `frontend/components/admin/members/MemberRow.tsx:103` (`#2c7a44`), `frontend/components/admin/ventes/TrendKpis.tsx:10` (`#1f7a4f`), `frontend/components/coach/ReliabilityMeter.tsx:10` (`#1f9d55`), `frontend/components/player/LevelHistoryChart.tsx:31` (`#15803d`), `frontend/components/booking/BookingSuccess.tsx:55` + `frontend/components/BookingModal.tsx:458` (`#15803d` + `rgba(34,197,94,0.13)`)

- [ ] **Step 1 :** Remplacements :
  - tout vert **foncé de texte** (`#1c7a4f`, `#1b7a4e`, `#2c7a44`, `#1f7a4f`, `#1f9d55`, `#15803d`) → `th.successInk` (supprimer les ternaires `th.mode === 'floodlit' ? ACCENTS.emerald : '#…'` devenus inutiles) ;
  - tout vert **moyen décoratif** (`#34b888`, `#34b27b` en dur) → `ACCENTS.emerald` ;
  - le fond `rgba(34,197,94,0.13)` → `` `${th.success}22` ``.
- [ ] **Step 2 : Garde** — `Grep pattern:"#15803d|#34b888|#1c7a4f|#1b7a4e|#2c7a44|#1f7a4f|#1f9d55" path:frontend` → 0.
- [ ] **Step 3 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/BookingSuccess.test.tsx __tests__/MemberRow.test.tsx __tests__/AdminTournaments.test.tsx` + tsc → vert.
- [ ] **Step 4 : Commit** — `refactor(frontend): verts succes -> th.success/successInk/ACCENTS.emerald (audit UI lot C)`

### Task C5 : Unifier les ambres « avertissement »

**Files:** `frontend/app/admin/payments/page.tsx:13-16` (points de statut `#9ca3af/#f59e0b/#22c55e`), `frontend/components/BookingModal.tsx:126` (`#b45309`/`#fde9c8`), `frontend/components/admin/members/MemberRow.tsx:103` (`#fdeee2`/`#b45309`), `frontend/components/ui/SaveBar.tsx:34` (`#fbbf24`)

- [ ] **Step 1 :** `#f59e0b`, `#b45309`, `#fbbf24` → `th.warning` ; lavis clairs fixes (`#fde9c8`, `#fdeee2`) → `` `${th.warning}22` `` ; `#9ca3af` → `th.textFaint` ; `#22c55e` en dur → `th.success`. **Exception assumée** : le jaune « en calibrage » `#ffb020` de `LevelChip`/`LevelBadge` est traité en C6.
- [ ] **Step 2 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/SaveBar.test.tsx __tests__/BookingModal.test.tsx` → vert.
- [ ] **Step 3 : Commit** — `refactor(frontend): ambres avertissement -> th.warning (audit UI lot C)`

### Task C6 : Composants aveugles au thème sombre

**Files:**
- Modify: `frontend/components/player/LevelHistoryChart.tsx` (courbe `#2563eb` → `th.accent` ; pastilles `#dcf3e3`/`#fde2e2` → `` `${th.success}22` `` / `` `${th.danger}22` `` avec encres `th.successInk`/`th.danger`)
- Modify: `frontend/components/player/LevelChip.tsx` + `frontend/components/player/LevelBadge.tsx` (fond `rgba(0,0,0,0.06)` → `th.surface2` ; LevelBadge : convertir les classes Tailwind en styles inline consommant les mêmes tokens que LevelChip — même fond, même encre, le jaune calibrage `#ffb020` passe en `th.warning`)

- [ ] **Step 1 :** Appliquer les remplacements ci-dessus (LevelBadge garde son API/props, seul le styling change).
- [ ] **Step 2 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MemberHistory.test.tsx __tests__/ProfileHero.test.tsx` (consommateurs de la courbe et du badge) → vert. tsc → vert.
- [ ] **Step 3 : Vérif visuelle** — skill `verify` : `/me/profile?tab=niveau` en **floodlit** 1280 : courbe et pastilles lisibles.
- [ ] **Step 4 : Commit** — `fix(frontend): niveau (courbe, chips) lisible en theme sombre (audit UI lot C)`

---

## Lot D — Bugs visuels ponctuels (quick wins des captures)

### Task D1 : « SUBSCRIPTION » traduit en Comptabilité

**Files:**
- Modify: le `Record` `METHOD_LABEL` consommé par `frontend/lib/accounting.ts:29` (localiser : `Grep pattern:"METHOD_LABEL" path:frontend/lib output_mode:content -n:true` — probablement `lib/caisse.ts`)
- Test: la suite du fichier porteur (`frontend/__tests__/caisse.test.ts` ou `accounting.test.ts`)

- [ ] **Step 1 : Test rouge** — ajouter :

```ts
it('traduit SUBSCRIPTION (couverture abonnement auto)', () => {
  expect(methodLabel('SUBSCRIPTION')).toBe('Abonnement (auto)');
});
```

Run → FAIL (renvoie « SUBSCRIPTION » brut, le repli `?? method` de `methodLabel`).
- [ ] **Step 2 :** Ajouter l'entrée `SUBSCRIPTION: 'Abonnement (auto)'` au record (avec cast élargi si `PaymentMethod` ne contient pas la valeur : typer le record `Record<string, string>` localement ou étendre l'union — suivre le style du fichier).
- [ ] **Step 3 :** Run → PASS. **Commit** — `fix(frontend): libelle francais du moyen SUBSCRIPTION en compta (audit UI lot D)`

### Task D2 : Montants du dashboard admin en format français

**Files:**
- Modify: `frontend/app/admin/page.tsx:90-91`

- [ ] **Step 1 :** Remplacer :

```tsx
// AVANT
<StatCard label="Encaissé (confirmées)" value={data ? data.summary.paidTotal : '—'} unit="€" icon="euro" hint="aujourd'hui" />
<StatCard label="Total du jour" value={data ? data.summary.total : '—'} unit="€" icon="chart" hint="toutes réservations" />

// APRÈS — fmtAmount("32.25") → "32,25 €" (helper existant, déjà utilisé par la compta)
import { fmtAmount } from '@/lib/accounting';
<StatCard label="Encaissé (confirmées)" value={data ? fmtAmount(data.summary.paidTotal) : '—'} icon="euro" hint="aujourd'hui" />
<StatCard label="Total du jour" value={data ? fmtAmount(data.summary.total) : '—'} icon="chart" hint="toutes réservations" />
```

(Si `StatCard` stylise `unit` séparément et que le rendu est moins bon sans, alternative : garder `unit="€"` et passer `value={fmtAmount(...).replace(/\s*€$/, '')}` — choisir au rendu.)
- [ ] **Step 2 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminDashboard.test.tsx` (adapter les assertions qui attendaient « 32.25 »). Attendu : vert.
- [ ] **Step 3 : Commit** — `fix(admin): montants dashboard au format fr (virgule) (audit UI lot D)`

### Task D3 : Casse et formats d'heure côté admin

**Files:**
- Modify: `frontend/app/admin/planning/page.tsx:99` (en-tête « Vendredi 17 Juillet »)
- Modify: `frontend/components/admin/caisse/QueueList.tsx` + l'en-tête de `frontend/components/admin/caisse/CashRegister.tsx` (heures « 22:30 »)

- [ ] **Step 1 (casse) :** l'Intl `fr-FR` renvoie « vendredi 17 juillet » ; la capitale double vient d'un `textTransform: 'capitalize'` sur le style de l'en-tête (le localiser au point d'usage du label l.99). Le retirer et capitaliser seulement la 1re lettre :

```ts
const raw = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
return raw.charAt(0).toUpperCase() + raw.slice(1); // « Vendredi 17 juillet »
```

- [ ] **Step 2 (heures) :** localiser le format « HH:MM » dans QueueList/CashRegister (`Grep pattern:"toLocaleTimeString|getMinutes|padStart" path:frontend/components/admin/caisse -n:true`) et le convertir au format maison « 22h30 » — réutiliser le helper d'heure de `frontend/lib/tournament.ts` (format « 17h00 ») au lieu d'un format local.
- [ ] **Step 3 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminPlanning.test.tsx __tests__/CashRegister.test.tsx __tests__/caisseRegister.test.ts` (adapter les assertions « 22:30 »). Attendu : vert.
- [ ] **Step 4 : Commit** — `fix(admin): casse date planning + heures 22h30 en caisse (audit UI lot D)`

### Task D4 : Page `/club` — adresse dupliquée + contradiction horaires

**Files:**
- Modify: `frontend/app/club/page.tsx` (~l.152 adresse ; carte « Infos pratiques » pour la chip)

- [ ] **Step 1 (adresse) :**

```tsx
// AVANT
<div>{club.address}{club.city ? `, ${club.city}` : ''} — <a …>Itinéraire →</a></div>

// APRÈS — ne pas répéter la ville si l'adresse la contient déjà
const addressLine = club.city && !club.address.toLowerCase().includes(club.city.toLowerCase())
  ? `${club.address}, ${club.city}`
  : club.address;
<div>{addressLine} — <a …>Itinéraire →</a></div>
```

- [ ] **Step 2 (horaires) :** dans la carte Infos pratiques, la chip dérivée (`openNowChip`) ne s'affiche plus si le club a saisi un texte libre :

```tsx
{!pres?.openingHoursText && chip && <ChipHoraires …/>}   // le texte libre fait foi (décision n°3)
{pres?.openingHoursText && <div …>{pres.openingHoursText}</div>}
```

(La chip reste inchangée sur le hero et dans `ClubShowcase` — ne toucher que la carte Infos pratiques.)
- [ ] **Step 3 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubPage.test.tsx` + ajouter un cas :

```tsx
it("n'affiche pas deux fois la ville quand l'adresse la contient", async () => {
  // fixture : address "12 rue du Padel, 75011 Paris", city "Paris"
  render(<ClubPage />);
  expect(await screen.findByText(/12 rue du Padel, 75011 Paris —/)).toBeInTheDocument();
  expect(screen.queryByText(/Paris, Paris/)).toBeNull();
});
```

- [ ] **Step 4 : Commit** — `fix(frontend): /club sans ville dupliquee ni horaires contradictoires (audit UI lot D)`

### Task D5 : Vouvoiement des notifications (backend + réglages)

**Files:**
- Modify: `backend/src/email/notifications.ts` (copies in-app/push des rappels et ajouts)
- Modify: `frontend/app/me/notifications/settings/page.tsx` (~81, ~94)
- Test: `backend/src/email/__tests__/notifications.reminders.test.ts` (assertions de copie à adapter)

- [ ] **Step 1 : Inventaire** — `Grep pattern:"\bTa \b|\bta réservation|\bTu as|Choisis comment|Installe Palova|\bton écran" path:backend/src,frontend/app/me/notifications -n:true`.
- [ ] **Step 2 : Remplacements** (table exhaustive — compléter au même format si le grep révèle d'autres formes) :
  - « Ta partie est dans 2 h » → « Votre partie est dans 2 h »
  - « Ta réservation {X} » → « Votre réservation {X} »
  - « Tu as été ajouté à une réservation par le club. » → « Vous avez été ajouté à une réservation par le club. »
  - « Choisis comment tu veux être prévenu » → « Choisissez comment vous voulez être prévenu »
  - « Installe Palova sur ton écran d'accueil » → « Installez Palova sur votre écran d'accueil »
- [ ] **Step 3 : Tests backend** — `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/email/__tests__/notifications.reminders.test.ts` (mettre à jour les snapshots/assertions de texte) → vert.
- [ ] **Step 4 : Commit** — `fix: notifications au vouvoiement, aligne sur toute l'app (audit UI lot D)`

### Task D6 : Profil — double label « SPORT PRÉFÉRÉ »

**Files:**
- Modify: `frontend/components/profile/tabs/ProfileIdentity.tsx` (section sport : `CardKicker` « Sport préféré » + `FieldShell` portant le même label)
- Modify: `frontend/components/profile/ProfileFields.tsx` (rendre le label de `FieldShell` optionnel si nécessaire)

- [ ] **Step 1 :** Supprimer le label VISIBLE dupliqué du `FieldShell` de la section sport (garder le `CardKicker`). Préserver l'accessibilité : le groupe de `PillChoice` garde un `aria-label="Sport préféré"` (contrat des tests `MeProfile`).
- [ ] **Step 2 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeProfile.test.tsx __tests__/ProfileFields.test.tsx` → vert (les requêtes par rôle/aria doivent passer inchangées).
- [ ] **Step 3 : Commit** — `fix(frontend): profil - label Sport prefere affiche une seule fois (audit UI lot D)`

### Task D7 : `/tournois` national — chrome de page + compteurs de facettes

**Files:**
- Modify: `frontend/app/tournois/page.tsx` (branche plateforme : envelopper le `TournamentFinder` du même chrome que `frontend/app/tarifs/page.tsx` — logo + bouton retour Accueil ; lire tarifs/page.tsx et reproduire sa structure d'en-tête, ContentShell si c'est lui)
- Modify: `frontend/components/calendar/FacetPanel.tsx` (chips à compteur)

- [ ] **Step 1 (chrome) :** ouvrir `frontend/app/tarifs/page.tsx`, identifier la coquille (en-tête logo Palova + `BackButton` « Accueil » + footer) et appliquer la même au rendu plateforme de `/tournois`. Le Finder lui-même ne change pas.
- [ ] **Step 2 (compteurs) :** dans `FacetPanel`, séparer visuellement le compteur du libellé de chip :

```tsx
// AVANT (le compte se lit comme faisant partie du nom : « Paris 2 »)
<button …>{label} {count}</button>

// APRÈS
<button …>
  {label}
  <span aria-hidden style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
</button>
```

(Repérer le rendu exact par `Grep pattern:"count" path:frontend/components/calendar/FacetPanel.tsx -n:true` et appliquer le même traitement à toutes les chips à compteur du fichier.)
- [ ] **Step 3 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetPanel.test.tsx __tests__/TournamentFinder.test.tsx` → vert.
- [ ] **Step 4 : Vérif visuelle** — skill `verify` : `http://localhost:3000/tournois` anonyme, 1280 : en-tête présent, retour Accueil, compteurs distincts du libellé.
- [ ] **Step 5 : Commit** — `fix(frontend): calendrier national - chrome plateforme + compteurs de facettes lisibles (audit UI lot D)`

### Task D8 : `DateSelector` — horloge posée en effet (hydration)

**Files:**
- Modify: `frontend/components/DateSelector.tsx` (~l.45 `const today = new Date()`)

- [ ] **Step 1 :** Appliquer la convention maison :

```tsx
// AVANT
const today = new Date();

// APRÈS — horloge posée au montage, null avant hydration (convention projet)
const [today, setToday] = useState<Date | null>(null);
useEffect(() => { setToday(new Date()); }, []);
```

puis garder tous les calculs dérivés (« AUJ », jours passés/désactivés) derrière `today &&` — avant hydration, rendre la bande SANS marquage « aujourd'hui/passé » (aucun jour désactivé), l'effet raffine dès le montage.
- [ ] **Step 2 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubReserve.deeplink.test.tsx __tests__/ClubReserve.view.test.tsx` (suites *real-mount* qui traversent DateSelector) → vert.
- [ ] **Step 3 : Commit** — `fix(frontend): DateSelector hydration-safe (horloge en effet) (audit UI lot D)`

### Task D9 : `LiveDot` respecte `prefers-reduced-motion`

**Files:**
- Modify: `frontend/components/ui/atoms.tsx` (~l.145, `LiveDot`)
- Modify: `frontend/app/globals.css`

- [ ] **Step 1 :** Donner une classe au dot animé (`className="sp-live-dot"` sur l'élément portant `animation: 'sp-ping …'`) et ajouter dans `globals.css` :

```css
@media (prefers-reduced-motion: reduce) {
  .sp-live-dot { animation: none !important; }
}
```

- [ ] **Step 2 :** tsc + `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/atoms.test.tsx` (si la suite existe) → vert. **Commit** — `fix(frontend): LiveDot sans animation sous prefers-reduced-motion (audit UI lot D)`

### Task D10 : Diagnostic — « Nos partenaires » vide à 390 px

**Files:**
- Investigate/Modify: `frontend/components/clubhouse/SponsorFlipDeck.tsx`

- [ ] **Step 1 : Reproduire** — skill `verify` : club-house connecté, viewport **390 en `mobile:false`**, thème clair. Constat attendu : titre « Nos partenaires » sans cartes (elles s'affichent en 1280).
- [ ] **Step 2 : Diagnostiquer** — suspects par ordre : (a) `.fd-scene { width: 150px }` dans un conteneur flex qui passe sous 0 de largeur disponible ; (b) hauteur du deck effondrée (cartes en `position: absolute` sans hauteur réservée sur le layout étroit) ; (c) contenu poussé hors viewport puis coupé par `overflow-x: clip`. Inspecter via CDP (`getBoundingClientRect` des `.fd-scene`).
- [ ] **Step 3 : Corriger** selon le diagnostic (ex. : conteneur `flexWrap: 'wrap'` + `minWidth: 0`, ou hauteur explicite du deck). **Critère d'acceptation :** les cartes Babolat/Decathlon visibles à 390 ET toujours correctes à 1280, clair + sombre.
- [ ] **Step 4 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/SponsorFlipDeck.test.tsx` → vert. Re-capture 390 → cartes visibles.
- [ ] **Step 5 : Commit** — `fix(frontend): rivière partenaires visible en mobile 390 (audit UI lot D)`

### Task D11 : Diagnostic — kicker de sport tronqué sur le rail des offres

**Files:**
- Investigate/Modify: `frontend/components/clubhouse/OffersShowcase.tsx` (~l.151 : kicker `scrollSnapAlign: 'start'`, `maxWidth: 76`)

- [ ] **Step 1 : Reproduire** — capture club-house 1280 ET 390 : au chargement, le premier kicker (« PADEL ») n'apparaît que par sa dernière lettre au bord gauche du rail.
- [ ] **Step 2 : Cause suspectée** — le scroll-snap initial s'aligne sur la **première carte** (snap `start`), poussant le kicker qui la précède hors du viewport du rail.
- [ ] **Step 3 : Corriger** — pistes concrètes : retirer `scrollSnapAlign` du kicker et poser `scrollPaddingLeft: 90` sur le conteneur scrollable ; OU regrouper `kicker + première carte du groupe` dans un wrapper flex qui porte seul le `scrollSnapAlign: 'start'`. **Critère :** au chargement, « PADEL » entièrement lisible avant la première carte, à 390 et 1280.
- [ ] **Step 4 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OffersShowcase.test.tsx` (le testid `offer-sport-kicker` existe déjà) → vert. Re-captures OK.
- [ ] **Step 5 : Commit** — `fix(frontend): kicker de sport du rail offres jamais tronque (audit UI lot D)`

### Task D12 : Diagnostic — « 14 terrains » (vitrine) vs « 15 terrains » (annuaire)

**Files:**
- Investigate: `frontend/lib/clubShowcase.ts` (`courtsSummary`) vs le compteur de l'annuaire plateforme (`frontend/components/ClubDirectory.tsx` ou équivalent — localiser par `Grep pattern:"terrains" path:frontend/components -n:true`)

- [ ] **Step 1 :** Comparer les deux sources : `courtsSummary` compte `clubSports[].resources` (payload club) ; l'annuaire compte probablement un agrégat backend différent (ressources inactives incluses ?). Identifier la différence exacte via les payloads (`curl http://localhost:3001/api/clubs/padel-arena-paris` vs l'endpoint de l'annuaire).
- [ ] **Step 2 :** Aligner les deux sur la même définition : **ressources actives réservables**. Corriger le côté qui compte trop (probablement l'annuaire qui inclut une ressource désactivée) — si le fix est backend (select/count), il est additif et sans migration.
- [ ] **Step 3 : Critère :** le même nombre partout pour club-demo. Tests des suites touchées + commit — `fix: compte de terrains coherent vitrine/annuaire (audit UI lot D)`

### Task D13 : Icône « Espace club » distincte du toggle de thème

**Files:**
- Modify: `frontend/components/ClubNav.tsx` (icône du lien `/admin`)
- Investigate: `frontend/components/ui/Icon.tsx` (choisir un glyphe existant non ambigu)

- [ ] **Step 1 :** Lister les noms disponibles (`Grep pattern:"case '" path:frontend/components/ui/Icon.tsx -o:true`). Choisir un glyphe qui ne ressemble ni au soleil ni à la lune — par ordre de préférence : `wrench`, `briefcase`, `shield`, sinon `home`.
- [ ] **Step 2 :** Remplacer le nom d'icône du lien Espace club dans `ClubNav`. L'`aria-label` « Espace club » ne change pas.
- [ ] **Step 3 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubNav.test.tsx` → vert. **Commit** — `fix(frontend): icone Espace club non confondable avec le toggle theme (audit UI lot D)`

### Task D14 : `/reserver` — message quand la journée est écoulée

**Files:**
- Modify: `frontend/components/ClubReserve.tsx` (rendu carte terrain, autour du repli des passés — helper `splitPastSlots` de `lib/reserveView.ts`)

- [ ] **Step 1 : Test rouge** — dans `frontend/__tests__/ClubReserve.pastslots.test.tsx`, ajouter :

```tsx
it("affiche « Plus de créneaux aujourd'hui » quand tout est passé", async () => {
  // fixture : dispo du jour entièrement passée (slots < now), aucun futur
  render(<ClubReserve />);
  expect(await screen.findAllByText(/Plus de créneaux aujourd'hui/)).not.toHaveLength(0);
});
```

Run → FAIL.
- [ ] **Step 2 :** Dans le rendu carte, quand `future.length === 0 && past.length > 0`, afficher sous le chip « ‹ N passés » :

```tsx
<div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
  Plus de créneaux aujourd'hui — essayez un autre jour.
</div>
```

- [ ] **Step 3 :** Run → PASS. Suites `ClubReserve.*` ciblées vertes. **Commit** — `fix(frontend): message jour ecoule sur Reserver (audit UI lot D)`

---

## Lot E — Cartes : `cardStyle(th)` devient la source unique

### Task E1 : Déménager `cardStyle` dans `theme.ts` (compat préservée)

**Files:**
- Modify: `frontend/lib/theme.ts` (ajout)
- Modify: `frontend/components/clubhouse/SectionHeader.tsx` (ré-export)

- [ ] **Step 1 :** Copier la fonction dans `theme.ts` (import `React` type inutile — utiliser `CSSProperties` déjà importé) :

```ts
/** Carte à ombre douce — LE langage carte du site (remplace les liserés inset). */
export function cardStyle(th: Theme): CSSProperties {
  return {
    background: th.surface,
    borderRadius: 18,
    boxShadow: th.mode === 'floodlit'
      ? `0 14px 34px rgba(0,0,0,0.42), inset 0 0 0 1px ${th.line}`
      : '0 14px 34px rgba(24,21,16,0.08), 0 1px 2px rgba(24,21,16,0.05)',
  };
}
```

- [ ] **Step 2 :** Dans `SectionHeader.tsx`, supprimer la définition locale et ré-exporter : `export { cardStyle } from '@/lib/theme';` (aucun consommateur existant ne casse).
- [ ] **Step 3 :** tsc → vert ; `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubHouse.test.tsx` → vert. **Commit** — `refactor(frontend): cardStyle exporte par theme.ts (audit UI lot E)`

### Task E2 : Tuer le `cardStyle` local trompeur

**Files:**
- Modify: `frontend/components/calendar/MyAgendaListItem.tsx:192`

- [ ] **Step 1 :** Supprimer le `const cardStyle` local (liseré inset + radius 20), importer `cardStyle` depuis `@/lib/theme`, appliquer `...cardStyle(th)` en conservant le padding local.
- [ ] **Step 2 :** `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MyAgendaListItem.test.tsx __tests__/MonthCalendar.test.tsx` → vert. **Commit** — `refactor(frontend): MyAgendaListItem sur le cardStyle canonique (audit UI lot E)`

### Task E3 : Migration des cartes admin (batch 1)

**Files (surfaces « carte pleine » encore en liseré) :** `frontend/app/admin/page.tsx` (StatCard/NavCard, l.16/35), `frontend/app/admin/club/page.tsx:37`, `frontend/app/admin/courts/page.tsx:338`, `frontend/app/admin/sponsors/page.tsx:109`, `frontend/app/admin/members/[userId]/page.tsx:45,59`, `frontend/app/admin/comptabilite/page.tsx:69`, `frontend/components/admin/settings/shared.ts:17` (style `card`), `frontend/components/admin/ClubHouseSectionsCard.tsx:112`, `frontend/components/admin/members/MemberPanel.tsx:142`, `frontend/components/coach/LevelOverrideForm.tsx:71`

**Règle du lot :** ne migrer que les VRAIES cartes (conteneur avec padding + fond `th.surface`/`bgElev`). Les `inset` de jauges, pistes, anneaux, bords de pills **restent**.

- [ ] **Step 1 :** Pour chaque style de carte : remplacer `background: …, borderRadius: N, boxShadow: 'inset 0 0 0 1px ' + th.line` par `...cardStyle(th)` (radius 18 unifié ; garder le padding existant).
- [ ] **Step 2 : Tests** — suites des pages touchées (`AdminDashboard`, `AdminClub`, `MemberHistory`, `AdminSettings`) → vert. tsc → vert.
- [ ] **Step 3 : Vérif visuelle** — skill `verify` : `/admin` + `/admin/members/[userId]` (owner@), clair + sombre, 1280.
- [ ] **Step 4 : Commit** — `refactor(admin): cartes en ombre douce cardStyle, batch 1 (audit UI lot E)`

### Task E4 : Migration des cartes joueur/agenda (batch 2)

**Files:** `frontend/components/agenda/AgendaCard.tsx:20`, `frontend/components/agenda/MetaCardsRow.tsx` (radius 14 → 18 si carte), `frontend/components/openmatch/OpenMatchCard.tsx:76`, `frontend/components/openmatch/Leaderboard.tsx:90`, `frontend/components/calendar/DayPanel.tsx:56`, `frontend/components/calendar/MonthCalendar.tsx:122`, `frontend/components/event/ParticipantsGrid.tsx:24`, `frontend/components/tournament/TeamsGrid.tsx:24`, `frontend/components/tournament/RegistrationUI.tsx:16`, `frontend/components/tournament/MyRegistrationCard.tsx:28`, `frontend/components/tournament/ProfileCompletion.tsx:24`, `frontend/app/events/[id]/page.tsx:202`, `frontend/app/cours/[id]/page.tsx:173,209`, `frontend/components/coach/CoachLessonCard.tsx:40`, `frontend/components/referee/RefereeTournamentCard.tsx:90`, `frontend/components/player/StatsPanel.tsx:58,161`

- [ ] **Step 1 :** Même transformation qu'E3, même règle (cartes seulement).
- [ ] **Step 2 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AgendaCard.test.tsx __tests__/OpenMatchCard.test.tsx __tests__/MonthCalendar.test.tsx __tests__/TeamsGrid.test.tsx` (+ celles qui existent pour les autres) → vert.
- [ ] **Step 3 : Vérif visuelle** — `/events`, `/parties`, `/me/reservations`, fiche tournoi — clair + sombre, 1280 + 390.
- [ ] **Step 4 : Bilan chiffré** — `Grep pattern:"inset 0 0 0 1px" path:frontend output_mode:count` : consigner le décompte avant/après dans le message de commit (attendu : ~107 → < 45, le reste = usages non-carte légitimes).
- [ ] **Step 5 : Commit** — `refactor(frontend): cartes joueur/agenda en cardStyle, batch 2 (audit UI lot E)`

---

## Lot F — Boutons : `Btn` partout

### Task F1 : `Btn` gagne `size="sm"` (TDD)

**Files:**
- Modify: `frontend/components/ui/atoms.tsx` (Btn, l.51)
- Test: `frontend/__tests__/atoms.btn.test.tsx` (créer)

- [ ] **Step 1 : Test rouge** :

```tsx
import { render, screen } from '@testing-library/react';
import { Btn } from '@/components/ui/atoms';
// (envelopper dans le ThemeProvider mocké habituel des suites atoms/SaveBar)

it('size sm réduit la hauteur du bouton', () => {
  render(<Btn size="sm">Ok</Btn>);
  expect(screen.getByRole('button')).toHaveStyle({ height: '40px' });
});
```

Run → FAIL (« size » inconnu).
- [ ] **Step 2 : Implémenter** — prop `size?: 'md' | 'sm'` (défaut `'md'`) ; pour `sm` : `height: 40, padding: '0 14px', fontSize: 14, borderRadius: 12`. Aucune autre modification de l'API.
- [ ] **Step 3 :** Run → PASS. tsc → vert. **Commit** — `feat(frontend): Btn size=sm (audit UI lot F)`

### Task F2 : `RetryButton` partagé

**Files:**
- Create: `frontend/components/ui/RetryButton.tsx`
- Modify: `frontend/components/ClubDirectory.tsx:97`, `frontend/components/messages/MessagesHub.tsx:143`, `frontend/components/openmatch/OpenMatches.tsx:241,253`, `frontend/components/ClubReserve.tsx:319`
- Test: `frontend/__tests__/RetryButton.test.tsx` (créer)

- [ ] **Step 1 : Test rouge** :

```tsx
it('affiche Réessayer et déclenche onRetry', () => {
  const onRetry = jest.fn();
  render(<RetryButton onRetry={onRetry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(onRetry).toHaveBeenCalled();
});
```

- [ ] **Step 2 : Implémenter** :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';

/** Bouton « Réessayer » des états d'échec réseau — un seul style pour tout le site. */
export function RetryButton({ onRetry, label = 'Réessayer' }: { onRetry: () => void; label?: string }) {
  return <Btn size="sm" variant="surface" onClick={onRetry}>{label}</Btn>;
}
```

Run → PASS.
- [ ] **Step 3 :** Remplacer les 5 implémentations dupliquées par `<RetryButton onRetry={reload} />` (adapter le nom du callback local). Suites `OpenMatches`, `MessagesHub`, `ClubReserve.*` ciblées → vertes.
- [ ] **Step 4 : Commit** — `refactor(frontend): RetryButton partage (audit UI lot F)`

### Task F3 : Sweep des CTA primaires ad hoc

**Files (bouton primaire réimplémenté) :** `frontend/app/admin/tournaments/page.tsx:124,126`, `frontend/app/admin/events/page.tsx:100,102`, `frontend/app/tournois/[id]/page.tsx:166`, `frontend/components/tournament/ProfileCompletion.tsx:22`, `frontend/components/tournament/MyRegistrationCard.tsx:25`, `frontend/components/profile/shared.ts:26`, `frontend/app/me/reservations/page.tsx:166`, `frontend/components/calendar/DayPanel.tsx:74`, `frontend/components/booking/OpenMatchToggle.tsx:127`, `frontend/components/admin/members/PackageBalanceDialog.tsx:120`, `frontend/components/messages/MessageComposer.tsx:107`, `frontend/components/ui/SaveBar.tsx:48`

- [ ] **Step 1 :** Pour chaque bouton : remplacer le `<button style={{ background: th.accent, … }}>` par `<Btn size="sm">` (ou `md` si c'est un CTA pleine largeur), variante `primary`/`surface`/`danger` selon le rôle. Les cas où le style local fait partie d'un layout serré (SaveBar) peuvent garder un `style` d'appoint (largeur/flex) — jamais de couleur/radius/height locaux.
- [ ] **Step 2 : Tests** — toutes les suites des fichiers touchés (`AdminTournaments`, `AdminEvents`, `SaveBar`, `OpenMatchToggle`, `MessageComposer.draft`, `MeProfile`…) → vertes. tsc → vert.
- [ ] **Step 3 : Vérif visuelle** — `/admin/tournaments` + `/me/reservations` clair/sombre.
- [ ] **Step 4 : Commit** — `refactor(frontend): CTA primaires via Btn, radii unifies (audit UI lot F)`

---

## Lot G — Dialogs : échelle z, backdrop unique, TopSheetShell

### Task G1 : Tokens `Z` et `overlayBg`

**Files:**
- Modify: `frontend/lib/theme.ts`

- [ ] **Step 1 :** Ajouter :

```ts
/** Échelle unique d'empilement des overlays. Ne jamais écrire un z-index en dur. */
export const Z = { nav: 40, overlay: 60, dialog: 70, toast: 80 } as const;

/** Backdrop canonique des overlays (celui de ConfirmDialog/SheetShell). */
export const OVERLAY_BG = 'rgba(0,0,0,0.45)';
```

- [ ] **Step 2 :** tsc → vert. **Commit** — `feat(frontend): tokens Z + OVERLAY_BG (audit UI lot G)`

### Task G2 : Sweep z-index + backdrops

**Files:** tous les overlays relevés — `frontend/components/admin/NoShowChargeModal.tsx` (z 200), `frontend/components/admin/members/MemberPanel.tsx` (z 40), `frontend/app/admin/encaissement/page.tsx:427` (z 40), les modales Détails/reçus (`admin/reservations:421`), tiroirs `admin/tournaments:281`/`admin/events:230`, `frontend/components/messages/NewConversationPanel.tsx:60`, `MessagesHub:202`, `frontend/components/coach/AddStudentPicker.tsx:43`, `frontend/components/admin/AnnouncementStudio.tsx:102`, `frontend/components/openmatch/MatchAlertSheet.tsx:74`, `frontend/components/admin/settings/OffPeakRangeSheet.tsx:45`, `frontend/components/DmWidgetHost.tsx`, + toasts (z 55)

- [ ] **Step 1 : Inventaire** — `Grep pattern:"zIndex: [0-9]" path:frontend output_mode:content -n:true`.
- [ ] **Step 2 : Mapper** : navigation collante → `Z.nav` ; backdrop+panneau de dialog/feuille/drawer → `Z.dialog` ; toasts « Annuler » → `Z.toast` ; cas empilés (Détails AU-DESSUS d'une modale, ex. CollectPanel z 58) → `Z.dialog + 1` (littéral autorisé UNIQUEMENT en dérivé du token). Remplacer les backdrops `rgba(0,0,0,0.4)`/`0.5`/teinte chaude par `OVERLAY_BG` (le blur reste au cas par cas).
- [ ] **Step 3 : Tests de non-régression ciblés** — `AdminPlanning` (toast au-dessus de la modale — cas documenté z 55>45), `CollectPanel`, `MessagesHub` → verts.
- [ ] **Step 4 : Vérif visuelle** — planning : ouvrir la modale d'encaissement, déclencher un encaissement → le toast « Annuler » passe AU-DESSUS. **Commit** — `refactor(frontend): echelle Z + backdrop unique (audit UI lot G)`

### Task G3 : `TopSheetShell` extrait

**Files:**
- Create: `frontend/components/ui/TopSheetShell.tsx`
- Modify: `frontend/components/ui/ConfirmDialog.tsx` (se recompose dessus), puis `frontend/components/superadmin/TierChangeDialog.tsx:53`, `frontend/components/superadmin/ChangeSlugDialog.tsx:48`, `frontend/components/openmatch/AuthPromptDialog.tsx:20`, `frontend/components/clubhouse/OffersShowcase.tsx:165`, `frontend/components/clubhouse/AnnouncementKiosk.tsx:216`, `frontend/components/moderation/ReportDialog.tsx:38`
- Test: `frontend/__tests__/TopSheetShell.test.tsx` (créer)

- [ ] **Step 1 : Test rouge** :

```tsx
it('ferme au clic sur le backdrop et à Échap', () => {
  const onClose = jest.fn();
  render(<TopSheetShell onClose={onClose}><p>contenu</p></TopSheetShell>);
  fireEvent.click(screen.getByTestId('topsheet-backdrop'));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2 : Implémenter** — extraire le squelette de `ConfirmDialog` (backdrop `OVERLAY_BG` + blur, panneau descendant du haut, radius `0 0 28px 28px`, animation `sp-sheet-in-top`, `Z.dialog`, Échap + clic backdrop) en composant `{ onClose, children, maxWidth = 520, zIndex = Z.dialog }`. `ConfirmDialog` devient un consommateur (son API publique ne change PAS — ses tests existants restent verts tels quels).
- [ ] **Step 3 :** Migrer les 6 autres top-sheets listées (contenu inchangé, enveloppe remplacée).
- [ ] **Step 4 : Tests** — `ConfirmDialog` (suite existante), `TierChangeDialog`, `AuthPromptDialog`, `OffersShowcase`, `AnnouncementKiosk`, `ReportDialog` → verts.
- [ ] **Step 5 : Commit** — `refactor(frontend): TopSheetShell partage, 7 top-sheets dedupliquees (audit UI lot G)`

### Task G4 : `MatchResultModal` quitte Tailwind

**Files:**
- Modify: `frontend/components/match/MatchResultModal.tsx` (~l.86, enveloppe `fixed inset-0 z-50 …`)

- [ ] **Step 1 :** Remplacer l'enveloppe Tailwind par `SheetShell` (le shell bottom-sheet existant, `frontend/components/ui/SheetShell.tsx`) — le CONTENU (affectation, grille de score, pavé) ne bouge pas d'un pixel de logique.
- [ ] **Step 2 : Tests** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MatchResultModal.test.tsx __tests__/ResultsToRecord.test.tsx` → vert (contrat testids/aria conservé).
- [ ] **Step 3 : Vérif visuelle** — `/parties` → « Saisir » : feuille correcte mobile + desktop. **Commit** — `refactor(frontend): MatchResultModal sur SheetShell (audit UI lot G)`

---

## Lot H — Titres et états : `PageTitle`, `Loading`, `EmptyState`

### Task H1 : Les 3 atomes (TDD)

**Files:**
- Create: `frontend/components/ui/PageTitle.tsx`, `frontend/components/ui/Loading.tsx`, `frontend/components/ui/EmptyState.tsx`
- Test: `frontend/__tests__/PageTitle.test.tsx` (créer, couvre les 3)

- [ ] **Step 1 : Test rouge** :

```tsx
it('PageTitle rend un h1 display', () => {
  render(<PageTitle>Mes amis</PageTitle>);
  expect(screen.getByRole('heading', { level: 1, name: 'Mes amis' })).toBeInTheDocument();
});
it('Loading affiche le libellé', () => {
  render(<Loading />);
  expect(screen.getByText('Chargement…')).toBeInTheDocument();
});
it('EmptyState affiche titre et sous-ligne', () => {
  render(<EmptyState title="Rien à venir" hint="Vos prochaines réservations apparaîtront ici." />);
  expect(screen.getByText('Rien à venir')).toBeInTheDocument();
});
```

- [ ] **Step 2 : Implémenter** :

```tsx
// PageTitle.tsx — 2 tailles nommées, pas d'autre option.
'use client';
import { useTheme } from '@/lib/ThemeProvider';

export function PageTitle({ children, size = 'lg', style }: { children: React.ReactNode; size?: 'lg' | 'md'; style?: React.CSSProperties }) {
  const { th } = useTheme();
  return (
    <h1 style={{ fontFamily: th.fontDisplay, fontWeight: size === 'lg' ? 500 : 600, fontSize: size === 'lg' ? 38 : 30, letterSpacing: -0.5, lineHeight: 1.1, margin: '0 0 6px', color: th.text, ...style }}>
      {children}
    </h1>
  );
}
```

```tsx
// Loading.tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  const { th } = useTheme();
  return <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>{label}</div>;
}
```

```tsx
// EmptyState.tsx — motif « icône + 2 lignes » de me/notifications, généralisé.
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon, IconName } from '@/components/ui/Icon';

export function EmptyState({ title, hint, icon = 'ball' }: { title: string; hint?: string; icon?: IconName }) {
  const { th } = useTheme();
  return (
    <div style={{ padding: '36px 20px', textAlign: 'center' }}>
      <div style={{ width: 44, height: 44, borderRadius: 999, background: th.surface2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <Icon name={icon} size={20} color={th.textMute} />
      </div>
      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{title}</div>
      {hint && <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}
```

(Vérifier l'export réel de `Icon`/`IconName` avant d'écrire l'import.) Run → PASS.
- [ ] **Step 3 : Commit** — `feat(frontend): atomes PageTitle/Loading/EmptyState (audit UI lot H)`

### Task H2 : Sweep des titres `me/*` + admin

**Files:** titres 38/500 dupliqués : `frontend/app/clubs/page.tsx:22`, `frontend/app/me/matches/page.tsx:72`, `frontend/app/me/friends/page.tsx:28` (via FriendsHub), `frontend/app/me/notifications/page.tsx:66`, `frontend/app/me/messages/page.tsx:37`, `frontend/app/me/reservations/page.tsx:175`, `frontend/app/me/notifications/settings/page.tsx:75` — et les orphelines `frontend/app/me/coaching/page.tsx:64`, `frontend/app/me/refereeing/page.tsx:105` (24/700 → PageTitle lg + **supprimer le `ProfileMenu` local dupliqué**, le ClubNav en rend déjà un)

- [ ] **Step 1 :** Remplacer chaque `<h1 style={{ …38/500… }}>` par `<PageTitle>`. Coaching/refereeing : `<PageTitle>` + retrait du `ProfileMenu` en doublon.
- [ ] **Step 2 :** Renommer le h1 de `me/notifications/settings` : `<PageTitle>Réglages des notifications</PageTitle>` (2 pages ne partagent plus le même titre).
- [ ] **Step 3 : Tests** — suites `MeProfile`, `FriendsHub`, `MeCoaching`/`MeRefereeing` (noms à vérifier), `MyMatchesList` → vertes (adapter les `getByRole('heading')` si le texte change).
- [ ] **Step 4 : Commit** — `refactor(frontend): titres de page via PageTitle, coaching/refereeing realignees (audit UI lot H)`

### Task H3 : Sweep « Chargement… » et états vides

**Files:** ~40 occurrences — `Grep pattern:"Chargement…|Chargement\.\.\." path:frontend output_mode:content -n:true`

- [ ] **Step 1 :** Remplacer les `<div>Chargement…</div>` stylés à la main par `<Loading />` (les « Chargement… » plein écran gardent leur wrapper centrant existant). NE PAS toucher aux gardes logiques (`if (!ready) return`).
- [ ] **Step 2 :** États vides une-ligne des listes (`me/reservations:245`, `me/coaching:85`, `me/refereeing:126`, `ClubDirectory:101`, `events:144`) → `<EmptyState title="…" hint="…" />` avec un wording UNIFIÉ : « Rien à venir. » / « Rien de passé. » + hint contextuel.
- [ ] **Step 3 : Tests** — les suites qui assertent « Chargement… » ou les textes d'états vides (grep dans `frontend/__tests__`) : adapter puis tout passer au vert.
- [ ] **Step 4 : Commit** — `refactor(frontend): Loading/EmptyState partages (audit UI lot H)`

---

## Lot I — Superadmin : rattraper la génération

### Task I1 : KPI et typo

**Files:**
- Modify: `frontend/components/superadmin/KpiCard.tsx` (ou équivalent — localiser : `Grep pattern:"KpiCard" path:frontend/components -n:true`) : valeurs en `th.fontDisplay` + `fontVariantNumeric: 'tabular-nums'`, plus de police mono
- Modify: les `h1` superadmin (`stats:43`, `sports:85`, `clubs:71`, `billing:76`) → `<PageTitle size="md">`

- [ ] **Step 1 :** Appliquer. **Step 2 :** suites `SuperAdminClubs`, `SuperAdminBilling`, `SuperAdminStats` → vertes. **Commit** — `refactor(superadmin): KPI en fontDisplay + PageTitle (audit UI lot I)`

### Task I2 : Cartes et sidebar

**Files:**
- Modify: `frontend/app/superadmin/billing/page.tsx:66`, `frontend/app/superadmin/clubs/[id]/page.tsx:48`, `frontend/app/superadmin/clubs/page.tsx:85` (cartes `bgElev + border` → `...cardStyle(th)`)
- Modify: `frontend/app/superadmin/layout.tsx:81` (item actif : fond accent plein → `background: th.surface2, color: th.text`, calqué sur `frontend/app/admin/layout.tsx:301`)

- [ ] **Step 1 :** Appliquer. **Step 2 :** vérif visuelle `/superadmin` (super@) clair + sombre. Suites superadmin vertes. **Commit** — `refactor(superadmin): cartes cardStyle + sidebar alignee sur l'admin (audit UI lot I)`

### Task I3 : Table Clubs respirable

**Files:**
- Modify: `frontend/app/superadmin/clubs/page.tsx` (table)

- [ ] **Step 1 :** Envelopper la table dans un conteneur `overflow-x: auto` dédié ; `white-space: nowrap` sur la cellule nom du club (fini « ACE / PADEL / CLUB » sur 3 lignes) ; slug/ville sur une seule ligne secondaire ; largeur des colonnes Actions réduite (boutons `Btn size="sm"`).
- [ ] **Step 2 :** `SuperAdminClubs` verte + vérif visuelle 1280. **Commit** — `fix(superadmin): table clubs lisible, scroll interne (audit UI lot I)`

---

## Clôture (après le dernier lot exécuté)

- [ ] **Suite complète** — `cd frontend; node node_modules/jest/bin/jest.js` (tolérer uniquement le flake BookingModal connu, re-lancer ces suites seules) + `cd backend; node node_modules/jest/bin/jest.js` + tsc des deux côtés.
- [ ] **Passe visuelle finale** — skill `verify` : club-house, reserver, parties, fiche tournoi, me/profile, admin (dashboard, planning, offres, settings), superadmin — clair + sombre, 1280 + 390 (`mobile:false`).
- [ ] **CLAUDE.md** — ajouter une entrée « Évolution (date) — cohérence UI (audit du 17/07) » résumant : dangerBanner généralisé, ConfirmDialog partout, tokens successInk/Z/OVERLAY_BG, cardStyle canonique, Btn size sm + RetryButton, TopSheetShell, PageTitle/Loading/EmptyState, corrections ponctuelles (SUBSCRIPTION, formats, vouvoiement, /club, kiosque partenaires…), superadmin réaligné.
- [ ] **Mémoire** — mettre à jour `audit-ui-ux-2026-07-17.md` (statut : corrigé / lots livrés).

---

## Hors périmètre de ce plan (assumé, re-planifier si souhaité)

- Refonte complète de `frontend/app/admin/pages/page.tsx` (l'outlier absolu — mérite son propre plan façon « studio »).
- Refonte de la fiche terrain legacy `courts/[id]` et sort de la route `c/[slug]`.
- Harmonisation des 3 seuils `useIsDesktop` (700/768/900) et migration des bascules layout vers CSS pur.
- Touch targets < 40 px (croix, steppers, segments kiosque) — passe dédiée.
- `textFaint` → `textMute` sur le texte porteur d'info (193 occurrences — passe dédiée avec revue cas par cas).
- `MemberRow`/`SponsorFlipDeck` : interactifs imbriqués (restructuration a11y).
- Fondu de bord des rails horizontaux ; formulaires admin sur `Field`/`SelectField` ; unification des 4 paradigmes de création ; convergence des deux comptoirs d'encaissement.
- Pagination/filtres de `/me/matches` (liste longue sans « Charger plus »).
- Unification fine des séparateurs d'heures « → » vs « – » entre surfaces joueur (D3 ne couvre que le format « 22:30 » de la caisse).
