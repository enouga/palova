# Page « Découvrir » (`/decouvrir`) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL : `superpowers:subagent-driven-development` (ou `superpowers:executing-plans`). Étapes en syntaxe checkbox.

**Spec validée** : `docs/superpowers/specs/2026-07-19-page-decouvrir-design.md` (committée, `2256f93`).

## Contexte

La matière « reste de Palova » est éclatée (annuaire `/clubs` enfoui dans ProfileMenu sous « Mes clubs », parties nationales visibles seulement sur la landing anonyme, calendrier tournois sur `/tournois`) et sans point d'entrée depuis un sous-domaine club. On unifie tout sur **`/decouvrir`** (hôte plateforme, **publique**, 3 onglets **Parties | Tournois | Clubs**, barre de localisation partagée 📍+ville pilotant les 3 onglets) avec un point d'entrée visible : **icône ronde monogramme Palova** dans la grappe d'actions du ClubNav. `/clubs` et `/tournois` (plateforme) deviennent des redirections. Backend : uniquement `listNationalOpenMatches` étendu (14 j, cap 60, lat/lng club) — **aucune migration**.

**Architecture** : `app/decouvrir/page.tsx` (orchestrateur client : `?tab=`, ville, coords, horloge) monte l'onglet actif — nouveau `DiscoverMatches` (filtrage 100 % client), `TournamentFinder` adapté (props optionnelles `coords`/`city`/`hideTitle` + `writeUrl` préservant les params étrangers), `ClubDirectory` refactoré (localisation contrôlable par props). La carte du rail `NationalOpenMatches` est extraite en `NationalMatchCard` partagé (+ prop `distanceKm`).

## Règles transverses (IMPÉRATIVES pour chaque subagent)

- **TDD** : test AVANT le code, le voir ÉCHOUER, puis implémenter.
- **Jamais de `new Date()` au rendu React** — horloge posée en effet.
- **Commandes** (shims `.bin` cassés) : `node node_modules/jest/bin/jest.js --runTestsByPath <fichiers>` + gate de types `node node_modules/typescript/bin/tsc --noEmit` (depuis `frontend/` ou `backend/`).
- **Git** : le working tree porte du WIP parallèle (lot C). Commits **PAR CHEMINS EXPLICITES** uniquement — jamais `git add -A`, **jamais `git stash`** (interdit aux subagents).
- Full-suite frontend : flake connue BookingModal → vérifier par suites ciblées uniquement.

---

### Tâche 1 : Branche + commit du correctif postAuth en attente + sauvegarde du plan

**Files** : déjà modifiés dans le working tree : `frontend/lib/postAuth.ts`, `frontend/__tests__/postAuth.test.ts`. Create : `docs/superpowers/plans/2026-07-19-page-decouvrir.md` (copie de ce plan).

**Branche : `git switch -c feat/page-decouvrir` DEPUIS la branche courante `fix/audit-ui-lot-c`** (pas depuis main : le working tree porte le WIP lot C non committé et le stash est interdit — basculer sur une base main réappliquerait ce WIP ailleurs, conflits quasi certains). Conséquence assumée : la branche contient les commits du lot C ; l'intégration finale se décidera en fin de feature (merger lot C d'abord).

- [ ] Vérifier `__tests__/postAuth.test.ts` vert (13/13, le correctif est déjà écrit).
- [ ] `git switch -c feat/page-decouvrir`.
- [ ] Sauvegarder ce plan dans `docs/superpowers/plans/2026-07-19-page-decouvrir.md`.
- [ ] `git add frontend/lib/postAuth.ts frontend/__tests__/postAuth.test.ts docs/superpowers/plans/2026-07-19-page-decouvrir.md` puis commit `fix(auth): joueur plateforme post-login -> accueil / (et non /clubs) + plan page decouvrir`. ⚠️ Ne rien committer d'autre (lot C).

### Tâche 2 : Backend — `listNationalOpenMatches` : 14 j, cap 60, lat/lng

