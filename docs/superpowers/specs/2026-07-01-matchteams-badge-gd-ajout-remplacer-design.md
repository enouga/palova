# MatchTeams — repère G/D, ajout ciblé, changer un joueur

**Date :** 2026-07-01 · **Statut :** design validé

## But
Sur le composant `MatchTeams` (équipes padel, hors tournois/events), **sans changer la disposition actuelle** (équipes côte à côte, joueurs empilés) : ajouter un repère gauche/droite, permettre d'ajouter un joueur dans n'importe quel emplacement, et pouvoir remplacer/déplacer un joueur.

## Décisions (validées)
1. **Disposition inchangée** — équipes côte à côte (Éq.1 · VS · Éq.2), joueurs empilés. Pas de côte-à-côte intra-équipe (risque mobile).
2. **Repère G/D** — mini badge « G » (1er de l'équipe) / « D » (2e), **purement visuel** par ordre d'arrivée, affiché seulement en double (2 joueurs/équipe).
3. **Ajout ciblé** — un bouton « + » dans **chaque** emplacement libre ; il ajoute à **cette équipe précise**.
4. **Changer un joueur (les deux)** — taper une pastille la **sélectionne** (surlignée) et révèle une barre d'actions : **Remplacer** (recherche membre → échange la personne en gardant l'équipe), **Retirer** (×), et **Déplacer** (tape un autre joueur = échange, ou une place libre = déplacement — le tap-pour-permuter existant rendu explicite). Organisateur : ni remplacer ni retirer.
5. **Padel uniquement · aucune migration · aucun nouvel endpoint.**

## Implémentation
- **Backend (minimal)** : `team?: 1|2` optionnel sur `OpenMatchService.addOpenMatchPlayer` et `ReservationService.addOwnReservationParticipant` (+ leurs routes + `api.addOpenMatchPlayer`/`addReservationPlayer`) → le joueur ajouté est épinglé sur l'équipe choisie. Garde légère : côté visé plein ⇒ refus (`TEAM_SIDE_FULL`). Repli sans `team` = comportement actuel.
- **`components/match/MatchTeams.tsx`** :
  - Badge G/D dans `renderPlayer` selon l'index du joueur dans son équipe (`half >= 2` seulement).
  - Emplacements libres : chaque slot rend son propre `AddPlayerPill` → callback **`onAddToTeam(team)`** (remplace le prop `addSlot` unique).
  - Sélection : `picked` déjà présent ; on affiche une **barre d'actions** sous la pastille sélectionnée (**Remplacer** → `onReplace(player)`, **Retirer** → `onRemove(player)`), le déplacement restant par tap (joueur adverse / place libre).
- **Consommateurs** — `OpenMatchCard`, `ReservationPlayersInline`, `BookingModal` : état « ajout ciblé sur équipe X » (au lieu d'un simple booléen), `onReplace` (retirer + ré-ajouter dans la même équipe via endpoints existants), `onAddToTeam`. En création (`BookingModal`), tout est local (`teamsDraft` + `partners`).

## Remplacer = orchestration front
`onReplace(player)` = ouvrir la recherche → au choix du membre : retirer `player` puis ajouter le membre **avec `team = player.team`**. Réutilise remove + add(team). Pas d'endpoint « replace ».

## Tests
`__tests__/MatchTeams.test.tsx` : badge G/D, « + » par emplacement appelle `onAddToTeam(bon côté)`, sélection affiche la barre, Remplacer/Retirer déclenchent les bons callbacks, tap déplace. Backend : `addOpenMatchPlayer`/`addOwnReservationParticipant` avec `team` (placement + refus côté plein).

## Hors périmètre
Drag-and-drop ; position G/D persistée/assignable (reste par ordre) ; sports non-padel ; admin encaissement.
