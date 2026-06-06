# Création d'événements par l'admin depuis le planning — Design

Date : 2026-06-06

## Contexte

La page `/admin/planning` (back-office club) affiche aujourd'hui une timeline des réservations
du jour (un terrain par ligne, heures en colonnes). On peut **cliquer une réservation existante**
pour changer son type, encaisser un paiement ou l'annuler — mais **on ne peut rien créer**.
Côté backend, il n'existe pas de route admin de création de réservation
(`POST .../admin/reservations` absent) ; la seule création passe par le flux joueur
(`reservation.service.holdSlot` → `confirmReservation`).

Voir l'état du code : `frontend/app/admin/planning/page.tsx`, `backend/src/routes/admin.ts`,
`backend/src/services/reservation.service.ts`.

## Objectif

Permettre à un **gestionnaire de club** (admin/staff, déjà authentifié et scopé par
`/api/clubs/:clubId/admin`) de **créer une entrée de n'importe quel type directement depuis le
planning**, qui **bloque le créneau** sur le terrain choisi.

Les 4 types sont ceux qui existent déjà (`ReservationType`) :
Terrain (`COURT`), Coaching (`COACHING`), Tournoi (`TOURNAMENT`), Événement (`EVENT`).

## Hors périmètre (v1)

- **Récurrence** (un événement qui se répète chaque semaine) — à ajouter plus tard si besoin.
- Modification (drag/redimensionnement) d'une entrée existante — l'édition se limite au type /
  paiement / annulation déjà en place.
- Paiement en ligne — `price` est purement informatif, l'encaissement manuel existant s'applique.

## Décision de modèle de données — Option B (migration additive)

Un événement = une **réservation** ordinaire, créée directement en statut **`CONFIRMED`**.

**Migration additive** sur le modèle `Reservation` :
- `userId` devient **optionnel** (`String?`, relation `user` optionnelle) — un événement sans
  joueur a `userId = null`.
- Ajout d'une colonne **`title String?`** — l'intitulé libre de l'événement.

Renseignement à la création :
- Le **membre** est optionnel : s'il est choisi → `userId` = ce membre ; sinon → `userId = null`.
- L'**intitulé** → `title`.
- Le **type** → `Reservation.type`. `totalPrice` = prix saisi, **défaut `0`**.

La migration est **purement additive** (aucune donnée existante cassée : toutes les réservations
actuelles ont déjà un `userId` ; `title` est nullable). Nom indicatif :
`add_reservation_event_fields`. Elle s'appliquera en prod au prochain déploiement via
`prisma migrate deploy`.

### Endroits touchés par le `userId` nullable
- `frontend/app/admin/planning/page.tsx` + type `ClubReservation` : `user` peut être `null` →
  afficher `title` sinon le nom du joueur (cf. ci-dessous).
- `reservation.service.listClubReservations` : l'`include` `user` peut renvoyer `null` (ok).
- Flux joueur (`confirmReservation`, `cancelReservation`) : inchangés — ils comparent `userId` au
  joueur connecté ; un événement (`userId = null`, créé CONFIRMED) n'y passe jamais.
- `listUserReservations(userId)` : un événement sans joueur n'apparaît dans la liste d'aucun joueur
  (voulu).

## Affichage planning

