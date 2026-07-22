# Mon Palova — accueil personnel du joueur sur palova.fr (Lot 1)

**Date** : 2026-07-22
**Statut** : validé (Eric — 3 pistes d'ossature comparées dans le companion visuel, piste A
« Agenda d'abord » retenue ; page complète à 8 sections validée telle quelle ; gérants v1 =
carte Gestion simple, choisi sur question dédiée)

## Problème

La racine `palova.fr` d'un joueur connecté est une **redirection vers `/decouvrir`**
(`PlatformLanding`, commentaire en code : « plutôt qu'un accueil dédié pauvre »). Le joueur
multi-clubs n'a **aucun endroit à lui** : son agenda vit sur `/me/reservations`, ses clubs
dans le menu profil, ses offres souscrites sont éclatées par club, la découverte sur
`/decouvrir`. Le gérant a un écran `ManagerView` réduit à des boutons « Aller à l'admin » —
et s'il joue (cas majoritaire des clubs pilotes), il ne voit **jamais** son agenda joueur
sur la plateforme. Enfin, la ligne « Tout voir sur Palova → » de Mes réservations pointe
vers un `/me/reservations` brut, jugé peu accueillant.

## Vision

**palova.fr = l'app-hub personnelle du joueur** (PWA « Palova », manifest plateforme
existant), **chaque club = son app** à sa marque sur son sous-domaine. On circule par
**liens profonds** `clubUrl(slug, path)` — la session suit (cookie `.palova.fr` en prod).
Mon Palova est l'écran d'accueil naturel de l'app Palova installée.

## Décisions de cadrage

- **Une seule page d'entrée, des sections gatées par capacités — jamais des pages
  exclusives par rôle.** `PlatformLanding` devient : anonyme → `AnonymousView` (strictement
  inchangée) ; connecté → **Mon Palova** ; clubs gérés → **carte Gestion** empilée en haut
  de Mon Palova. **`ManagerView` est supprimé** (absorbé par la carte Gestion) ; la
  redirection `router.replace('/decouvrir')` du joueur disparaît.
- **`/decouvrir` ne change pas d'un pixel** (surface SEO fraîchement optimisée ; les
  crawlers sont des anonymes, le SEO ne voit que la vitrine). Mon Palova y **renvoie**
  (liens profonds `#parties`/`#clubs`, `?q=`), il n'en copie pas les briques.
- **Lots** : ce spec = **Lot 1** (accueil joueur + carte Gestion simple). **Lot 2** =
  panneau Gestion enrichi (pouls opérations staff/admin + rangée business owner, endpoint
  `managed-pulse`). **Lot 3** = personnalisation des sections par l'utilisateur (pattern
  `clubHouseSections`, par user). Les Lots 2-3 ne sont PAS spécifiés ici.
- **Redirections post-login inchangées** (vérifié dans `lib/postAuth.ts`) : le joueur
  plateforme est déjà poussé vers `/` (il atterrira sur Mon Palova sans changement) ; le
  staff continue d'atterrir directement sur l'admin de son club au login — Mon Palova le
  concerne quand il *revient* sur palova.fr.

## La page — 8 sections, ordre validé

Chaque section est un **composant autonome qui charge ses données** (pattern
`Promise.allSettled` du hub Amis : une brique en échec n'éteint pas la page ; aucun fetch
ne conditionne le rendu du squelette). Horloge posée en effet (hydration-safe, jamais de
`new Date()` au rendu).

**0. Carte Gestion** *(seulement si `getMyClubs` non vide)* — « Gérer {club} → » par club
géré (reprise des boutons du `ManagerView` supprimé, navigation `goToClubAdmin` existante
— pont de session dev compris). Sobre, une carte, au-dessus du hero. Le Lot 2 l'enrichira.

**1. Hero « prochaine partie »** — brume bleue (`HERO_GRADIENT`/`HERO_INK`), « Bonjour
{prénom} », la **prochaine entrée d'agenda tous clubs confondus** (résa, tournoi, event ou
cours — première entrée de `buildAgendaList` non passée), avec club, coéquipiers si résa,
**compte à rebours** (chip, réutilise l'esprit `deadlineCountdown`) et CTA « Gérer → »
(lien profond vers la surface idoine). **Fallback agenda vide** : le hero devient
« Trouve ta prochaine partie » + CTA vers `/decouvrir` — jamais de hero creux.

**2. Résultat(s) à saisir** *(seulement si ≥ 1)* — réutilise la carte compacte
`ResultsToRecord` existante (une ligne par match, `getMyMatches`/`canRecordResult` déjà
globaux) + `MatchResultModal` branchée comme sur `/me/reservations`.

**3. À venir · tous clubs** — les **3 prochaines entrées** (au-delà de celle du hero, pour
ne pas doubler), cartes avec **marqueur club** (liseré + chip `accentColor`, helpers
`clubMarker`/`agendaItemClub` livrés le 22/07 — `localSlug` null sur la plateforme →
marqueur partout). « Tout voir → » vers `/me/reservations`.

**4. Parties à rejoindre** — rail horizontal (cap 6) depuis le **flux national existant**
`listNationalOpenMatches` : **mes clubs d'abord** (adhésions ACTIVE de
`getMyMemberships`), puis les autres en chrono. Cartes pattern `NationalOpenMatches`
(liseré/pastille accentColor du club, lien profond `clubUrl(slug, '/parties/'+id)`).
« Toutes → » vers `/decouvrir#parties`. Masquée si flux vide.

