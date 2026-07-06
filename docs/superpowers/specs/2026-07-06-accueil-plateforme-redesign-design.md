# Refonte de l'accueil plateforme visiteur (palova.fr) + parties ouvertes publiques — Design

**Date** : 2026-07-06
**Statut** : validé (direction créative déléguée — « la plus belle page du site »)

## Contexte

La vitrine publique de palova.fr (`components/platform/AnonymousView.tsx`) est fonctionnelle mais
plate : hero texte simple, annuaire, un emplacement « Parties ouvertes près de moi » resté en
`SoonCard · Bientôt`, tournois nationaux, bandeau B2B minimal. Objectif : en faire la plus belle
page du site — niveau « web agency premium » — et brancher enfin les parties ouvertes publiques.

## Périmètre

1. **Backend — agrégat national des parties ouvertes** (nouveau, additif, aucune migration).
2. **Frontend — refonte complète d'`AnonymousView`** + nouvelle section « Ça joue bientôt ».

Les vues connectées de `PlatformLanding` (PlayerView/ManagerView) sont hors périmètre.

## 1. Backend — `GET /api/open-matches/national`

Miroir du pattern « calendrier national des tournois » (`GET /api/tournaments/national`).

- **Service** : `OpenMatchService.listNationalOpenMatches()` —
  réservations `visibility: PUBLIC`, `status: CONFIRMED`, `startTime` dans `(now, now + 7 jours]`,
  sport **padel**, clubs `status: ACTIVE` **et `listedInDirectory: true`** (cohérence
  confidentialité : un club retiré de l'annuaire ne remonte pas sur la vitrine).
  `orderBy startTime asc`, `take 40` en SQL, puis **filtre les parties pleines**
  (`spotsLeft > 0` — la vitrine vend des places à prendre) et **cap à 12**.
- **DTO** (mapper dédié, léger — pas de `toDTO` : ni chat, ni unread, ni cardVersion) :
  `{ id, resourceName, sport, startTime, endTime, maxPlayers, spotsLeft, full, targetLevelMin,
  targetLevelMax, players[{ userId, firstName, lastName, avatarUrl, isOrganizer, level, team, slot }],
  club{ slug, name, city, timezone, accentColor, logoUrl } }`.
  Niveaux batchés via `ratingService.getLevelsBySport`, équipes via `effectiveTeams` (cohérent
  avec les cartes club).
- **Route** : nouveau routeur `backend/src/routes/openMatches.ts` monté sur `/api/open-matches`
  dans `app.ts`, `GET /national` public (pas d'auth), erreurs → `next(err)`.

## 2. Frontend — refonte `AnonymousView`

Contraintes du système : `Screen` (820 px), styles inline + tokens `th`, deux thèmes
(daylight/floodlit), hydration-safe (aucun `new Date()` au rendu), langage visuel existant
(`HERO_GRADIENT`/`HERO_INK` « brume bleue », `fontBrand` Righteous en touche, `ACCENTS`,
cartes ombre douce).

### Structure de page (dans l'ordre)

1. **Nav sticky** translucide (`backdrop-filter: blur`, fond `th.bg` en rgba) : `Logotype`,
   `ThemeToggle`, lien « Connexion » (pill encre) + pill accent « Créer un compte » → `/register`.
2. **Hero immersif** : panneau `HERO_GRADIENT` arrondi, **traces du logo Palova en filigrane**
   (SVG cercle + glissières, encre très diluée) + orbe accent flou ; surtitre « PALOVA » en
   `fontBrand` ; headline display ~44 px « Le padel se joue ici. » ; sous-titre ; double CTA
   (« Trouver mon club → » ancre `#clubs`, « Voir les parties ouvertes » ancre `#parties`) ;
   **rangée pouls** hydration-safe (chips rendues quand les données sont là) :
   « 🎾 N parties ouvertes cette semaine » · « 📅 N tournois à venir ». Entrée en `sp-rise`.
3. **`#parties` — « Ça joue bientôt »** : nouveau composant présentationnel
   `components/platform/NationalOpenMatches.tsx` — rail snap-scroll horizontal de grandes
   cartes (272 px, pattern `OpenMatchesShowcase` du club-house) enrichies de l'**identité du
   club** (liseré accentColor 4 px + nom · ville), date au **fuseau du club**
   (`formatDateShortTimeRange`), avatars + sièges vides pointillés (`matchSeats`), fourchette
   de niveau (`rangeLabel`), chip places (coral si 1 restante), CTA « Rejoindre » →
   `clubUrl(slug, '/parties/'+id)` (cross-sous-domaine). **Liste vide → section absente**
   (fini la `SoonCard`).
4. **`#clubs` — « Clubs près de chez vous »** : en-tête éditorial + `ClubDirectory` (inchangé).
5. **Tournois** : `UpcomingTournaments` gagne une prop optionnelle **`items?`** (préchargés →
   pas de double fetch ; sans prop, il continue de fetcher lui-même — rétro-compatible).
6. **« Comment ça marche »** : 3 étapes numérotées display (Trouvez votre club / Réservez ou
   rejoignez une partie / Jouez, défiez, progressez).
7. **Panneau B2B** : fond `th.ink`, orbe accent décoratif, grille de 6 fonctionnalités,
   CTA « Découvrir Palova pour les clubs → » (`/offres`) + « Créer mon club » (`/clubs/new`)
   + lien tarifs.
8. **Footer éditorial** : Logotype, tagline, liens légaux existants.

### Données

`AnonymousView` fetch **une fois** (effets au montage) `api.listNationalOpenMatches()` et
`api.listNationalTournaments()`, alimente pouls + sections. Échec réseau → listes vides,
sections masquées, la page reste belle.

## Types & API front

`lib/api.ts` : `NationalOpenMatchClub`, `NationalOpenMatch` (joueurs `OpenMatchPlayer` réutilisés)
+ `api.listNationalOpenMatches()`.

## Tests

- **Backend** `openMatch.service.test.ts` : where clause (PUBLIC/CONFIRMED/padel/club ACTIVE +
  listé), parties pleines filtrées, cap 12, projection club, levels batchés.
- **Front** : `NationalOpenMatches.test.tsx` (cartes, sièges vides, lien cross-domaine, vide →
  null) ; `AnonymousView.test.tsx` réécrit (hero, pouls, sections, CTAs — mock `lib/api`).

## Hors périmètre

Events dans l'agrégat national, pagination/filtres serveur, opt-out club dédié aux parties
(`listedInDirectory` suffit), refonte des vues connectées, page `/offres`.