Sur la timeline et dans la modale, l'**étiquette** d'une entrée devient :
`title` (l'intitulé) s'il est renseigné, **sinon** le nom du joueur (`user.firstName user.lastName`),
en gérant le cas `user = null` (événement sans joueur → on s'appuie sur `title`). `title` (et `type`)
sont retournés par `listClubReservations` (findMany via `include`) — à exposer dans le type
`ClubReservation` côté front, où `user` devient également optionnel.

## Backend

### Route

`POST /api/clubs/:clubId/admin/reservations` (ajout dans `backend/src/routes/admin.ts`, à côté des
handlers `reservations/:id/...` existants, donc derrière l'auth + le scope club déjà en place).

Corps attendu :

```
{
  resourceId: string,
  date:       "YYYY-MM-DD",   // jour local du club
  startTime:  "HH:mm",        // heure locale du club
  endTime:    "HH:mm",        // heure locale du club
  type:       "COURT" | "COACHING" | "TOURNAMENT" | "EVENT",
  title?:     string,         // → title
  memberUserId?: string,      // → userId (null si absent)
  price?:     number          // → totalPrice, défaut 0
}
```

> Le client envoie **date + heures locales** (pas un ISO) ; le backend convertit en UTC avec
> `club.timezone` via luxon (même approche que le reste du service). Ça évite les bugs de fuseau
> côté navigateur.

### Service

Nouvelle méthode `reservationService.adminCreateReservation({ clubId, resourceId, startUtc, endUtc, type, title?, memberUserId?, price? })` :

1. Charge la ressource ; **vérifie qu'elle appartient à `clubId`** (sinon `CLUB_MISMATCH`).
2. Valide : `endUtc > startUtc`, `type` ∈ enum, `price >= 0`. Sinon `VALIDATION_ERROR`.
3. Si `memberUserId` fourni : vérifie que ce membre appartient au club (sinon `VALIDATION_ERROR`)
   → `userId` = ce membre. Sinon `userId = null`.
4. **Pas** d'`assertMembershipAndWindow` : l'admin n'est pas soumis aux limites joueur
   (adhésion, fenêtre de réservation) — il peut bloquer n'importe quelle date.
5. Dans une **transaction Serializable**, vérifie l'**absence de chevauchement** sur le terrain
   (mêmes prédicats que `holdSlot` : `CONFIRMED`, ou `PENDING` récent < 10 min, qui chevauche
   `[start, end)`). Si conflit → `SLOT_NOT_AVAILABLE`.
6. Crée la réservation `status: 'CONFIRMED'`, `type`, `title`, `userId` (membre ou `null`), `totalPrice`.
7. Broadcast SSE `slot_confirmed` sur la ressource (les vues joueur live se mettent à jour).

Mapping HTTP (à ajouter au `ERROR_STATUS` des routes admin) :
`CLUB_MISMATCH` → 403, `VALIDATION_ERROR` → 400, `SLOT_NOT_AVAILABLE` → 409,
`RESOURCE_NOT_FOUND` → 404.

## Frontend (`/admin/planning`)

### Déclenchement

- Un bouton **« + Ajouter »** dans l'en-tête (toujours disponible).
- **Clic sur une zone vide** d'une ligne terrain → ouvre la modale **pré-remplie** avec le terrain
  de la ligne et l'heure approximative cliquée (arrondie au pas du terrain `slotStepMin`).

### Modale de création (réutilise le style de la modale détail existante)

Champs :
- **Type** : sélecteur segmenté (les 4 types, mêmes couleurs que `TYPE_META`).
- **Terrain** : liste déroulante des terrains actifs (pré-sélectionné si clic).
- **Date** : champ date (défaut = jour affiché).
- **Début / Fin** : champs heure (défaut depuis le clic ; bornés aux `openHour`/`closeHour`).
- **Intitulé** : texte optionnel (placeholder selon le type, ex. « Maintenance », « Tournoi P100 »).
- **Membre** : champ de recherche optionnel dans le fichier-membres (réutilise l'API admin membres
  existante) ; effaçable.
- **Prix €** : optionnel, défaut 0.

Validation côté UI : `fin > début`. À la soumission → `api.adminCreateReservation(clubId, payload, token)`
→ ferme la modale → `load()` (recharge le planning). Erreurs affichées dans la bannière existante.

### Client API

Ajout `adminCreateReservation(clubId, payload, token)` dans `frontend/lib/api.ts`
(et sur le type `ClubReservation` : ajouter `title?: string` et rendre `user` optionnel).

## Cas limites & erreurs

- **Chevauchement** : refus 409 « Créneau déjà pris » (ne casse pas une résa existante).
- **Hors horaires d'ouverture** du terrain : **autorisé**, sans borne (l'admin peut bloquer
  avant/après ; la zone hachée du planning reste cohérente).
- **Terrain d'un autre club** : 403 (vérif `clubId`).
- **Membre hors club** : 400.
- Création en `CONFIRMED` → le créneau est immédiatement indisponible côté joueur (le check de
  conflit de `holdSlot` compte les `CONFIRMED`).

## Tests

- **Service** (Jest, mock Prisma + un test e2e jetable contre la vraie DB pour le chevauchement) :
  création OK (avec membre → `userId` rempli / sans membre → `userId = null`), `CLUB_MISMATCH`,
  chevauchement `SLOT_NOT_AVAILABLE`, `VALIDATION_ERROR` (fin ≤ début, prix < 0).
- **Route** (supertest) : 201 création, 400/403/404/409 mappés.
- **Front** : rendu de la modale + soumission (mock `api.adminCreateReservation`), étiquette =
  `title` quand présent (y compris `user = null`).
- Vérif manuelle navigateur sur `/admin/planning` (créer chaque type, vérifier le blocage côté joueur).
```