**5. Mes clubs** — cartes des adhésions ACTIVE (`getMyMemberships` : nom, ville, tuile à
l'`accentColor`/logo), tap → `clubUrl(slug, '/')` (le Club-house du club). Dernière carte
**« + Trouver un club »** → `/decouvrir#clubs`. Toujours affichée (même vide : la carte
« + Trouver un club » seule est l'invitation).

**6. Mon portefeuille** *(seulement si ≥ 1 élément)* — abonnements actifs + carnets/
porte-monnaie utilisables **tous clubs confondus**, chaque ligne portant la chip
accentColor de son club (même langage que le marqueur d'agenda). Alimentée par le **seul
nouvel endpoint backend** (cf. plus bas).

**7. Mon niveau** *(seulement si un rating existe)* — pastille niveau (padel, global) +
tendance (« +0,3 ce mois » si l'historique le permet, sinon bilan V-D), lien vers
`/me/profile?tab=niveau` (clé vérifiée dans `PROFILE_TABS`). Briques
`getMyRating`/`LevelChip` réutilisées.

**8. Découvrir** — la **pilule de recherche** (même langage que `LocationSearchPill`) qui
navigue vers `/decouvrir?q={saisie}` (deep-link `?q=` déjà géré par `DiscoverClient`).
C'est la porte vers la recherche, pas une recherche embarquée.

## Backend — un seul ajout

**`GET /api/me/wallet`** (auth) : agrège, sur tous les clubs **ACTIVE** où le joueur a une
adhésion ACTIVE, ses `Subscription` actives et ses `MemberPackage` utilisables — miroir
cross-club des lectures club-scopées existantes (`/:slug/me/packages`,
`getMyClubSubscriptions`). Projection :
`[{ club: { slug, name, accentColor }, subscriptions: [...], packages: [...] }]`
(mêmes formes d'items que les endpoints club-scopés ; clubs sans rien = omis). Aucune
migration. Tout le reste de la page consomme des endpoints existants
(`me/reservations|tournaments|events|lessons|matches|memberships|clubs`, flux nationaux,
`getMyRating`, `getMyProfile` pour le prénom).

## Plomberie & retouches

- **`PlatformLanding`** : routeur de visages (anon / Mon Palova) ; suppression du
  `router.replace('/decouvrir')` et du `ManagerView` ; le squelette de chargement actuel
  reste pour la résolution de session.
- **Ligne « Tout voir sur Palova → »** de `/me/reservations` (livrée le 22/07) : cible
  `platformUrl('/')` au lieu de `platformUrl('/me/reservations')` (Mon Palova montre
  l'agenda ET le contexte).
- **PWA** : rien à faire (manifest plateforme déjà en place, `start_url` racine).
- Le superadmin garde sa redirection `/superadmin` (postAuth inchangé).

## Architecture front

- Page : `PlatformLanding` rend `components/platform/MonPalova.tsx` (orchestrateur) +
  `components/platform/home/*.tsx` (une section = un composant : `HomeHero`,
  `ManagedClubsCard`, `HomeAgenda`, `HomeMatchesRail`, `MyClubsRow`, `WalletCard`,
  `LevelCard`, `DiscoverPill`).
- Helpers purs testés `lib/monPalova.ts` : sélection hero/3-suivantes depuis
  `buildAgendaList` (réutilisé tel quel), tri « mes clubs d'abord » du rail parties,
  libellé compte à rebours, agrégats wallet côté affichage.
- Langage visuel : sections éditoriales du site (kicker tiret accent + titre display,
  `cardStyle` ombre douce), hero brume bleue — **jamais de panneau sombre** (règle Eric).

## Tests

- Backend : `wallet` (service + route — agrégation multi-clubs, clubs vides omis,
  adhésions BLOCKED exclues).
- Front purs : `monPalova` (hero/next entries sans doublon, tri mes-clubs-d'abord,
  fallback vide).
- Composants : chaque section (états plein/vide/masqué), `MonPalova` (une brique en échec
  n'éteint pas la page), `PlatformLanding` (anon → vitrine ; joueur → Mon Palova ; gérant
  → carte Gestion + contenu joueur ; plus de redirect /decouvrir).
- Retouche : `MyReservationsScoping` (cible de la ligne d'info → `/`).
- Vérif CDP clair+sombre, 1280 + 390 (`mobile:false`), joueur pur / gérant-joueur /
  compte neuf (fallbacks).

## Hors périmètre (parqué)

- **Lot 2** : panneau Gestion enrichi (pouls du jour par club, alertes actionnables,
  rangée business owner, endpoint `GET /api/me/managed-pulse`).
- **Lot 3** : personnalisation des sections (réordonner/masquer, pattern
  `clubHouseSections` par user).
- Social cross-club (amis/demandes sur l'accueil), alertes de parties cross-club,
  recommandations par géolocalisation sur le rail parties, fil de notifications.
- Preuve sociale sur la vitrine anonyme (logos clubs fondateurs) — noté pour plus tard,
  indépendant.
