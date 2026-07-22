# Parties ouvertes genrées (Féminine / Mixte) — Design

**Date :** 2026-07-21
**Statut :** validé, prêt pour plan

## Problème

Aujourd'hui une **partie ouverte** (réservation padel `visibility: PUBLIC`, rejoignable
par les membres) n'a aucune notion de genre : n'importe quel membre peut rejoindre.
On veut permettre à un organisateur de créer des parties **strictement féminines** ou
**mixtes**, comme le padel se joue réellement, avec un vrai blocage à l'inscription
(pas un simple indicatif).

Le modèle existe déjà pour les **tournois** (`TournamentGender { MEN, WOMEN, MIXED }`
+ `assertGender` qui contrôle la composition via `User.sex`), mais les parties ouvertes
n'en héritent pas.

## Décisions de cadrage (issues du brainstorming)

- **Catégories offertes** : `Ouverte à tous` (défaut) · `Féminine` · `Mixte`.
  **Pas** de catégorie 100% masculine (non demandée).
- **Mixte = 1 homme + 1 femme par équipe** (chaque côté G/D), pas seulement 2H+2F au
  total — c'est structurel, aligné sur le padel FFT et sur les places d'équipe déjà
  persistées (`ReservationParticipant.team`/`slot`).
- **Blocage dur** (« strictement ») : le genre refuse l'inscription, à la différence de
  la fourchette de niveau qui reste purement indicative.
- **Sexe non renseigné** → blocage avec message clair (miroir `SEX_REQUIRED` tournois).
- **Découverte** : badge sur les cartes **et** filtre `Genre` sur `/parties`.

## 1. Modèle de données

- Nouvel enum **`OpenMatchGender { WOMEN, MIXED }`**.
- Nouvelle colonne nullable **`Reservation.matchGender OpenMatchGender?`**
  (`@map("match_gender")`). **`null` = ouverte à tous** → toutes les parties existantes
  restent inchangées, aucun backfill.
- On **n'ajoute pas** `MEN` à l'enum : la catégorie masculine n'est pas offerte, autant
  rendre l'état invalide non représentable.
- Le genre suit `visibility`, comme `targetLevelMin/Max` : effacé (remis à `null`) dès que
  la partie repasse `PRIVATE`.
- Migration **additive** `add_open_match_gender` (dossier horodaté ; DEV via
  `prisma db execute` du SQL additif à cause de la dérive de base connue, prod
  `migrate deploy`). Voir mémoire *prisma-migrate-deploy-not-dev*.

## 2. Sémantique & règles

Helper **pur** unique, à placer dans `backend/src/services/matchTeams.ts` à côté
d'`effectiveTeams`/`applyTeams` :

```
assertOpenMatchGender(
  matchGender: OpenMatchGender | null,
  existing: Array<{ userId; sex; team }>,   // participants déjà présents (team effectif)
  newPlayer: { userId; sex },
  targetTeam: 1 | 2 | null,                 // équipe visée pour le nouveau joueur (mixte)
): void
```

Règles :

- `matchGender === null` → aucune contrainte (retour immédiat).
- **`WOMEN`** → `newPlayer.sex` doit être `FEMALE`, sinon `GENDER_NOT_FEMALE`.
  `sex` absent → `SEX_REQUIRED`. Aucune contrainte d'équipe.
- **`MIXED`** → `newPlayer.sex` requis (`SEX_REQUIRED` sinon). L'équipe cible (résolue,
  cf. §3) doit avoir **au plus 1 joueur de chaque sexe**. Si le côté visé compte déjà un
  joueur du même sexe que `newPlayer` → `GENDER_TEAM_FULL`.
- Le fait que chaque équipe accepte au plus 1H + 1F garantit mécaniquement le plafond
  global 2H + 2F à 4 joueurs.

**Cas single (1v1, `maxPlayers = 2`, demi-équipe = 1)** : la règle « ≤1 par sexe par
équipe » ne contraint rien (une équipe d'un seul joueur accepte n'importe quel sexe). Le
mixte structuré vise le double ; on laisse le single permissif (edge mineur, documenté,
pas de sur-ingénierie).

Le helper est **testé isolément** (pur, sans I/O).

## 3. Points d'application (backend)

Le helper est appelé à **chaque** mutation qui touche la composition d'une réservation
PUBLIC genrée. Toutes celles qui écrivent dans une partie ouverte le font déjà dans une
transaction Serializable + `FOR UPDATE` — la validation s'y insère.