**Files** : `backend/src/services/openMatch.service.ts` (`NATIONAL_INCLUDE` ligne ~32, méthode lignes 188-233) ; test `backend/src/services/__tests__/openMatch.service.test.ts` (bloc lignes 814-857).

- [ ] **Tests d'abord** : enrichir `clubProj` de `latitude: 48.85, longitude: 2.35` ; test fenêtre → `lte - gt === 14*24*3_600_000` et `args.take === 120` et `args.include.resource.select.club.select` matche `{ latitude: true, longitude: true }` ; test cap → 70 parties ouvertes fournies, `out.toHaveLength(60)` ; test vide inchangé. Vérifier l'ÉCHEC.
- [ ] **Implémenter** : horizon `7 → 14` jours ; `take: 40 → 120` ; `.slice(0, 12) → .slice(0, 60)` ; `NATIONAL_INCLUDE` club select + `latitude: true, longitude: true` ; docstring mis à jour. Route `openMatches.ts` inchangée.
- [ ] Suite verte + `tsc --noEmit` backend. Commit (2 fichiers) : `feat(open-matches): vitrine nationale 14 jours, cap 60, lat/lng club (page decouvrir)`.

### Tâche 3 : Type front + helpers purs `lib/discover.ts`

**Files** : Modify `frontend/lib/api.ts` (type `NationalOpenMatchClub` lignes ~2272-2279 + commentaire ligne 59) ; Create `frontend/lib/discover.ts`, `frontend/__tests__/discover.test.ts` ; Modify `frontend/__tests__/NationalOpenMatches.test.tsx` (fixture club + lat/lng — gate tsc).

- [ ] **Tests d'abord** (`discover.test.ts`, `now = new Date(2026, 6, 8, 10, 0)` mercredi, heure locale) :
  - `discoverWindow('all', now)` → null ; `'today'` → from=now, to=fin de journée locale (8/7 23:59) ; `'weekend'` → sam 11 00:00 → dim 12 23:59:59.999 ; dimanche en cours → ce jour seul.
  - `filterNationalMatches` : période (match +2 h gardé en today ; +5 j exclu en today/weekend, gardé en all) ; ville insensible accents/casse (`'Sète'` trouvé par `'sete'` ; `city: null` exclu si filtre actif ; filtre vide → tout passe) ; niveau (`myLevel 6.2` → fourchette [5,7] : garde 4–6, exclut 1–2, garde null/null « ouverte à tous » ; `myLevel: null` → pas de filtre).
  - `sortMatchesByDistance(m, null)` → ordre conservé, `distanceKm: null` partout ; avec coords Paris : Lyon après Paris, club sans lat/lng en dernier (`distanceKm: null`), Paris ≈ 0.
  - `distanceLabel(0.85)` → `'850 m'` ; `(3.4)` → `'3 km'` ; `(12.6)` → `'13 km'`.
- [ ] **Implémenter** — signatures :
  ```ts
  export type DiscoverPeriod = 'today' | 'weekend' | 'all';
  export interface DiscoverMatchFilter { period: DiscoverPeriod; city: string; myLevel: number | null }
  export interface RankedMatch { match: NationalOpenMatch; distanceKm: number | null }
  export function discoverWindow(period, now): { from: Date; to: Date } | null
  export function filterNationalMatches(matches, f, now): NationalOpenMatch[]
  export function sortMatchesByDistance(matches, coords): RankedMatch[]
  export function distanceLabel(km: number): string
  ```
  **Réutiliser, ne pas dupliquer** : `distanceKm` de `@/lib/tournamentCalendar` (haversine exporté lignes 80-87), `norm` de `@/lib/members` (ligne 6), `rangesOverlap` de `@/lib/levelMatch` (ligne 20). Weekend : reprendre la logique de `whenWindow` (`lib/events.ts:68`) — presets dupliqués localement (anti-cycle, précédent events↔tournamentCalendar). Tri distance : nulls en fin, tiebreak startTime (miroir `applyFilters`). `lib/api.ts` : `NationalOpenMatchClub` + `latitude: number | null; longitude: number | null`.
