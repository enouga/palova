# Planning admin — modale de création « Studio » + drag & drop de la grille

**Date** : 2026-07-12 · **Statut** : validé par Eric (brainstorming companion visuel, 3 planches)

## Problème

La modale « Nouvel événement » de `/admin/planning` est fonctionnelle mais pas belle : long
formulaire vertical, sélection des heures laborieuse (deux `TimePicker` début/fin à steppers ▲▼),
aucun feedback sur ce qu'on est en train de créer. Le gérant veut aussi manipuler le planning
directement (drag & drop), au comptoir, sur desktop.

Périmètre : **création uniquement** — la modale d'ouverture d'une résa existante (look Caisse /
`CashRegister`, 2026-07-12) ne bouge pas. Aucune migration.

## Design retenu

### 1. Modale « Studio » (piste A des maquettes)

Deux colonnes dès ~700 px (empilées en dessous, bascule CSS pure — pas de `useIsDesktop`) :

- **Gauche — le formulaire** : tabs Type (visuel actuel conservé) · Terrain + Jour sur une
  rangée · **Début** · **Durée** · Intitulé · Membre (`PlayerPicker`) · options Coaching et
  Récurrence (logique strictement identique à l'existant).
- **Droite — récap vivant** : panneau `HERO_GRADIENT` + `HERO_INK` (jamais de panneau sombre)
  qui montre **le bloc en train de naître** tel qu'il apparaîtra sur le planning (couleur du
  type, terrain, `17:00 → 18:30`, jour, durée), l'état du créneau (« Créneau libre ✓ » /
  « ⚠ Chevauche {intitulé} » — conflit ⇒ CTA désactivé, le backend refuse de toute façon
  `SLOT_NOT_AVAILABLE`), le **prix suggéré** (tarif plein/creux du terrain via `tariffCents`)
  avec champ Prix éditable (placeholder = suggéré), le résumé de récurrence (« Tous les mardis
  jusqu'au … »), et le CTA « Créer l'événement ».

### 2. Sélecteur d'heures « Clavier + raccourcis intelligents » (variante V3)

Plus d'heure de fin. **Début + durée** :

- **Début** = grand champ `HH:MM` (`inputMode=numeric`) : taper `1730` → 17:30, `9` → 09:00 ;
  parse au blur/Enter ; flèches ↑/↓ = ±15 min. En dessous, des **chips contextuelles** calculées
  en direct : « ⚡ Maintenant » (prochain quart d'heure, seulement si jour = aujourd'hui et dans
  les heures d'ouverture), « ✓ Prochain libre » (premier départ aligné 15 min où
  [début, début+durée) ne chevauche rien), heures charnières du terrain.
- **Durée** = chips 1h / 1h30 / 2h + « Autre… » (stepper ±15 min, min 30) ; défaut = durée de
  créneau du terrain (`defaultDurOf`). `endTime` est dérivé à la soumission (clampé à la
  fermeture) — les API `adminCreateReservation`/`adminCreateSeries` ne changent pas.
- Si le jour choisi ≠ jour affiché sur la grille, la modale charge les résas de ce jour
  (`adminGetReservations({date})`, cache par date) pour garder chips et détection de conflit justes.

### 3. Drag & drop sur la grille — les 3 gestes, appliqué direct + toast « Annuler »

Gestes **pointer souris** (desktop) ; le tactile garde les comportements actuels. Seuil ~5 px
pour distinguer clic (comportements actuels : ouvrir la résa / créer à l'heure pleine) et drag.

1. **Déplacer** : attraper un bloc → fantôme snappé **15 min** avec label HH:MM vivant,
   original en filigrane ; autre heure et/ou autre colonne (terrain) ; cible en conflit ou hors
   ouverture = teinte rouge, drop refusé (retour animé).
2. **Étirer / raccourcir** : poignée basse au survol du bloc → la fin bouge (snap 15 min, min 30).
3. **Créer en glissant** : drag sur le vide peint un fantôme pointillé (départ snap 30 min,
   fin snap 15) → à la relâche, la modale Studio s'ouvre **pré-remplie début + durée**.

Après déplacer/étirer : application **optimiste** + appel backend ; **toast « Annuler » 6 s**
(pattern CashRegister, z-index 55) — Annuler rappelle le même endpoint avec les valeurs
d'origine. Échap annule un drag en cours. Blocs CANCELLED non draggables. Un échec backend
revert + message d'erreur.

Polish grille : curseur `grab` sur les blocs, affordance « + HH:MM » au survol des cases vides.

## Backend — déplacement admin (nouveau)

Aucun endpoint « déplacer » n'existe (le `reschedule` joueur documenté dans CLAUDE.md a été
retiré du code). On ajoute :

- `ReservationService.adminRescheduleReservation({ clubId, reservationId, resourceId, date,
  startTime, endTime })` : transaction **Serializable + FOR UPDATE** ; gardes miroir
  d'`adminCreateReservation` (résa du club `CLUB_MISMATCH`, non CANCELLED, terrain cible du
  club, heures d'ouverture, `end > start` `VALIDATION_ERROR`) ; conflits comptés avec
  **`id != reservationId`** → `SLOT_NOT_AVAILABLE` 409 ; **prix, paiements, participants
  intacts** (un déplacement ne change jamais silencieusement ce qu'on doit ; le dû dérivé
  `totalPrice=0` suit naturellement le nouveau créneau) ; pas de re-check quota (bypass admin) ;
  une occurrence de série se déplace seule (`seriesId` conservé) ; SSE `slot_released` (ancien) +
  `slot_confirmed` (nouveau).
- **`notifyReservationRescheduled`** (`email/notifications.ts:1106`, orphelin testé) branché
  best-effort après commit quand la résa appartient à un membre.
- Route `PATCH /api/clubs/:clubId/admin/reservations/:id/schedule` (garde `requireClubMember`
  comme les autres routes résa admin) ; front `api.adminRescheduleReservation`.

## Frontend — fichiers

- `frontend/lib/planningTime.ts` (nouveau, pur, testé) : `parseTimeInput`, `addMinutes`,
  `durationBetween`, `fmtRange`, `overlapsAny`, `nextFreeStart`, `smartChips`, `snapMin`,
  `pxToMinutes` (+ clamps ouverture/fermeture, partagé avec le drag).
- `frontend/components/admin/planning/CreateEventModal.tsx` (nouveau) : la modale extraite de
  `page.tsx` ; la soumission reste dans la page (signatures API inchangées).
- `frontend/app/admin/planning/page.tsx` : rewire modale, gestes drag, polish.
- `TimePicker` n'est plus importé par le planning mais **reste** (utilisé par `DateTimeField`).

## Tests

- Front : `planningTime.test.ts` (parse, snap, overlaps, nextFreeStart, chips) ·
  `CreateEventModal.test.tsx` (durée → endTime dérivé, chips, conflit → CTA off, prix suggéré,
  récurrence) · `AdminPlanning.test.tsx` étendu. `tsc --noEmit` en garde de types.
- Back : bloc `adminRescheduleReservation` dans `reservation.service.test.ts` (succès, conflit
  excluant soi, CLUB_MISMATCH, CANCELLED, ouverture, notify non bloquant) + test route.
- Visuel : `/verify` CDP clair + sombre, 1280 & 390.

## Hors périmètre (v1)

Modale d'édition d'une résa existante · drag tactile · auto-scroll pendant le drag près des
bords · déplacement d'une série entière · notification e-mail personnalisable du déplacement
(l'e-mail existant `reservation.rescheduled` suffit) · recalcul automatique du prix au déplacement.