| Chemin (`openMatch.service.ts` sauf indication) | Contrôle |
|---|---|
| `joinOpenMatch(target?)` | Charger `matchGender` + `sex` du joueur (join du `User`). Résoudre l'équipe cible : `target.team` si fourni, sinon — pour un mixte — la **première équipe compatible** (place libre + pas de joueur du même sexe) ; aucune → `GENDER_TEAM_FULL`. Persister `team`/`slot` concrets pour le mixte (jamais `null`, pour garder l'invariant visible). Puis `assertOpenMatchGender`. |
| `addOpenMatchPlayer` (organisateur) | Charger `sex` de la cible ; `assertOpenMatchGender` avec résolution d'équipe compatible identique au join. |
| `setTeams` (réorg des équipes) | Pour un mixte, le layout résultant doit rester ≤1 par sexe par équipe ; sinon `GENDER_TEAM_FULL`. Contrôle ajouté dans `setTeams` (ou dans `applyTeams`, cf. plan). |
| `applyHoldSetup` (`reservation.service.ts`, création via BookingModal) | Accepte `matchGender?`. À l'ouverture, seul l'organisateur est participant → valide qu'il satisfait la contrainte (Féminine ⇒ organisatrice `FEMALE` ; Mixte ⇒ sexe renseigné). Conflit → `GENDER_PARTICIPANTS_CONFLICT`. Le genre n'est écrit que si `visibility === 'PUBLIC'` et padel (mêmes gardes que `targetLevel*`). |
| `setReservationVisibility` (`reservation.service.ts`, ouverture après coup) | Accepte `matchGender?`. Valide **tous** les participants déjà présents contre le nouveau genre ; conflit → `GENDER_PARTICIPANTS_CONFLICT`. Genre effacé (`null`) si repasse `PRIVATE`. |

`removeOpenMatchPlayer` : **aucun** contrôle (retirer un joueur est toujours permis, ne
peut pas violer la contrainte). Le **remplacement** (frontend = remove + add + setTeams)
est couvert par les contrôles de `addOpenMatchPlayer` + `setTeams`.

**Défense en profondeur** : les chemins d'ajout côté propriétaire/caisse
(`reservation.service.ts` lignes ~1370/1386/1521, association de membre / remplacement de
place) restent hors périmètre de ce lot — ils servent des résas privées / la caisse et ne
créent pas de parcours joueur vers une partie ouverte genrée. Si un jour ils touchent une
résa PUBLIC genrée, ils devront router par le même helper. Noté, pas implémenté ici.

## 4. Surfaces de création (frontend)

Le sélecteur de genre se pose là où vivent déjà la fourchette de niveau et les chips
Pour de vrai / Pour le fun :

- **`OpenMatchToggle`** (feuille « Ouvrir la partie » — calendrier / Mes réservations).
- **`OpenMatchQuickSwitch`** (écran de succès après réservation).

UI : rangée de **3 chips segmentées** `Ouverte à tous · Féminine · Mixte` (défaut
« Ouverte à tous »), même langage que les chips Pour de vrai/Pour le fun existantes.
Le choix est transmis via un paramètre **`matchGender?`** ajouté à
`api.setReservationVisibility` (et `api.applyHoldSetup` pour le chemin BookingModal).

Comportement d'erreur : si l'organisateur choisit `Féminine` sans être une femme (ou sans
sexe renseigné), la publication échoue côté serveur (`GENDER_*`) et le message mappé
s'affiche dans la bannière d'erreur existante du composant, au lieu de publier.