- [ ] Vertes (`discover` + `NationalOpenMatches`) + tsc. Commit (4 fichiers) : `feat(decouvrir): helpers purs lib/discover + lat/lng dans NationalOpenMatchClub`.

### Tâche 4 : Extraction `NationalMatchCard` (carte partagée rail + grille)

**Files** : Create `frontend/components/platform/NationalMatchCard.tsx`, `frontend/__tests__/NationalMatchCard.test.tsx` ; Modify `frontend/components/platform/NationalOpenMatches.tsx`. **Garde-fou : `NationalOpenMatches.test.tsx` reste VERT sans modification** (hors fixture T3).

- [ ] **Tests d'abord** (mock `assetUrl` seul) : distance affichée quand `distanceKm={3.4}` (« · 3 km ») ; sans prop → aucune mention distance ; carte complète (nom club, `empty-seat` ×2, lien contenant `/parties/m1`).
- [ ] **Implémenter** : déplacer tout le corps du `matches.map` (lignes 22-94 : `<a>` racine, liseré accentColor, club·ville, date `formatDateShortTimeRange`, `resourceName · rangeLabel ?? 'Tous niveaux'`, avatars `colorForSeed`, sièges `matchSeats` + `data-testid="empty-seat"`, chip places coral si 1, CTA « Rejoindre → », lien `clubUrl`). Signature : `NationalMatchCard({ match, distanceKm?: number | null, style?: React.CSSProperties })` — `style` fusionné en dernier sur le `<a>` (le rail passe `flex:'0 0 282px', scrollSnapAlign:'start'`). Distance : span `· {distanceLabel(distanceKm)}` après la ville. Le rail `NationalOpenMatches` devient un map de `NationalMatchCard`.
- [ ] Les DEUX suites vertes. Commit (3 fichiers) : `refactor(vitrine): extraction NationalMatchCard (+ prop distanceKm) partagee rail/grille`.

### Tâche 5 : Onglet Parties — `DiscoverMatches`

**Files** : Create `frontend/components/discover/DiscoverMatches.tsx`, `frontend/__tests__/DiscoverMatches.test.tsx`.

Contrat (avec la page, T9) :
```tsx
DiscoverMatches({ matches: NationalOpenMatch[] | null, city: string,
  coords: {lat,lng} | null, now: Date | null, onSeeClubs: () => void })
```

