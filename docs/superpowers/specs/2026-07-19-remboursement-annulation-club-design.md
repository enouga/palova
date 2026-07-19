# Remboursement automatique quand le club annule (tournois & events)

**Date :** 2026-07-19
**Statut :** conçu, prêt pour plan d'implémentation

## Problème

Le `RefundService` (remboursement Stripe + recrédit prépayé, idempotent) fonctionne mais
n'est câblé que sur **trois** chemins :

- désinscription du joueur lui-même (tournoi/event, avant clôture) → `cancelRegistration`
- annulation d'une réservation, **seulement** si `refundOnCancelWithinCutoff` activé et dans
  la fenêtre → `autoRefundOnCancel`
- remboursement **manuel** par le club → `POST /payments/:id/refunds`

Il **manque** sur les annulations à l'initiative du club côté tournois/events :

1. **Club annule un tournoi/event complet** (`updateTournament`/`updateEvent` avec
   `status=CANCELLED`) : seul un email part (`notifyActivityCancelledByClub`), aucun inscrit
   payé en ligne n'est remboursé, et les inscriptions restent `CONFIRMED/PAID`.
2. **Admin ou juge-arbitre retire un binôme/inscrit** (`adminRemoveRegistration`) : la place
   est annulée, le suivant en liste d'attente est même **débité** (`safeCharge`), mais le
   binôme retiré n'est **pas** remboursé.

Un joueur qui a payé en ligne se retrouve sans remboursement automatique alors qu'il n'est
pas à l'origine de l'annulation.

## Périmètre

**Dans le périmètre :** tournois + events, sur les 2 chemins ci-dessus (4 méthodes au total,
tournoi + event pour chacun).

**Hors périmètre :** les réservations. Leur annulation par le club reste régie par la
politique `refundOnCancelWithinCutoff` + fenêtre de cutoff — c'est un choix délibéré du club,
pas un bug. Aucun changement.

## Décisions de conception

1. **Quoi rembourser.** Réutiliser la logique déjà éprouvée de `cancelRegistration` : une
   inscription est remboursable si `paymentStatus === 'PAID'` **et** qu'il existe un `Payment`
   `method: 'ONLINE'` lié (`tournamentRegistrationId` / `eventRegistrationId`). Remboursement
   du montant total, puis `paymentStatus: 'REFUNDED'`. Les inscriptions en **liste d'attente**
   (carte enregistrée via SetupIntent, **jamais débitée**) n'ont rien à rembourser → exclues
   d'office par le filtre `PAID`.

2. **Pas de vérification de fenêtre/deadline.** Quand c'est le **club** qui annule, on
   rembourse toujours (le joueur subit l'annulation, il ne part pas en retard). Le `safeRefund`
   existant ne vérifie déjà pas la deadline — cohérent.

3. **Statut des inscriptions sur annulation d'activité complète.** Ne **pas** toucher à
   `registration.status` : le tournoi/event est déjà `CANCELLED`, laisser les inscriptions
   `CONFIRMED` est sans effet. On passe seulement `paymentStatus` à `REFUNDED`. Le
   remboursement se fait **après** la notif (`notifyActivityCancelledByClub` cible les regs
   `CONFIRMED/WAITLISTED` par `status`, jamais par `paymentStatus` → aucune interférence).
   Pour le retrait admin, `cancelAndPromoteTx` passe déjà la reg en `CANCELLED` — inchangé.

4. **Best-effort, post-commit.** Même pattern que l'existant : l'annulation est déjà committée,
   un remboursement Stripe qui échoue est loggé mais ne casse jamais l'annulation (le club
   garde le bouton « Rembourser » manuel en repli). L'idempotence anti-double-remboursement
   est déjà garantie par `RefundService`.

5. **Motifs tracés.** `« Annulation par le club »` (activité complète), `« Retrait par le
   club »` (retrait d'un binôme) — distincts de l'existant `« Désinscription avant clôture »`.

## Architecture

Réutiliser le pattern `safeRefund` déjà présent dans chaque service, sans refonte. Les deux
services restent volontairement parallèles (modèles séparés) — pas de helper transverse
tournoi+event (couplage inutile pour ~15 lignes, YAGNI).

### `TournamentService`

- **Nouvelle méthode privée `refundAllPaidRegistrations(tournamentId, clubId, reason)`** :
  requête des inscriptions `CONFIRMED` en `paymentStatus PAID` + leur `Payment` ONLINE,
  boucle `safeRefund` best-effort sur chacune.
- **`updateTournament`** : sur la transition vers `CANCELLED` (déjà détectée pour la notif),
  appeler `refundAllPaidRegistrations(..., 'Annulation par le club')` **après** la notif.
- **`adminRemoveRegistration`** : étendre la requête intra-transaction pour capturer
  `paymentStatus` et le `Payment` ONLINE (comme `cancelRegistration` construit son
  `refundInfo`), puis `safeRefund(..., 'Retrait par le club')` post-commit si la reg retirée
  était `PAID`.

### `EventService`

Symétrique : `refundAllPaidRegistrations` sur `updateEvent` (transition `CANCELLED`) et
`refundInfo` + `safeRefund` sur `adminRemoveRegistration`. Les inscriptions event sont
**individuelles** (pas de binôme) — un seul `Payment` par reg via `eventRegistrationId`.

### `safeRefund` existant (réutilisé)

Signature actuelle `safeRefund({ paymentId, amount, regId }, clubId)` → appelle
`RefundService.refund` puis passe la reg en `REFUNDED`. Le `reason` est aujourd'hui codé en dur
(`'Désinscription avant clôture'`) : le paramétrer (ajouter un argument `reason`) pour porter
les nouveaux motifs.

## Tests

Étendre `tournament.service.test.ts` et `event.service.test.ts`, mocks `prismaMock` +
`RefundService` (déjà en place dans les suites existantes) :

- **annulation club** → chaque inscription `PAID` remboursée (`RefundService.refund` appelé par
  reg), `paymentStatus` passé à `REFUNDED`, motif correct.
- **retrait admin** → binôme/inscrit `PAID` remboursé ; inscription non payée ou en **liste
  d'attente** → **aucun** remboursement.
- **échec de remboursement** (RefundService rejette) → l'annulation réussit quand même
  (best-effort, l'exception est avalée et loggée).

## Hors v1

- Remboursement des réservations à l'initiative du club (reste policy-gated).
- Email de remboursement dédié (l'email « annulé par le club » existant suffit).
- Remboursement partiel / au prorata.
