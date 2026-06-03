# Tournois de padel — Design (v1 : inscriptions)

> Spec validée le 2026-06-03. Gestion des tournois de padel par catégorie (P25→P2000),
> avec genre (Messieurs / Dames / Mixte contrôlé), inscription en binôme, et
> modification/annulation jusqu'à une date limite. Périmètre v1 : **inscriptions
> seulement** (ni tableaux/poules/scores, ni paiement en ligne).

## 1. Objectif & périmètre

Permettre à un club de publier des tournois et aux joueurs de s'y inscrire en binôme.

**Dans le périmètre v1 :**
- Le club crée/publie/annule des tournois (catégorie P, genre, dates, deadline, places, frais).
- Un joueur connecté inscrit un binôme (lui + un coéquipier), modifie le coéquipier ou se
  désinscrit, jusqu'à une **date/heure limite** propre au tournoi.
- Les deux joueurs doivent être **membres du club** (compte + adhésion `ACTIVE`), avoir un
  **téléphone** et une **licence** (`membershipNo`), et un **sexe** renseigné.
- Liste d'attente quand le nombre de binômes max est atteint, avec promotion automatique.
- Lien « Tournois » sur la page d'accueil du club.

**Hors périmètre v1 (évolutions futures) :**
- Tableaux / poules / arbre, saisie des scores et résultats.
- Paiement en ligne des frais d'inscription (l'`entryFee` est purement informatif).
- Blocage automatique de terrains par un tournoi (on conserve `Reservation.type = TOURNAMENT`
  pour ce futur usage, mais une inscription n'est pas une réservation de créneau).
- Notifications e-mail (promotion liste d'attente, rappels) — le statut est visible dans l'app.

## 2. Décisions clés (issues du brainstorming)

| Sujet | Décision |
|---|---|
| Périmètre | Inscriptions seulement |
| Coéquipier | Compte **+ membre du club obligatoire** des deux côtés (tél + licence vérifiés) |
| Mixte | **Contrôle strict** du genre → sexe (H/F) ajouté au profil `User` |
| Deadline | **Date/heure limite explicite** par tournoi (`registrationDeadline`) |
| Places | **Liste d'attente** quand complet, promotion auto |
| Modèle binôme | **Approche A** : 1 inscription = 1 ligne référençant 2 `User` (capitaine + partenaire) |
| Catégorie | **String** piloté par une liste éditable (pas un enum figé) |
| Sexe | stocké sur **`User`** (intrinsèque), pas sur l'adhésion |

## 3. Modèle de données (Prisma)

Migration **additive** (aucune colonne existante modifiée ou supprimée).

### Nouveaux enums
```prisma
enum Sex { MALE FEMALE }
enum TournamentGender { MEN WOMEN MIXED }        // Messieurs / Dames / Mixte
enum TournamentStatus { DRAFT PUBLISHED CANCELLED }
enum RegistrationStatus { CONFIRMED WAITLISTED CANCELLED }
```

### `User` (ajouts)
```prisma
sex Sex?                                          // requis seulement à l'inscription tournoi
captainRegistrations TournamentRegistration[] @relation("CaptainRegistrations")
partnerRegistrations TournamentRegistration[] @relation("PartnerRegistrations")
```

### `Tournament`
```prisma
model Tournament {
  id                   String           @id @default(cuid())
  clubId               String           @map("club_id")
  clubSportId          String           @map("club_sport_id")        // padel par défaut
  name                 String
  category             String                                        // "P25","P100",…
  gender               TournamentGender
  description          String?
  startTime            DateTime         @map("start_time") @db.Timestamptz
  endTime              DateTime?        @map("end_time") @db.Timestamptz
  registrationDeadline DateTime         @map("registration_deadline") @db.Timestamptz
  maxTeams             Int?             @map("max_teams")            // null = illimité
  entryFee             Decimal?         @map("entry_fee") @db.Decimal(10, 2)  // informatif
  status               TournamentStatus @default(DRAFT)
  createdAt            DateTime         @default(now()) @map("created_at")
  updatedAt            DateTime         @updatedAt @map("updated_at")

  club          Club                     @relation(fields: [clubId], references: [id], onDelete: Cascade)
  clubSport     ClubSport                @relation(fields: [clubSportId], references: [id], onDelete: Restrict)
  registrations TournamentRegistration[]

  @@index([clubId])
  @@index([clubId, status, startTime])
  @@map("tournaments")
}
```
Relations inverses à ajouter : `Club.tournaments Tournament[]`, `ClubSport.tournaments Tournament[]`.

### `TournamentRegistration`
```prisma
model TournamentRegistration {
  id            String             @id @default(cuid())
  tournamentId  String             @map("tournament_id")
  captainUserId String             @map("captain_user_id")           // joueur connecté qui inscrit
  partnerUserId String             @map("partner_user_id")           // son coéquipier
  status        RegistrationStatus @default(CONFIRMED)
  cancelledAt   DateTime?          @map("cancelled_at")
  createdAt     DateTime           @default(now()) @map("created_at") // = ordre liste d'attente
  updatedAt     DateTime           @updatedAt @map("updated_at")

  tournament Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  captain    User       @relation("CaptainRegistrations", fields: [captainUserId], references: [id], onDelete: Restrict)
  partner    User       @relation("PartnerRegistrations", fields: [partnerUserId], references: [id], onDelete: Restrict)

  @@index([tournamentId, status, createdAt])
  @@map("tournament_registrations")
}
```

**Intégrité « un joueur dans un seul binôme actif par tournoi »** : garantie au niveau
service (transaction avec verrou sur la ligne tournoi). Durcissement optionnel ultérieur :
index uniques partiels SQL sur `(tournament_id, captain_user_id)` et
`(tournament_id, partner_user_id)` `WHERE status <> 'CANCELLED'`.

## 4. Règles métier (`TournamentService`)

### 4.1 S'inscrire — `POST /tournaments/:id/register` `{ partnerEmail }`
Capitaine = utilisateur connecté ; coéquipier recherché par e-mail. Validations ordonnées :

| Vérification | Code d'erreur | HTTP |
|---|---|---|
| Tournoi `PUBLISHED` | `TOURNAMENT_NOT_OPEN` | 409 |
| `now < registrationDeadline` | `REGISTRATION_CLOSED` | 409 |
| Partenaire existe (compte) | `PARTNER_NOT_FOUND` | 404 |
| Capitaine ≠ partenaire | `PARTNER_IS_SELF` | 400 |
| Les 2 sont membres `ACTIVE` du club | `MEMBERSHIP_REQUIRED` / `MEMBERSHIP_BLOCKED` | 403 |
| Les 2 ont `phone` | `PHONE_REQUIRED` | 422 |
| Les 2 ont une licence (`membershipNo`) | `LICENSE_REQUIRED` | 422 |
| Les 2 ont `sex` | `SEX_REQUIRED` | 422 |
| Composition conforme au `gender` | `GENDER_MISMATCH` | 422 |
| Aucun des 2 déjà dans un binôme actif du tournoi | `ALREADY_REGISTERED` | 409 |

Les erreurs `PHONE/LICENSE/SEX/MEMBERSHIP` précisent **quel joueur** bloque (`subject: "self" | "partner"`),
pour guider l'UI (« votre coéquipier doit compléter son profil »).

### 4.2 Contrôle du mixte (`gender`)
- `MEN` → les 2 `MALE`
- `WOMEN` → les 2 `FEMALE`
- `MIXED` → exactement **1 `MALE` + 1 `FEMALE`**

### 4.3 Places & liste d'attente (transaction)
1. `SELECT … FOR UPDATE` sur la ligne `Tournament` (sérialise les inscriptions concurrentes,
   même pattern que le `FOR UPDATE` des réservations).
2. Compter les inscriptions `CONFIRMED`.
3. `maxTeams` nul **ou** `confirmées < maxTeams` → **`CONFIRMED`** ; sinon → **`WAITLISTED`**.

### 4.4 Modifier le coéquipier — `PATCH /tournaments/:id/registration` `{ partnerEmail }`
- Réservé au **capitaine**, **avant `registrationDeadline`**, tournoi non annulé (sinon `REGISTRATION_LOCKED`).
- Re-joue toute la validation 4.1/4.2 sur le nouveau partenaire.
- **Conserve le statut et la position liste d'attente** (`createdAt` inchangé) : changer de
  partenaire ne fait pas perdre sa place.

### 4.5 Se désinscrire — `DELETE /tournaments/:id/registration`
- Par le capitaine, **avant `registrationDeadline`** → `CANCELLED` + `cancelledAt`.
- **Promotion auto** (même transaction, verrou tournoi) : si un binôme `CONFIRMED` part et
  qu'il existe des `WAITLISTED`, le plus ancien (`createdAt`) passe `CONFIRMED`.

### 4.6 Côté club (admin — pas de contrainte de deadline)
- Créer / éditer / publier / annuler un tournoi.
- Voir inscrits + liste d'attente avec coordonnées (nom, tél, licence, sexe).
- Promouvoir / désinscrire manuellement un binôme.
- Annuler le tournoi (`CANCELLED`) **n'efface pas** les inscriptions (historique).

## 5. API

**Public** (`clubs.ts`, par `:slug`) :
- `GET /api/clubs/:slug/tournaments` → tournois `PUBLISHED` à venir + `confirmedCount`,
  `maxTeams`, `waitlistCount`.

**Joueur** (nouveau router `tournaments.ts` sous `/api/tournaments`, `authMiddleware`) :
- `GET /:id` → détail + (si connecté) mon inscription et son statut
- `POST /:id/register` · `{ partnerEmail }`
- `PATCH /:id/registration` · `{ partnerEmail }`
- `DELETE /:id/registration`

**Profil & mes tournois** (`me.ts`) :
- `PATCH /api/me` · `{ phone?, sex? }` → compléter le profil
- `GET /api/me/tournaments` → mes inscriptions tous clubs

**Admin** (`admin.ts` sous `/api/clubs/:clubId/admin`, déjà `requireClubMember('STAFF')`) :
- `GET /tournaments` (inclut DRAFT) · `POST /tournaments` · `GET /tournaments/:id` (inscrits + coordonnées)
- `PATCH /tournaments/:id` (éditer / publier / annuler via `status`) · `DELETE /tournaments/:id` (si DRAFT/sans inscrits)
- `PATCH /tournaments/:id/registrations/:regId` (promouvoir) · `DELETE /tournaments/:id/registrations/:regId` (désinscrire)

Codes d'erreur ajoutés aux tables `ERROR_STATUS` des routers concernés.

## 6. Frontend (joueur) + lien page d'accueil

- **`components/ClubHome.tsx`** : entrée du hub « Accès rapide »
  `{ label: 'Tournois', icon: 'trophy', href: '/tournois', show: true }`. **= lien demandé.**
  Ajouter une icône `trophy` à `components/ui/Icon.tsx`.
- **`app/tournois/page.tsx`** : liste des tournois du club (carte : nom, catégorie, genre,
  date, places `x/max`, « N en attente », état d'ouverture). Réutilise `Screen` + thème.
- **`app/tournois/[id]/page.tsx`** : détail + inscription :
  - recherche coéquipier par e-mail, rappel des pré-requis, bouton **S'inscrire** ;
  - profil incomplet (tél/sexe) → mini-formulaire inline (`PATCH /api/me`) avant inscription ;
  - déjà inscrit → carte « Votre binôme » + **Changer de coéquipier** / **Se désinscrire**
    (masqués après la deadline, mention « inscriptions closes »).
- **`lib/api.ts`** : types `Tournament`, `TournamentRegistration`, `MyTournament` + méthodes.

## 7. Admin (club)

- **`app/admin/tournaments/page.tsx`** : liste + création/édition (nom, **catégorie** via
  dropdown éditable, genre, dates, deadline, `maxTeams`, `entryFee`, statut) + panneau
  « Inscrits » (confirmés + liste d'attente, coordonnées, promouvoir/désinscrire).
- Entrée **« Tournois »** dans la nav de `app/admin/layout.tsx`.
- **Catégories par défaut du dropdown** : `P25, P50, P100, P250, P500, P1000, P1500, P2000`
  (champ texte libre → modifiable). P50 et P500 conservés.

## 8. Tests

- **`backend/src/services/__tests__/tournament.service.test.ts`** (Jest, façon
  `reservation.service.test.ts`) :
  - chaque échec de validation (membre / tél / licence / sexe / genre / deadline / doublon) ;
  - `CONFIRMED` vs `WAITLISTED` selon `maxTeams` ;
  - course concurrente pour la dernière place ;
  - changement de coéquipier qui **conserve la place** ;
  - désinscription qui **promeut** le 1er en attente.
- Quelques tests de routes (codes d'erreur) + 1 test front léger sur la carte tournoi.

## 9. Découpage de mise en œuvre (pressenti)

1. Schéma Prisma + migration additive + (re)génération client.
2. `TournamentService` + tests unitaires.
3. Routers : `tournaments.ts`, ajouts `clubs.ts` / `me.ts` / `admin.ts` + montage `app.ts`.
4. `lib/api.ts` (types + méthodes).
5. Pages joueur (`/tournois`, `/tournois/[id]`) + lien `ClubHome` + icône `trophy`.
6. Page admin `/admin/tournaments` + entrée de nav.
7. Tests de routes + front, vérification end-to-end.
