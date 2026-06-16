# Système de niveau de joueur (style Playtomic/Pista) — Design

**Date :** 2026-06-16
**Statut :** validé en brainstorming, prêt pour le plan d'implémentation

## Objectif

Doter Palova d'un **système de niveau de joueur** fin et réaliste, façon Playtomic/Pista,
qui devient la fonctionnalité différenciante de la plateforme.

**Rôle principal (A) :** équilibrer les parties ouvertes (matchmaking, recommandation de
partenaires, parties « de ton niveau »).
**Rôle secondaire (B) :** vitrine/progression du joueur (niveau affiché, courbe, leaderboard).

La priorité A impose d'optimiser d'abord la **justesse** du niveau ; B s'appuie dessus.

## Décisions de cadrage (validées)

1. **Modèle de calcul : Glicko-2** (niveau + incertitude RD + volatilité), pas un simple ELO —
   pour gérer correctement les nouveaux et les joueurs peu actifs (clé de la qualité du matchmaking).
2. **Échelle affichée : 0–8 avec décimales**, mappée sur le référentiel padel « French Padel Shop »
   (1 Débutant → 8 Élite). Le moteur calcule en interne ; on affiche `displayLevel` 0–8 + palier nommé.
3. **Niveau par sport.** v1 = padel. Le 0–8 est générique ; le mapping/paliers padel est la grille v1.
4. **Calibration : auto-évaluation guidée** sur les 8 paliers → niveau provisoire à grosse incertitude,
   recalage rapide. « Passer » = départ neutre (niveau ~3, incertitude max).
5. **Saisie des résultats : 1 joueur saisit + les autres confirment** (modèle Playtomic).
6. **Sources de match : toute réservation COURT à 4 joueurs** (PUBLIC **et** PRIVATE).
   « Match libre » (sans réservation) et matchs de tournoi : hors v1.
7. **Score détaillé set par set** (ex. 6-4 / 3-6 / 7-5) — la **marge** pondère la mise à jour.
8. **Niveau global par joueur** (partagé entre tous ses clubs), **visible par les membres**,
   **pas d'option de masquage**. Statut affiché : `provisoire` (en calibrage) → `fiabilisé`.
9. **Matchmaking des parties ouvertes :** afficher le niveau (A) + fourchette cible avec
   **avertissement non bloquant** (B) + filtre/tri « à mon niveau » (C) + reco active « parties pour toi » (D).
10. **Affichage partout :** profil, pastilles joueurs, annuaire partenaires, tournois/events,
    leaderboard de club, back-office (correction + litiges).
11. **Anti-triche & inactivité :**
    - Score contesté → match en **litige**, **aucun impact** niveau, **le staff tranche** dans `/admin`.
    - Pas de confirmation/contestation sous **72 h** → **auto-validation** du match.
    - Inactivité → le niveau **ne baisse pas** ; l'**incertitude remonte** (décote d'inactivité lazy, à la Glicko).
    - **Période provisoire** (premiers ~5–10 matchs) → badge « en calibrage », exclu du leaderboard.
    - Garde-fou anti-fermage : **rendements décroissants** si toujours les mêmes 3 partenaires.

## Principes d'architecture

- Le moteur Glicko-2 est un **module pur, isolé et testable** : entrées (niveaux/RD/volatilité +
  scores), sorties (nouveaux niveaux/RD/volatilité). Aucune dépendance DB.
- Le reste du site ne voit jamais l'interne : seulement `displayLevel` (0–8), le **palier nommé**,
  et le statut `provisoire/fiabilisé`.