- [ ] **Tests d'abord** (mocks : `useAuth` token pilotable, `api.getMyRating`, `assetUrl`) : rend 1 carte/partie (défaut « 14 jours ») ; chip Aujourd'hui filtre ; prop `city="lyon"` filtre ; `coords` Paris → ordre Paris avant Lyon + distance visible ; **anonyme → pas de chip « À mon niveau » ET `getMyRating` non appelé** ; connecté (`level 6.2`) → chip présente, au clic la partie 1–2 disparaît, la sans-fourchette reste ; état vide → bouton « Voir les clubs » appelle `onSeeClubs` ; `matches: null` ou `now: null` → « Chargement… ».
- [ ] **Implémenter** : état `period` (défaut `'all'`), `levelOn` (défaut false), `rating` (effet `getMyRating(token,'padel')` si token — route globale, OK hôte plateforme). Chips période via `PillTabs` (`atoms.tsx:283`, options Aujourd'hui/Week-end/14 jours) + `Pill` « À mon niveau » (visible ssi `token && rating?.level != null`). Pipeline : `filterNationalMatches` → `sortMatchesByDistance`. Grille `repeat(auto-fill, minmax(270px, 1fr))` de `NationalMatchCard` avec `distanceKm`.
- [ ] Verte + tsc. Commit (2 fichiers) : `feat(decouvrir): onglet Parties (grille NationalMatchCard, periode/ville/niveau/distance)`.

### Tâche 6 : `TournamentFinder` — writeUrl préservant + props `coords`/`city`/`hideTitle`

**Files** : Modify `frontend/components/calendar/TournamentFinder.tsx`, `frontend/__tests__/TournamentFinder.test.tsx` (+3 tests, les 3 existants inchangés).

- [ ] **Tests d'abord** :
  1. URL posée à `/decouvrir?tab=tournois`, clic facette dept → `window.location.search` contient `dept=75` **ET toujours `tab=tournois`** (non éjecté).
  2. Prop `coords={{lat:45.76,lng:4.83}}` → tri distance (Open Lyon premier), `navigator.geolocation.getCurrentPosition` **non appelé**, bouton « Autour de moi ✓ » `aria-pressed=true` (l'attribut existe, vérifié `FacetPanel.tsx:50`).
  3. Prop `city="lyon"` → GP Paris absent ET facette « Paris 1 » absente (filtre AVANT `calendarFacets`).
- [ ] **Implémenter** — props toutes optionnelles (`coords = null, city = '', hideTitle = false`), sans props comportement STRICTEMENT intact :
  1. **writeUrl** : partir de `new URLSearchParams(window.location.search)`, `delete` ses 7 clés (`quand du au dept cat genre near`), puis les `q.set` conditionnels existants inchangés.
  2. **Seed coords** : effet sur `[coords]` (couvre coords au montage ET arrivant après) — `coordsRef.current = coords` AVANT `setState(nearMe: true)` (contrat coordsRef existant).
  3. **Filtre ville** : `cityItems` mémo (`norm` sur `t.club.city`, `city.trim()` vide → passthrough) substitué à `items` dans les mémos `facets` ET `results` (compteurs sur le sous-ensemble ; cumul Département inchangé).
  4. **hideTitle** : `{!hideTitle && (…H1…)}`.
- [ ] 6 tests verts + tsc. Commit (2 fichiers) : `feat(tournois): TournamentFinder embeddable (writeUrl merge, props coords/city/hideTitle)`.

### Tâche 7 : `ClubDirectory` — localisation contrôlable par props

**Files** : Modify `frontend/components/ClubDirectory.tsx`, `frontend/__tests__/ClubDirectory.test.tsx` (+2 tests, les existants inchangés — sans props, comportement intact pour PlatformLanding/AnonymousView).

- [ ] **Tests d'abord** : props `city="Lyon" coords={{…}}` → `listClubs` appelé avec `{ city: 'Lyon', lat, lng }`, input « Ville ou région » ET bouton géoloc **absents**, input « Nom du club » conservé ; changement de prop `city` → `listClubs` relancé avec la nouvelle valeur.
- [ ] **Implémenter** : `ClubDirectory({ city?: string, coords?: {lat,lng} | null } = {})` ; `controlled = cityProp !== undefined || coordsProp !== undefined` ; dans `load`, `effCity`/`effCoords` substitués (deps du useCallback mises à jour) ; masquage input ville + rangée géoloc quand `controlled`. Chips sport + pré-sélection sport préféré conservées.
- [ ] Verte + tsc. Commit (2 fichiers) : `feat(annuaire): ClubDirectory pilotable par props city/coords (barre partagee /decouvrir)`.

### Tâche 8 : `/decouvrir` public (authGate, les DEUX hôtes)

**Files** : Modify `frontend/lib/authGate.ts`, `frontend/__tests__/authGate.test.ts`. `proxy.ts` inchangé (consomme déjà les deux gates).

- [ ] **Tests d'abord** : `isPlatformPublicPath('/decouvrir') === true` ; **`isClubPublicPath('/decouvrir') === true`** (⚠️ correction vs 1er jet : sans ça, un anonyme qui tape l'URL sur un sous-domaine club rebondit sur /login AVANT que la page puisse le renvoyer vers la plateforme) ; `isPublicPath('/decouvrir') === false` (pas dans la liste générique).
- [ ] **Implémenter** : ajouter `|| pathname === '/decouvrir'` aux DEUX fonctions (+ commentaires : « hôte club → la page se renvoie elle-même vers la plateforme »).
- [ ] Verte. Commit (2 fichiers) : `feat(decouvrir): /decouvrir public (plateforme + hote club, la page renvoie vers la plateforme)`.

### Tâche 9 : Page `/decouvrir` (orchestrateur)

**Files** : Create `frontend/app/decouvrir/page.tsx`, `frontend/__tests__/DiscoverPage.test.tsx`.

- [ ] **Tests d'abord** (mocks : `next/navigation`, `ClubProvider` (clubCtx pilotable), **`@/lib/nav` → `hardNavigate`** (mockable — `window.location.replace` ne l'est pas en jsdom), `useAuth`, `@/lib/api` complet : `listNationalOpenMatches`/`listNationalTournaments`/`getSports`/`listClubs`/`getMyRating`/`getMyProfile` + `assetUrl` ; `beforeEach` reset URL `/decouvrir`) :
  1. Défaut Parties : titre « Découvrir », 2 cartes, `listNationalOpenMatches` ×1, `listNationalTournaments` **PAS appelé** (Finder non monté).
  2. `?tab=clubs` au montage → `listClubs` appelé, input « Ville ou région » absent (porté par la barre partagée).
  3. `?tab=inconnu` → Parties.
  4. Clic onglet Tournois → URL contient `tab=tournois`, `listNationalTournaments` appelé, H1 « Calendrier des tournois » ABSENT (hideTitle).
  5. Hôte club (`slug:'demo'`) → `hardNavigate` appelé avec URL contenant `/decouvrir?tab=clubs` et sans `demo.` ; rien rendu.
  6. Anonyme : pas de chip « À mon niveau », `getMyRating` non appelé.
  7. Ville partagée (input placeholder « Ville ») → cartes Parties filtrées.
  8. État vide → clic « Voir les clubs » → `listClubs` appelé + URL `tab=clubs`.
