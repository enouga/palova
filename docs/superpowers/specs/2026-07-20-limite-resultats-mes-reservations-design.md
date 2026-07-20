# Limiter l'affichage de « Passées » sur Mes réservations

**Date :** 2026-07-20
**Statut :** conçu, prêt pour plan d'implémentation

## Problème

L'onglet « Passées » de `/me/reservations` (`frontend/app/me/reservations/page.tsx`) monte
une carte `MyAgendaListItem` (grille d'équipes, avatars, chips) **par réservation passée, sans
aucune limite**. Sur un compte avec un long historique (rapporté : 192 réservations), la page
rend 192 cartes lourdes d'un coup — lent, illisible, aucun signal de « il y en a plus ».

Le fetch réseau derrière (`api.getMyReservations` → `GET /api/me/reservations` →
`ReservationService.listUserReservations`, `backend/src/services/reservation.service.ts:1686`)
est **sans `take`/cursor** : il ramène tout l'historique de l'utilisateur en une requête.

## Périmètre

**Dans le périmètre :** l'onglet « Passées » de `/me/reservations` (rendu) + un garde-fou
serveur sur `listUserReservations` (sécurité, pas un changement de comportement).

**Hors périmètre (audit ultérieur, à la demande d'Eric) :** les autres listes potentiellement
non bornées de l'app (parties ouvertes, historique de paiements admin, listes admin, etc.) —
certaines sont déjà bornées ou paginées (`/me/notifications` en cursor pagination,
`/admin/members` en vraie virtualisation via `lib/virtualList.ts`, `PaymentsHistory` en cap
serveur 100 + expand client 5). Ce spec ne couvre que le cas signalé ; le reste sera traité
dans une passe séparée si besoin.

## Décision de conception : pourquoi pas une vraie pagination réseau

Le même tableau `items` (issu de `getMyReservations`) alimente **trois** vues de la page :
le Calendrier (a besoin de tout l'historique pour afficher les mois passés), « À venir »
(naturellement petit) et « Passées » (le cas qui explose). Une vraie pagination réseau côté
« Passées » (cursor, comme `/me/notifications`) ne réduirait le fetch que pour cette liste,
mais le Calendrier aurait toujours besoin du fetch complet pour naviguer dans les mois
passés — donc le fetch ne disparaît pas, il se complexifie (deux modes de chargement pour la
même donnée). Refondre le Calendrier en fetch-par-mois-affiché réglerait le problème à la
racine, mais c'est un chantier largement plus gros que « ne pas afficher 192 cartes dans une
liste ».

**Décision (validée par Eric) :** le fetch reste inchangé (peu coûteux : quelques centaines de
Ko de JSON, requête Postgres triviale). On corrige uniquement le **rendu** de l'onglet
« Passées », avec un garde-fou serveur indépendant contre une croissance illimitée sur
plusieurs années.

## Architecture

### Frontend — `frontend/app/me/reservations/page.tsx`

- Constante `PAST_PAGE_SIZE = 20`.
- Nouvel état `pastVisible` (défaut `PAST_PAGE_SIZE`), remis à `PAST_PAGE_SIZE` dans `load()`
  à chaque rechargement réussi des données (nouvelle donnée = on repart de la première page).
- `visiblePast = past.slice(0, pastVisible)` ; la variable `list` utilisée pour le rendu
  devient `tab === 'past' ? visiblePast : upcoming` (« À venir » inchangé, naturellement petit
  — aucune fenêtre n'y est appliquée).
- Le compteur du `Segmented` (« Passées · 192 ») continue de refléter `past.length` (le total
  réel), pas `visiblePast.length` — l'utilisateur voit le total et comprend qu'il charge par
  tranches.
- Sous la grille de cartes, si `pastVisible < past.length` : un bouton pleine largeur
  (`gridColumn: '1 / -1'`), **même style visuel que le bouton « Charger plus » de
  `/me/notifications`** (`frontend/app/me/notifications/page.tsx:86-90` :
  `border: 1px solid th.line`, `background: th.surface`, `color: th.text`,
  `fontFamily: th.fontUI`, `fontWeight: 600`, coins arrondis 10px). Libellé « Charger plus ».
  Au clic : `setPastVisible(v => v + PAST_PAGE_SIZE)` — pas de requête réseau (toute la donnée
  est déjà en mémoire), donc pas d'état `loading` à gérer pour ce bouton.
- Pas de nouveau composant partagé : le bouton est dupliqué depuis le pattern existant plutôt
  que factorisé (deux occurrences, pas d'abstraction prématurée — si un 3ᵉ cas apparaît lors
  de l'audit du reste de l'app, on extraira un atome commun à ce moment-là).

### Backend — garde-fou pur

`ReservationService.listUserReservations` (`backend/src/services/reservation.service.ts:1687`)
gagne `take: 500` sur le `findMany` (`orderBy: { startTime: 'desc' }` existant garantit que ce
sont les 500 plus récentes qui sont gardées). Aucun changement de signature, aucun changement
de comportement observable aujourd'hui (500 ≫ 192) — seul appelant :
`GET /api/me/reservations` (`backend/src/routes/me.ts:105`). Filet de sécurité indépendant de
la pagination d'affichage, contre une croissance illimitée sur plusieurs années d'usage.

## Tests

- Nouveau `frontend/__tests__/MyReservationsPagination.test.tsx` : avec un mock de 50+
  réservations passées, l'onglet « Passées » n'affiche que les 20 premières cartes au premier
  rendu ; le bouton « Charger plus » est visible et son clic révèle 20 cartes de plus ; une
  fois toutes les cartes affichées, le bouton disparaît ; l'onglet « À venir » n'est pas
  affecté par cette logique (pas de fenêtre appliquée).
- `backend/src/services/__tests__/reservation.service.test.ts` (bloc `describe('listUserReservations')`
  existant, ligne 2011) : nouvelle assertion que `prismaMock.reservation.findMany` est appelé
  avec `take: 500`.

Rien d'autre ne change : Calendrier, tri (le plus récent d'abord), filtrage par club
(`showAll`/scoping), quotas, annulation, chat, saisie de résultat — tout est en dehors du
périmètre de ce fix.

## Hors périmètre

- Toute pagination/limite sur les autres listes de l'app (tournois, events, admin, etc.) —
  audit séparé à faire à la demande.
- Refonte du chargement du Calendrier (fetch par mois) — évoquée ci-dessus comme alternative
  écartée, pas comme travail futur planifié.