- Niveau **global par `(userId, sportId)`** ; le **matchmaking et le leaderboard sont scopés au club**
  courant (on n'affiche/propose que ses membres), mais la **note** est globale.
- Toutes les migrations sont **additives** (cohérent avec l'historique du projet).

## Modèle de données (Prisma — additif)

### `PlayerRating` (nouveau)
Niveau global d'un joueur pour un sport.

| champ | type | rôle |
|---|---|---|
| id | String cuid | PK |
| userId | String | FK User |
| sportId | String | FK Sport |
| rating | Float | note interne Glicko-2 (µ, ~1500 au départ) |
| rd | Float | incertitude (RD, ~350 au départ) |
| volatility | Float | volatilité Glicko-2 (σ, ~0.06) |
| displayLevel | Float | **0–8 dénormalisé** (tri/filtre rapides) |
| matchesPlayed | Int | nb de matchs comptabilisés |
| lastMatchAt | DateTime? | dernier match (base de la décote d'inactivité lazy) |
| isProvisional | Boolean | dérivé du RD (dénormalisé pour le filtrage) |
| initialSelfLevel | Float? | palier d'auto-éval (1–8), null si « passé » |
| createdAt / updatedAt | DateTime | |

`@@unique([userId, sportId])`, index `[sportId, displayLevel]` (leaderboard/matchmaking).

### `Match` (nouveau)
Un résultat de match enregistré.

| champ | type | rôle |
|---|---|---|
| id | String cuid | PK |
| clubId | String | contexte de jeu |
| sportId | String | sport |
| reservationId | String? | résa source (null réservé au futur « match libre ») |
| playedAt | DateTime | date du match |
| status | enum | PENDING / CONFIRMED / DISPUTED / CANCELLED |
| createdByUserId | String | qui a saisi |
| sets | Json | `[[6,4],[3,6],[7,5]]` (équipe1, équipe2 par set) |
| winningTeam | Int? | 1 ou 2 (dérivé des sets) |
| confirmDeadline | DateTime | playedAt/createdAt + 72 h |
| createdAt / updatedAt | DateTime | |

Index `[clubId, status, playedAt]`, `[reservationId]`.
**Invariant :** au plus **une `Match` non-CANCELLED par `reservationId`** (garde-fou service —
Prisma ne fait pas d'unique partiel ; vérifié dans la transaction de création).

### `MatchPlayer` (nouveau)
Les 4 joueurs d'un match + leur confirmation + snapshots.

| champ | type | rôle |
|---|---|---|
| id | String cuid | PK |
| matchId | String | FK Match (onDelete Cascade) |
| userId | String | FK User |
| team | Int | 1 ou 2 |
| confirmation | enum | PENDING / CONFIRMED / DISPUTED |
| ratingBefore | Float? | displayLevel avant (snapshot) |
| ratingAfter | Float? | displayLevel après (snapshot → courbe + audit) |

`@@unique([matchId, userId])`, index `[userId]`.
La **courbe de progression** se lit depuis `MatchPlayer.ratingAfter` du joueur, ordonné par
`match.playedAt` (pas de table d'historique séparée en v1).

### `Reservation` (étendu — 2 colonnes additives)
Fourchette de niveau cible des parties ouvertes (n'a de sens que pour `visibility = PUBLIC`).

| champ | type | rôle |
|---|---|---|
| targetLevelMin | Float? | borne basse (0–8), null = pas de cible |
| targetLevelMax | Float? | borne haute (0–8) |

### Enums nouveaux
`MatchStatus { PENDING, CONFIRMED, DISPUTED, CANCELLED }`,
`MatchPlayerConfirmation { PENDING, CONFIRMED, DISPUTED }`.

## Moteur de calcul (cœur « fin et réaliste »)

Module pur `backend/src/services/rating/` :

- **`glicko2.ts`** : implémentation standard Glicko-2 (rating period → nouveau µ, RD, σ).
  Entrée : état du joueur + liste d'« adversaires virtuels » (µ, RD) + score `s ∈ [0,1]`.
- **Adaptation doubles** : pour mettre à jour un joueur, l'adversaire = **l'équipe adverse**
  (moyenne des 2 notes, RD combinée) traitée comme **un** adversaire virtuel. Le score espéré
  Glicko utilise la note **propre** du joueur → un joueur faible qui bat une équipe forte gagne
  beaucoup ; un fort qui « porte » un faible gagne peu.
- **Score pondéré par la marge** (`outcomeScore`) :
  `s = clamp(0,1, 0.5 + 0.5·(jeuxPour − jeuxContre)/(jeuxPour + jeuxContre))`.
  6-0/6-0 → s ≈ 1,0 ; 7-6/7-6 → s ≈ 0,54 ; **perdre serré** contre plus fort peut faire monter
  (s côté perdant > score espéré). Repli « vainqueur seul » possible (marge neutre s = 1/0).
- **Mapping interne ↔ 0–8** (`level.ts`) : linéaire calibré par constantes ajustables
  (ancre : rating 1500 ≈ palier ~3–4 ; chaque palier ≈ N points). L'auto-éval (palier 1–8)
  fixe le `rating` de départ via le mapping inverse, `rd` = max, `σ` défaut.
- **`isProvisional`** = `rd > SEUIL_FIABILITE` (≈ premiers 5–10 matchs).
- **Décote d'inactivité (lazy)** : avant chaque mise à jour, le RD est regonflé selon le nombre de
  « périodes » écoulées depuis `lastMatchAt` (formule Glicko-2). **Aucun cron.** Le niveau ne
  baisse jamais ; seule l'incertitude remonte → au retour, recalibrage rapide.
- **Anti-fermage** : facteur de **rendement décroissant** si le joueur enchaîne des matchs avec
  exactement le même trio (pondère l'amplitude de la mise à jour).

La mise à jour des 4 `PlayerRating` est appliquée **en transaction Serializable** à la
confirmation du match, avec snapshots `ratingBefore/After` sur chaque `MatchPlayer`.

## Flux fonctionnels

### Calibration (auto-évaluation)
Au 1er accès à la feature (ou prompt sur le profil) : la grille des 8 paliers (descriptions
French Padel Shop) s'affiche, le joueur se positionne (1–8) → `PlayerRating` créé (rating dérivé,
RD max, `isProvisional = true`). « Passer » → niveau ~3 neutre, RD max. Idempotent : un seul
`PlayerRating` par `(user, sport)`.

### Enregistrement & confirmation d'un match
1. Depuis une réservation COURT passée à **4 participants** (`ReservationParticipant`, ouverte ou
   privée) : action **« Saisir le résultat »**.
2. UI : répartir les 4 en **équipe 1 / équipe 2** (2+2) + **scores set par set** (2–3 sets).
3. Création `Match` (PENDING, `confirmDeadline = now + 72 h`) + 4 `MatchPlayer`
   (le saisisseur `CONFIRMED`, les 3 autres `PENDING`). Notif aux 3 autres
   (réutilise l'infra email `src/email/notifications.ts`).
4. Chaque joueur **confirme** ou **conteste** :
   - **Tous confirment** OU **72 h écoulées** → `CONFIRMED` → application des niveaux (transaction).
   - **Au moins une contestation** → `DISPUTED` → **aucun impact**, remonté au staff `/admin`.
5. **Idempotence/anti double-comptage** : au plus une `Match` active par réservation ; la mise à
   jour des niveaux n'est appliquée qu'**une fois**, au passage en `CONFIRMED`.

### Litige
Le staff résout dans `/admin` (surface F) : valider, corriger le score, ou annuler le match.
Pas d'arbitrage automatique en v1.

## Intégrations « sur tout le site »

- **Parties ouvertes** (`OpenMatches`) :
  - (A) pastille niveau par joueur (réutilise `PlayerPills` + badge niveau).
  - (B) **fourchette cible** `targetLevelMin/Max` à la création ; à l'inscription hors zone →
    **avertissement** non bloquant (« cette partie est au-dessus/dessous de ton niveau, rejoindre
    quand même ? »).
  - (C) **filtre/tri « à mon niveau »** sur la liste (helper pur de proximité).
  - (D) **reco active** « X parties pour toi » au Club-house (niveau + dispo) — **lot final**.
- **Profil** (`/me/profile`, `ProfileMenu`) : carte niveau + palier nommé + **fiabilité** +
  **courbe de progression** (depuis les snapshots).
- **Pastilles partout** : `PlayerPills`, sélecteur de partenaires `BookingModal`, « Mes réservations ».
- **Annuaire partenaires** (`members/search`) : `displayLevel` à côté du nom.
- **Tournois/events** : niveau des inscrits sur les fiches (affichage simple ; seeding plus tard).
- **Leaderboard de club** : onglet « Classement » rangé par `displayLevel`, **exclut les provisoires**,
  met en avant les **plus fortes progressions** à côté du top.
- **Back-office** (`/admin`) : le staff voit les niveaux des membres, **corrige** un niveau aberrant
  (override → écrit `PlayerRating` + snapshot motivé), et gère la **file des litiges**.

## Découpage en lots (chacun TDD, livrable indépendamment)

1. **Fondations rating** : `PlayerRating` + moteur Glicko-2 + mapping 0–8 + calibration (auto-éval) +
   affichage profil (carte niveau + courbe). Migration additive.
2. **Matchs** : `Match`/`MatchPlayer` + saisie depuis réservations + confirmation/contestation +
   auto-validation 72 h + notifs + application des niveaux (transaction) + file de litiges admin.
3. **Parties ouvertes & affichage transverse** : pastilles niveau, fourchette cible + avertissement,
   filtre/tri « à mon niveau », niveau dans l'annuaire, affichage tournois/events.
4. **Leaderboard + reco active Club-house + corrections staff**.

## Stratégie de tests

- **Moteur pur** : vecteurs Glicko-2 connus, monotonie (gagner monte / perdre baisse), **effet de la
  marge** (6-0 > 7-6), convergence des provisoires, **décote d'inactivité** (le RD remonte avec le temps),
  anti-fermage.
- **Mappings purs** : interne↔0–8, `outcomeScore`, `isProvisional`.
- **Helpers matchmaking purs** : proximité/filtre/tri, dans/hors fourchette.
- **Services** : flux de confirmation, auto-validation 72 h, litige (aucun impact), idempotence
  (pas de double-comptage), transaction Serializable.
- **Routes API** : saisie, confirmation, contestation, leaderboard, override staff.
- **Composants front** : badge niveau, formulaire de saisie set par set, avertissement de fourchette,
  leaderboard, courbe de progression.

## Hors périmètre v1

- « Match libre » sans réservation ; matchs de tournoi/poules avec scores.
- Seeding automatique des tableaux de tournoi par niveau.
- Reco active D (déplacée en lot 4, après volume de données).
- Mapping/paliers pour d'autres sports que le padel (l'architecture le permet).
- Arbitrage automatique des litiges ; file d'envoi d'emails dédiée (rappels avant échéance).
