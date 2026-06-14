# Retrait de joueur d'une partie ouverte (+ emails) — Design

## Contexte
Sur la page **Parties ouvertes** (`/parties`), un membre peut rejoindre une partie publique et
un participant non-organisateur peut se retirer lui-même (`leaveOpenMatch`). Il manque deux
choses : (1) l'**organisateur** doit pouvoir **retirer n'importe quel joueur** de sa partie ;
(2) chaque retrait doit **alerter par email** la bonne personne. Aujourd'hui `leaveOpenMatch`
n'envoie aucun email. Enfin, l'affichage des joueurs (avatars) doit être remplacé par les
**prénom + nom**, joliment présentés.

But : rendre la gestion de la compo d'une partie claire et notifiée, sans nouveau sous-système.

## Périmètre
**Inclus** : organisateur retire un joueur ; non-organisateur se retire lui-même ; emails à
chaque retrait ; affichage des joueurs par nom.
**Exclus (plus tard)** : notifications in-app / push, alerte aux *autres* participants restants,
toast de confirmation.

## Comportement & règles métier
Un seul point d'entrée unifié remplace `leaveOpenMatch` :
`removeOpenMatchPlayer(slug, reservationId, actorUserId, targetUserId)`.
- Transaction **Serializable + FOR UPDATE** sur la réservation (cohérent avec `join`/`leave`).
- L'acteur doit être **membre actif** du club (`resolveActiveMember`) **et** participant de la partie.
- **target == acteur** → départ volontaire (le « Quitter » actuel).
- **target ≠ acteur** → l'acteur doit être l'**organisateur**, sinon `NOT_ORGANIZER` (403).
- On ne peut **pas retirer l'organisateur** (il dissout la partie en annulant la réservation) →
  `CANNOT_REMOVE_ORGANIZER` (409).
- Cible non participante → `PARTICIPANT_NOT_FOUND` (404).
- Partie déjà passée (`startTime <= now`) → `MATCH_IN_PAST` (409), cohérent avec `join`.
- Après suppression de la ligne `ReservationParticipant`, **recalcul des parts** des restants via
  `applyShares` (existant). Les paiements éventuels du joueur retiré restent (participantId → null,
  `onDelete: SetNull`), cohérent avec la caisse.

## API
`DELETE /api/clubs/:slug/open-matches/:id/participants/:userId`
- Auth = membre connecté (mêmes gardes que join/leave). `actorUserId` = utilisateur du token,
  `targetUserId` = param d'URL.
- Réponse : `{ id }` (comme join/leave). Codes d'erreur mappés (voir règles).
- L'ancienne route `leaveOpenMatch` (`DELETE …/open-matches/:id/leave` ou équivalent) est
  **remplacée/déléguée** : « Quitter » appelle le nouvel endpoint avec `userId = soi`.

## Emails (best-effort, après commit — un échec SMTP n'annule jamais le retrait via `safeNotify`)
Deux nouvelles fonctions dans `backend/src/email/notifications.ts`, sur le modèle de
`notifyOpenMatchJoin` (chargent la résa + club hors transaction, repli silencieux si absent) :
- `notifyOpenMatchRemoved(reservationId, removedUserId)` → email **au joueur retiré** :
  « L'organisateur vous a retiré de la partie … ».
- `notifyOpenMatchLeft(reservationId, leftUserId)` → email **à l'organisateur** :
  « <Prénom Nom> a quitté votre partie … ».
- Builders d'email purs dans `backend/src/email/templates/emails.ts` (réutilisent `layout.ts`
  brandé + `links.ts` pour l'URL club et la date FR), testables isolément.
- Branchement dans `removeOpenMatchPlayer` après commit : si départ volontaire → `…Left` ;
  si retrait par l'orga → `…Removed`.

## Frontend `/parties` (`components/openmatch/OpenMatches.tsx`)
- `listOpenMatches` expose désormais le **`userId`** de chaque joueur (champ additif dans
  `players[]`, déjà disponible côté service) pour cibler le retrait.
- **Affichage des joueurs par nom** (remplace les avatars) : chaque joueur = une **pilule**
  « Prénom Nom » :
  - organisateur mis en avant (bord/teinte accent + petit libellé « orga »),
  - autres joueurs en pilule surface neutre,
  - places libres = pilule en **pointillés** « Place libre »,
  - rendu en `flex-wrap`, espacé, lisible (langage visuel Palova : `th.*`, `Chip`/atoms).
- **Actions** :
  - Si **viewer organisateur** : chaque pilule d'un *autre* joueur porte une croix « ✕ retirer »
    → confirmation légère → `api.removeOpenMatchPlayer(slug, id, targetUserId)`.
  - Si **viewer participant non-organisateur** : bouton **« Quitter »** (inchangé visuellement)
    → même endpoint avec `userId = soi`.
  - Sinon : bouton **« Rejoindre »** (inchangé).
- Messages d'erreur FR ajoutés au map existant : `NOT_ORGANIZER`, `CANNOT_REMOVE_ORGANIZER`
  (+ réutilise `MATCH_IN_PAST`, `PARTICIPANT_NOT_FOUND`).
- `api.ts` : remplacer/compléter `leaveOpenMatch` par `removeOpenMatchPlayer(slug, id, userId, token)`
  (DELETE). Garder un alias `leaveOpenMatch` = `removeOpenMatchPlayer(…, self)` si pratique.

## Tests
- **Backend** `openMatch.service.test.ts` : départ volontaire OK (parts recalculées) ; orga retire
  un joueur OK ; non-orga ne peut pas retirer un autre (`NOT_ORGANIZER`) ; retrait de l'orga refusé
  (`CANNOT_REMOVE_ORGANIZER`) ; cible absente (`PARTICIPANT_NOT_FOUND`) ; partie passée
  (`MATCH_IN_PAST`) ; bon destinataire d'email selon le cas ; **échec email non bloquant**.
- **Builders email** (`email/__tests__/emails.test.ts`) : sujets/َcorps de `…Removed` / `…Left`,
  échappement, lien club.
- **Front** : (léger) la pilule joueur affiche le nom ; la croix de retrait n'apparaît que pour
  l'organisateur sur les autres joueurs.

## Vérification end-to-end
1. `cd backend && npm test` + `cd frontend && npm test` (suites vertes) ; `tsc --noEmit` des deux côtés.
2. Démo : 3 comptes membres d'un même club. A crée une partie ouverte (PUBLIC), B et C rejoignent.
   - En tant que **A** sur `/parties` : retirer C → C reçoit un email, la compo se met à jour.
   - En tant que **B** : « Quitter » → A (organisateur) reçoit un email.
   - Vérifier l'affichage par noms (pilules, orga mis en avant, places libres en pointillés).

> Note commit : le dépôt évolue en parallèle (autre agent / dev). La spec n'est **pas** commitée
> automatiquement ; à committer sur une branche dédiée si souhaité (`git status`/`fetch` avant).
