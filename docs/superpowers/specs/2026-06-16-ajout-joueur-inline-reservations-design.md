# Ajout de joueur inline dans Mes réservations (parité avec Parties ouvertes)

## Contexte

Dans **Parties ouvertes** (`components/openmatch/OpenMatches.tsx`), la gestion des joueurs est
inline sur la carte : un bouton pointillé « + Ajouter un joueur » (passé en `firstSpotSlot` au
composant partagé `PlayerPills`) ouvre une recherche `PartnerSearch` sous la carte, et chaque
chip porte un `×` de retrait.

Dans **Mes réservations**, deux vues rendent des cartes de réservation, toutes deux avec des chips
**lecture seule** + un bouton **« Joueurs »** qui ouvre `ManagePlayersModal` :
- la liste agenda : `components/calendar/MyAgendaListItem.tsx`
- la vue calendrier (jour sélectionné) : `components/calendar/DayPanel.tsx`

## Objectif

Rendre l'ajout/retrait de joueurs **identique** à Parties ouvertes dans les deux vues de Mes
réservations : bouton « + Ajouter un joueur » inline + recherche sous la carte + `×` sur les chips.
Supprimer la modale, devenue redondante.

## Données (déjà disponibles)

- `MyReservation.participants` contient `{ id, userId, isOrganizer, firstName, lastName, avatarUrl }`
  (`api.ts`) → l'`id` participant permet le retrait sans appel supplémentaire.
- `api.addReservationPlayer(reservationId, memberUserId, token)` et
  `api.removeReservationPlayer(reservationId, participantId, token)` existent (utilisés par la modale)
  et renvoient le `ReservationPlayers` à jour.
- `isPlayerChangeOpen(reservation, now)` (`lib/reservations.ts`) : autorise l'édition (résa confirmée
  + délai non dépassé).

## Composants

### 1. `AddPlayerPill` (nouveau — `components/player/`)
Bouton pointillé « + Ajouter un joueur » extrait pour être **partagé**.
- Props : `onClick`, `disabled?`, `size?: 'sm' | 'md'`, `label?` (défaut « Ajouter un joueur »),
  `ariaLabel?`.
- Rendu repris tel quel de l'actuel bouton d'OpenMatches (cercle pointillé `+` + libellé, couleur accent).

### 2. `ReservationPlayersInline` (nouveau — `components/reservations/`)
Éditeur inline des joueurs d'une réservation (version non-modale de `ManagePlayersModal`).
- Props : `reservation: MyReservation`, `token: string`, `now: number`, `onChanged: () => void`.
- Calcule `canEdit = isPlayerChangeOpen(reservation, now)`.
- Rend `PlayerPills` (`size="sm"`) avec :
  - `players` = `reservation.participants` (mappés avec `participantId: p.id`) ;
  - `spotsLeft = max(0, capacity - participants.length)` ;
  - `onRemove`/`canRemove` actifs seulement si `canEdit` (et jamais sur l'organisateur) ;
  - `firstSpotSlot` = `<AddPlayerPill size="sm">` seulement si `canEdit` (donc visible tant qu'il
    reste une place, puisque c'est le 1er slot libre).
- État local `adding` : au clic sur la pill, affiche `PartnerSearch` sous la carte
  (`excludeIds` = userIds présents) ; à la sélection → `addReservationPlayer` puis `onChanged()`.
- État local `busy`/`error` ; mêmes libellés d'erreur que la modale
  (`PLAYER_CHANGE_TOO_LATE`, `RESERVATION_NOT_ACTIVE`, `TOO_MANY_PLAYERS`, `MEMBER_NOT_FOUND`,
  `PARTNER_DUPLICATE`, `CANNOT_REMOVE_ORGANIZER`, `PARTICIPANT_NOT_FOUND`, `UNAUTHORIZED`).
- Si `!canEdit` : chips lecture seule (ni `×` ni pill).

## Câblage

- `MyAgendaListItem` : pour une réservation **locale et non passée**, remplace le bloc `PlayerPills`
  lecture-seule **et** le bouton « Joueurs » par `<ReservationPlayersInline reservation={r}
  token={token} now={now} onChanged={onPlayersChanged} />`. Nouvelle prop `token` + `onPlayersChanged` ;
  suppression de la prop `onManagePlayers`. « Annuler » conservé. Cartes étrangères / passées :
  chips lecture seule, inchangé.
- `DayPanel` : même remplacement pour la carte réservation. Nouvelles props `token`, `now`,
  `onPlayersChanged` ; suppression de `onManagePlayers`. « Annuler » conservé.
- `app/me/reservations/page.tsx` : passe `token` + `now` + `onPlayersChanged={() => load(token)}` aux
  deux composants ; supprime l'état `managePlayers` et le rendu de `ManagePlayersModal`.
- `ManagePlayersModal.tsx` : devenu inutilisé → **supprimé** (vérifié : seul consommateur = la page).
- `OpenMatches` : refactor léger pour consommer `AddPlayerPill` (rendu et comportement inchangés).

## Tests (TDD)

- `AddPlayerPill` (`__tests__/AddPlayerPill.test.tsx`) : libellé par défaut + custom, `onClick`,
  état `disabled`.
- `ReservationPlayersInline` (`__tests__/ReservationPlayersInline.test.tsx`) :
  - rend un chip par participant ;
  - `canEdit` + place libre → pill « Ajouter un joueur » présente ; clic → `PartnerSearch` affichée ;
    sélection → `addReservationPlayer` appelé + `onChanged` ;
  - `×` sur un non-organisateur (canEdit) → `removeReservationPlayer` appelé ;
  - pas de `×` sur l'organisateur ;
  - `!canEdit` (délai dépassé / non confirmée) → ni pill ni `×`.
- `OpenMatches.test` : reste vert après refactor `AddPlayerPill`.
- `DayPanel.test` : mis à jour (le bouton « Joueurs » disparaît au profit de la pill inline).

## Hors périmètre (YAGNI)

- Pas de changement back-end (endpoints d'ajout/retrait inchangés).
- Pas de modification de la gestion de joueurs côté back-office admin (`PlayerPicker`).