- [ ] **Implémenter** : `'use client'` ; garde hôte club en effet `if (slug) hardNavigate(platformUrl('/decouvrir' + window.location.search))` + `return null` ; onglet `useState<'parties'|'tournois'|'clubs'>` lu de `?tab=` au montage (seuls tournois/clubs acceptés), écrit par `replaceState` **en ne touchant QUE la clé `tab`** (même règle de merge que le Finder ; `tab=parties` → clé supprimée) ; barre partagée `city`/`coords`/`geoState` (locateMe pattern ClubDirectory, chip 📍 + input « Ville » + message denied) ; horloge en effet ; fetch `listNationalOpenMatches` une fois au montage ; en-tête plateforme (pattern `/clubs` : Logotype + MyBookingsButton/ThemeToggle/ProfileMenu), titre « Découvrir » + sous-titre « Clubs, parties et tournois, partout sur Palova. » ; `PillTabs` 3 options ; **onglets non montés quand inactifs** : `DiscoverMatches` / `TournamentFinder hideTitle coords city` / `ClubDirectory city coords`.
- [ ] Vertes (`DiscoverPage` + `DiscoverMatches`) + tsc. Commit (2 fichiers) : `feat(decouvrir): page /decouvrir 3 onglets + barre de localisation partagee`.

### Tâche 10 : Redirections `/clubs` & `/tournois` + liens existants

**Files** : Modify `frontend/app/clubs/page.tsx` (réécrit en stub), `frontend/app/tournois/page.tsx`, `frontend/components/calendar/UpcomingTournaments.tsx` (ligne 61), `frontend/app/me/reservations/page.tsx` (lignes 164+166) ; Create `frontend/__tests__/DiscoverRedirects.test.tsx`, **`frontend/__tests__/UpcomingTournaments.test.tsx`** (⚠️ le lien « Voir tout le calendrier » vit DANS UpcomingTournaments, qui est stubé dans AnonymousView.test — l'assertion doit vivre ici, AnonymousView.test n'est PAS touché).

