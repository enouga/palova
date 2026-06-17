# Annulation de match par le staff (Lot 4 — 3/3) — Design

**Date :** 2026-06-17
**Statut :** validé, prêt pour plan d'implémentation
**Feature parent :** Système de niveau de joueur (Glicko-2). Dernière sous-feature du Lot 4
(« Leaderboard + reco active Club-house + corrections staff »). Le leaderboard (Lot 4 1/3)
et la reco active « parties pour toi » (Lot 4 2/3) sont déjà livrés et poussés.

## Décision de périmètre (le « pourquoi »)

La spec d'origine prévoyait que le staff **corrige à la main un niveau aberrant** (override →
écrit `PlayerRating` + snapshot motivé). On l'écarte délibérément : donner à un humain le pouvoir
de **fixer un chiffre de niveau** est l'option la plus risquée (subjectivité du « aberrant »,
pression politique des membres pour monter/descendre, sandbagging, et surtout ça **casse la
légitimité** du système — l'intérêt du Glicko est que le niveau se *gagne*, il n'est pas *octroyé*).

À la place, le seul levier donné au staff est **factuel et défendable** : **annuler un match**
(« ce match n'a pas eu lieu / saisie erronée / triche évidente »). Ce n'est pas un jugement sportif,
c'est un constat. Le Glicko fait le reste.

**Hors v1 (assumé) :** override de niveau à la main ; re-calibration forcée d'un joueur ;
optimisation du recalcul (checkpoints/snapshots). Le rejeu intégral suffit au volume v1.

## Principe central

L'état des niveaux est une **fonction pure et déterministe de l'historique des matchs confirmés**
(le moteur Glicko-2 `applyMatchRatings` + la décote d'inactivité sont purs). Donc :

> Annuler un match = retirer ce match de l'historique → **rejouer l'historique restant**.

On ne « soustrait » pas l'effet d'un match (impossible proprement : `MatchPlayer.ratingBefore/After`
ne stocke que le **niveau 0–8** pour la courbe, pas le triplet brut `rating/rd/volatility`
d'avant-match). On reconstruit depuis l'état de départ.

## A. Moteur de recalcul

Nouvelle fonction `recomputeSportRatings(tx, sportId)` (dans le service rating, ou un module
`rating/recompute.ts` dédié) :

1. **Périmètre des joueurs à réinitialiser** = union des `userId` apparaissant dans **tous les
   matchs CONFIRMED** du sport **+ les 4 joueurs du match qu'on vient d'annuler**. (Sans ce « + »,
   un joueur dont l'unique match est annulé garderait son ancien niveau ; avec, il retombe
   correctement sur sa calibration.)
2. **Réinitialisation** de chaque joueur concerné à son **état de départ** :
   - `rating = levelToRating(initialSelfLevel ?? SKIP_DEFAULT_LEVEL)` (on **préserve**
     `initialSelfLevel`),
   - `rd = DEFAULT_RD`, `volatility = DEFAULT_VOLATILITY`, `matchesPlayed = 0`, `lastMatchAt = null`,
   - `displayLevel = ratingToLevel(rating)`, `isProvisional = isProvisional(DEFAULT_RD)`.
   - Cet état de départ est **identique** à ce que produit `calibrate()` → garantit que le rejeu
     reproduit exactement le chemin incrémental.
3. **Rejeu** : charger tous les matchs CONFIRMED du sport triés par `playedAt` **croissant** ;
   pour chacun, pour ses 4 joueurs : décote d'inactivité (`decayForInactivity`, fonction des
   `playedAt` — donc reproductible), puis `applyMatchRatings`. Mettre à jour l'état en mémoire,
   incrémenter `matchesPlayed`, poser `lastMatchAt = playedAt`, et **réécrire**
   `MatchPlayer.ratingBefore/After` (en niveau 0–8) du match rejoué.
4. **Persistance** de l'état final de chaque joueur concerné dans `PlayerRating`
   (`rating/rd/volatility/displayLevel/isProvisional/matchesPlayed/lastMatchAt`).
5. Tourne dans une **transaction Serializable** (cohérent avec `finalize`).

**Faithfulness :** la décote et les mises à jour ne dépendent que de la séquence des `playedAt` et
des états reconstruits dans le même ordre → le rejeu est fidèle. Test clé : pour un historique
propre, `recomputeSportRatings` produit **le même état** que la suite des `finalize` incrémentaux.

**Périmètre = sport (pas club) :** `PlayerRating` est par `(userId, sportId)`, global au sport.
On rejoue donc tous les matchs CONFIRMED du sport. En pratique (mono-club) cela revient au club,
mais le modèle reste correct si un joueur joue dans plusieurs clubs.

**Scaling :** O(nombre de matchs confirmés du sport). Suffisant au volume v1. Optimisation
(checkpoints périodiques) explicitement hors v1.

## B. Annulation

`voidMatch(matchId, clubId, staffUserId, reason)` :

- Charge le match en le **scopant au club** (`clubId` ≠ → `MATCH_NOT_FOUND` / 404).
- Match déjà `CANCELLED` → `ALREADY_CANCELLED` / 409.
- `reason` vide/absent → `VALIDATION_ERROR` / 400 (motif obligatoire, trimé, longueur raisonnable).
- Dans une transaction **Serializable** :
  - `Match.status = CANCELLED` + champs d'audit (section C),
  - `MatchPlayer.ratingBefore/After` du match → `null` (il sort de la courbe),
  - si le match était **CONFIRMED** (`ratingsAppliedAt` non nul) → `recomputeSportRatings(tx, sportId)`.
    Si **PENDING/DISPUTED** (niveaux jamais appliqués) → simple annulation, **pas** de recalcul.

Route : `POST /api/clubs/:clubId/admin/matches/:matchId/void` body `{ reason }`, derrière les gardes
admin existantes du routeur (club-scopé). Le flux litiges existant
(`POST …/matches/:matchId/resolve`, `resolveDispute`) **reste inchangé**.

## C. Trace d'audit

Pas de nouvelle table. 3 champs **additifs** sur le modèle `Match` :

- `cancelledAt DateTime?`
- `cancelledByUserId String?` (+ relation vers `User`, `onDelete: SetNull`)
- `cancelledReason String?`

Migration additive `add_match_cancellation`. Suffisant pour tracer **qui / quand / pourquoi**.

## D. Frontend

`/admin/matches` passe en **deux segments** (Segmented control, pattern existant) :

- **« Litiges »** : la liste actuelle (DISPUTED, boutons Valider / Annuler via `resolve`) —
  **inchangée**.
- **« Matchs confirmés »** (nouveau) : liste les matchs `CONFIRMED` récents
  (`getClubMatches(clubId, 'CONFIRMED', token)`, déjà supporté par le GET), affiche score / équipes /
  date, et un bouton **« Annuler le match »** → petite boîte de confirmation (pattern `ConfirmDialog`)
  qui **exige un motif** (champ texte) → `api.voidClubMatch(clubId, id, { reason }, token)` → recharge.
  Mention explicite : « L'annulation recalcule les niveaux des joueurs concernés et la retire de
  leur courbe de progression. » Les matchs annulés disparaissent de la liste.

Ajouts `lib/api.ts` : `voidClubMatch(...)`. Titres de page adaptés (« Matchs du club » englobant les
deux segments, ou conserver « Litiges » + sous-titre).

## E. Stratégie de tests (TDD)

**Recalcul (`rating/recompute` + service) :**
- **Déterminisme** : pour un historique de N matchs confirmés, `recomputeSportRatings` ≡ la suite
  des `finalize` incrémentaux (mêmes `rating/rd/volatility/displayLevel/matchesPlayed/lastMatchAt`).
- **Annulation d'un confirmé** : après `voidMatch`, les niveaux sont « comme si le match n'avait
  jamais eu lieu » (égalité avec un historique construit sans ce match).
- **Joueur sans match restant** → retombe sur sa calibration (`initialSelfLevel`, provisoire,
  `matchesPlayed = 0`).
- **Préservation** de `initialSelfLevel` au reset.

**Service `voidMatch` :**
- Idempotence / garde : re-annuler un `CANCELLED` → 409.
- Champs d'audit (`cancelledAt/By/Reason`) posés.
- Scope club : match d'un autre club → 404.
- PENDING/DISPUTED → annulé **sans** recalcul (les niveaux ne bougent pas).
- Motif obligatoire → 400.

**Route :** auth + garde admin, scope club, validation du motif, 404/409/400.

**Front :** présence des deux segments, l'action void appelle l'API avec le motif saisi,
rafraîchissement de la liste, motif vide bloqué côté UI.

**Courbe :** `GET /me/rating/history` filtre déjà `status: 'CONFIRMED'` → un match annulé en sort
automatiquement (test de non-régression léger).

## Fichiers concernés (indicatif)

- `backend/prisma/schema.prisma` + migration `add_match_cancellation`.
- `backend/src/services/rating/recompute.ts` (nouveau) ou méthode dans `rating.service.ts`.
- `backend/src/services/match.service.ts` : `voidMatch`.
- `backend/src/routes/admin.ts` : route `POST …/matches/:matchId/void`.
- `frontend/app/admin/matches/page.tsx` : segments + section « Matchs confirmés ».
- `frontend/lib/api.ts` : `voidClubMatch`.
- Tests associés (backend services + routes, frontend `AdminMatches.test.tsx`).