> Note : `BookingModal` lit la préférence de niveau mais délègue désormais l'ouverture aux
> deux switches ci-dessus (flux « Confirmer d'abord, organiser ensuite »). Le genre suit la
> même logique : réglé sur l'écran de succès, pas dans la modale. Pas de persistance locale
> du genre (contrairement à `levelPrefs`) — choix explicite à chaque partie.

## 5. Découverte (badge + filtre)

- **DTO** : champ additif **`gender: 'WOMEN' | 'MIXED' | null`** exposé dans
  `OpenMatchService.toDTO` (liste + page détail) et dans le mapper de
  `listNationalOpenMatches`. Type `OpenMatch.gender?` (optionnel, `?? null` côté UI) dans
  `frontend/lib/api.ts`.
- **Badge** : dans la rangée de chips de `OpenMatchCard`, `<Chip tone="line">Féminine</Chip>`
  / `<Chip tone="line">Mixte</Chip>` (rien si `null`). Idem sur la fiche `/parties/[id]`
  (`OpenMatchDetail`) et sur les cartes nationales de `/decouvrir`.
- **Filtre** : nouvelle dimension **Genre** (`Tous · Féminine · Mixte`) dans
  `MatchesFilterBar`, réutilisant `FacetGroup`/`FacetChip` avec `FILTER_TINTS.genre`
  (ardoise, déjà défini). État `genderFilter` dans `OpenMatches`, filtrage **client-side**
  (comme le filtre Type de partie). Défaut `Tous`.
- **`/decouvrir`** : badge affiché, **pas** de filtre genre dans ce lot (cohérent avec
  l'existant — la page nationale n'a pas de tiroir de filtres parties).

## 6. Erreurs & libellés

Codes ajoutés à `JOIN_ERRORS` (`useOpenMatchActions`) et aux maps `ERR` de
`OpenMatchToggle`/`OpenMatchQuickSwitch` :

| Code | Message |
|---|---|
| `SEX_REQUIRED` | Renseignez votre sexe dans votre profil pour les parties genrées. |
| `GENDER_NOT_FEMALE` | Cette partie est réservée aux femmes. |
| `GENDER_TEAM_FULL` | Cette partie mixte est complète pour votre catégorie. |
| `GENDER_PARTICIPANTS_CONFLICT` | Les joueurs déjà présents ne correspondent pas à ce type de partie. |

## 7. Tests

**Backend**
- `matchTeams` (helper pur) : féminine (femme OK / homme refusé), sexe manquant, mixte
  1H+1F par équipe (2e même sexe refusé, sexe opposé accepté), matchGender null = passe.
- `openMatch.service` : `joinOpenMatch` genré (résolution d'équipe, `GENDER_TEAM_FULL`),
  `addOpenMatchPlayer` genré, `setTeams` genré, exposition `gender` dans le DTO + national.
- `reservation.service` : `applyHoldSetup` (organisateur validé, genre écrit ssi PUBLIC),
  `setReservationVisibility` (validation participants existants, effacement en PRIVATE).
- Routes : passthrough du paramètre `matchGender` + codes d'erreur.

**Frontend**
- `OpenMatchToggle` / `OpenMatchQuickSwitch` : sélecteur de genre rendu, envoi du bon
  `matchGender`, message d'erreur mappé.
- `OpenMatchCard` : badge Féminine/Mixte présent/absent.
- `MatchesFilterBar` + `OpenMatches` : filtre Genre présent, filtrage effectif.
- `useOpenMatchActions` : messages `GENDER_*`.

## Hors périmètre (YAGNI)

- Parties **100% masculines**.
- Mixte **single strict** (1H vs 1F imposé en 1v1).
- **Alertes / notifications** par genre (les alertes de parties ne filtrent pas le genre).
- **Filtre genre sur `/decouvrir`**.
- **Changement de genre** après qu'un résultat de match est saisi (aligné sur la garde
  `MATCH_ALREADY_RECORDED` du type Pour de vrai/Pour le fun — si nécessaire, réutiliser la
  même garde ; sinon simplement pas de re-changement demandé ici).
- **Persistance locale** du choix de genre (pas de `genderPrefs`).

## Fichiers touchés (indicatif)

- `backend/prisma/schema.prisma` (+ migration `add_open_match_gender`)
- `backend/src/services/matchTeams.ts` (helper + `applyTeams`)
- `backend/src/services/openMatch.service.ts` (join/add/setTeams/DTO/national)
- `backend/src/services/reservation.service.ts` (`applyHoldSetup`, `setReservationVisibility`)
- routes concernées (`reservations.ts`, `clubs.ts`)
- `frontend/lib/api.ts` (types + signatures `setReservationVisibility`/`applyHoldSetup`)
- `frontend/components/reservations/OpenMatchToggle.tsx`, `OpenMatchQuickSwitch.tsx`
- `frontend/components/openmatch/OpenMatchCard.tsx`, `OpenMatchDetail.tsx`,
  `MatchesFilterBar.tsx`, `OpenMatches.tsx`, `useOpenMatchActions.ts`
- `frontend/components/clubhouse/OpenMatchesShowcase.tsx` / cartes `/decouvrir` (badge)
- suites de tests correspondantes