- [ ] **Tests d'abord** :
  - `DiscoverRedirects.test.tsx` (mocks next/navigation replace + ClubProvider) : `/clubs` plateforme → `replace('/decouvrir?tab=clubs')` ; `/tournois` plateforme → `replace('/decouvrir?tab=tournois')` ; `/tournois` hôte club → `replace('/events?filtre=competitions')` (branche inchangée).
  - `UpcomingTournaments.test.tsx` (nouveau, fixture `NationalTournament` reprise du modèle `TournamentFinder.test`, props `items` + `hideTitle`) : le lien « Voir tout le calendrier → » a un href contenant `/decouvrir?tab=tournois`.
- [ ] **Implémenter** : `app/clubs/page.tsx` → stub pattern `app/admin/sports/page.tsx` (`router.replace('/decouvrir?tab=clubs')`, `return null`) ; `app/tournois/page.tsx` → `router.replace(slug ? '/events?filtre=competitions' : '/decouvrir?tab=tournois')` (imports Screen/TournamentFinder supprimés) ; `UpcomingTournaments` ligne 61 → `platformUrl('/decouvrir?tab=tournois')` ; `me/reservations` : `BackButton href` + `router.push` → `/decouvrir?tab=clubs`.
- [ ] Vertes (`DiscoverRedirects`, `UpcomingTournaments`, `AnonymousView` en non-régression, suites réservations si existantes) + tsc. Commit (6 fichiers) : `feat(decouvrir): /clubs et /tournois (plateforme) redirigent vers /decouvrir + liens mis a jour`.

### Tâche 11 : ClubNav — `LogoBall` + icône Palova + parades mobile

**Files** : Modify `frontend/components/ui/atoms.tsx` (extraction `LogoBall` du SVG de `Logotype`, lignes 26-33), `frontend/components/ClubNav.tsx` (grappe lignes 205-234, `<style>` lignes 148-175, logo club lignes 197-199), `frontend/__tests__/ClubNav.test.tsx` (+2 tests, helper de rendu existant).

- [ ] **Tests d'abord** : icône `getByLabelText('Palova — découvrir clubs, parties et tournois')` — (a) visible **anonyme** (pas de token), href contenant `/decouvrir` et PAS le sous-domaine club ; (b) visible aussi connecté.
- [ ] **Implémenter** :
  - `atoms.tsx` : `export function LogoBall({ size, color? })` = le SVG balle exact (circle r=37 + 2 paths Q, stroke `color ?? th.accent`, halo neon conservé) ; `Logotype` le consomme (rendu strictement identique).
  - `ClubNav.tsx` : vraie ancre ronde 38 px (gabarit icône Messages) entre `<ThemeToggle />` et le bloc Messages, `href={platformUrl('/decouvrir')}`, aria-label/title « Palova — découvrir clubs, parties et tournois », `<LogoBall size={20} />`, **aucune condition token**.
  - CSS : `@media (max-width:600px){ .cn-club-logo { max-width: 90px; } }` (+ `className="cn-club-logo"` sur l'img logo club) ; `@media (max-width:400px){ .cn-actions { gap: 6px !important; } .cn-actions > a, .cn-actions > button, .cn-actions > div > button, .cn-actions > div > a { width: 34px !important; height: 34px !important; } .cn-actions > div > button > span, .cn-actions > div > button > img { width: 34px !important; height: 34px !important; } }` — solution CSS retenue plutôt qu'une prop className enfilée dans 3 composants partagés (ThemeToggle/NotificationBell/ProfileMenu) hors périmètre ; sélecteurs limités aux enfants directs (les popovers `role=menu` plus profonds ne sont pas touchés).
- [ ] Vertes (`ClubNav` + suites consommatrices d'atoms si besoin) + tsc. Commit (3 fichiers) : `feat(clubnav): icone Palova -> /decouvrir (LogoBall extrait) + parades mobile 400px/logo`.

### Tâche 12 : ProfileMenu « Palova » + cible par défaut du Logotype

**Files** : Modify `frontend/components/ProfileMenu.tsx` (ligne 171), `frontend/components/ui/atoms.tsx` (ligne 22), `frontend/__tests__/ProfileMenu.test.tsx` ; Create `frontend/__tests__/Logotype.test.tsx`.

- [ ] **Tests d'abord** : ProfileMenu — `getByText('Palova')` présent, `queryByText('Mes clubs')` absent (mettre à jour l'assertion existante). Logotype (nouvelle suite, mocks useAuth/ClubProvider/next-navigation) : joueur connecté plateforme → href `/` (plus `/clubs`) ; staff (`clubId`) → `/admin` inchangé ; sous-domaine club → `/` inchangé.
- [ ] **Implémenter** : ProfileMenu ligne 171 → `icon="ball" label="Palova"`, `window.location.assign(platformUrl('/decouvrir'))` ; `atoms.tsx` ligne 22 → `const target = href ?? (slug ? '/' : (!ready ? '/' : clubId ? '/admin' : '/'));` (le cas `token ? '/clubs'` disparaît — cohérent avec le correctif postAuth T1 ; commentaire mis à jour).
- [ ] Vertes (`ProfileMenu`, `Logotype`, `ClubNav` en non-régression) + tsc. Commit (4 fichiers) : `feat(decouvrir): entree ProfileMenu Palova + Logotype joueur plateforme -> /`.

### Tâche 13 : Vérification finale

- [ ] **Suites frontend ciblées** (depuis `frontend/`) : `discover`, `NationalMatchCard`, `NationalOpenMatches`, `DiscoverMatches`, `DiscoverPage`, `DiscoverRedirects`, `UpcomingTournaments`, `TournamentFinder`, `ClubDirectory`, `AnonymousView`, `PlatformLanding`, `ClubNav`, `ProfileMenu`, `Logotype`, `authGate`, `postAuth` (+ suites réservations si touchées en T10) — tout PASS.
- [ ] **Backend ciblé** (`openMatch.service`) + `tsc --noEmit` des DEUX côtés.
- [ ] **Vérification visuelle CDP** (skill `/verify`), clair ET sombre, 1280 et 390 :
  - `/decouvrir` : Parties (grille + distances si géoloc), Tournois (pas de H1 doublé, `?tab=tournois` stable en cliquant les facettes), Clubs (contrôles ville/géoloc absents de l'onglet) ; anonyme sans chip niveau.
  - `/clubs` et `/tournois` plateforme : redirection.
  - Sous-domaine club : icône Palova (connecté ET anonyme), clic → plateforme.
  - **Grappe ClubNav en 360 px avec `mobile:false`** (staff = 6 icônes) : 34 px, gap 6, logo plafonné, aucun débordement horizontal.
- [ ] `git status` : seuls les fichiers du WIP lot C restent modifiés non committés ; committer tout reliquat de la feature PAR CHEMINS EXPLICITES. Self-review vs la spec (§1 → T10/T11/T12, §2 → T5-T9, §3 → T2/T3, §4 → T3-T7, §5 → toutes).

## Pièges anticipés (issus de l'exploration)

- Le `writeUrl` du Finder écrase toute la query → T6 le fait merger ; la page applique la MÊME règle pour `tab` (chacun ne touche que ses clés).
- Coords pouvant arriver APRÈS le montage du Finder (géoloc à la demande) → effet sur `[coords]`, pas seulement au mount.
- Garde hôte club via `hardNavigate` de `@/lib/nav` (mockable en jsdom — `window.location.replace` ne l'est pas).
- `latitude/longitude` non-optionnels dans le type → fixtures `NationalOpenMatches.test` complétées dès T3 (gate tsc).
- Onglets non montés quand inactifs → le Finder ne fetch qu'à sa 1ʳᵉ activation (pas de double fetch).
- Le lien « Voir tout le calendrier » vit dans `UpcomingTournaments` (stubé dans AnonymousView.test) → assertion dans sa propre nouvelle suite (T10).
- `/decouvrir` doit être public sur les DEUX gates (plateforme + club) — sinon l'anonyme sur un hôte club rebondit sur /login (T8).
