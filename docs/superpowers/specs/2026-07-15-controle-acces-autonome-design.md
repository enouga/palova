# Contrôle d'accès autonome des clubs (Akiles + code fixe) — Design

**Date** : 2026-07-15
**Statut** : validé (brainstorming avec Eric, approche A retenue)

## 1. Contexte & objectif

Les clubs « sans accueil » veulent que la porte s'ouvre toute seule pour les joueurs ayant réservé.
Le modèle du marché (GS Access, Neop, Playtomic/Akiles) : le logiciel de réservation est le cerveau,
un contrôleur de porte connecté est le muscle. Palova génère un **code d'accès lié à la réservation**,
valable uniquement sur le créneau, et le transmet aux joueurs.

V1 = deux modes derrière une même abstraction `AccessProvider` :

- **`AKILES`** — intégration native du contrôleur [Akiles](https://docs.akiles.app/dev/) (standard de
  fait des clubs padel autonomes, API REST publique self-service, OAuth 2.0). 1 réservation = 1
  `member` Akiles temporaire + 1 PIN.
- **`STATIC_CODE`** — « code du jour » : le club saisit le code de son digicode existant, Palova
  l'affiche aux joueurs d'une résa confirmée. Zéro matériel, zéro API — rend la feature utilisable
  par tous les clubs dès le jour 1 et force la plomberie commune (affichage, emails, admin).

Marques futures (Neop, Igloohome, webhook générique…) = un adaptateur de plus, hors v1.

## 2. Décisions de cadrage (réponses d'Eric)

| Question | Décision |
|---|---|
| Granularité des portes | **Les deux** : un member group Akiles par défaut pour le club + surcharges optionnelles par terrain |
| Qui voit le code | **Tous les participants** de la résa (+ organisateur). Un joueur qui rejoint une partie ouverte le voit aussi |
| Canal de diffusion | **App + email dédié + rappels** : écrans joueur, nouvel email « Votre code d'accès » (20ᵉ type personnalisable), code injecté dans les rappels J-1/H-2 existants |
| Périmètre résas | **Toutes les résas de type COURT `CONFIRMED`** — prises en ligne ou créées au planning admin. Cours/events/tournois hors v1 |
| Mode code fixe | **Oui, dans la v1** |
| Architecture d'exécution | **Approche A** : appel inline best-effort (pattern `safeNotify`) + rattrapage auto par le job minute existant (`cleanup.job`) |

## 3. Périmètre

### Inclus (v1)

- Migration additive `add_access_control` (2 modèles + 2 enums).
- `AccessService` + `AkilesProvider` + `StaticCodeProvider`, accrochés à la confirmation /
  annulation / déplacement de résa (joueur ET admin).
- Flux OAuth Akiles par club (miroir du pattern Stripe Connect existant), refresh token **chiffré**.
- Page admin `/admin/access` « Contrôle d'accès » (choix du mode, connexion Akiles, porte par défaut,
  surcharges par terrain, test de porte, échecs récents).
- Affichage joueur : écran de succès, Mes réservations, calendrier, cartes/fiche partie ouverte
  (viewer participant), modale du planning admin.
- Email « Votre code d'accès » + variable code dans les rappels J-1/H-2.
- Retry automatique des grants en échec via le cron minute.

### Hors v1 (suite naturelle, documentée ici pour mémoire)

- Autres fournisseurs : `NeopProvider` (contact commercial Neop requis), `WebhookProvider` générique,
  Igloohome/Spartime.
- Codes pour les cours, events, tournois (les inscrits d'un cours recevraient le code de la résa du cours).
- Un member Akiles **par joueur** (v1 = un code partagé par résa, pattern du guide PMS Akiles).
- Badges NFC, magic links, app-unlock (l'API les permet, on commence par le PIN).
- Fenêtre de validité configurable par club (v1 : constantes −15 min / +10 min).
- Pilotage de l'éclairage (argument Neop ; Akiles le permet via gadgets — non câblé).
- Révocation du code quand un joueur quitte/est retiré d'une partie (le code partagé reste valable
  jusqu'à la fin du créneau — limitation assumée, le code ne vit que sur le créneau).
- Alerte email/notif à l'admin sur échec répété (v1 : visible sur la page admin seulement).

## 4. Modèle de données — migration additive `add_access_control`

Appliquée en DEV via `prisma db execute` du SQL additif (dérive de base connue — jamais `db push` ni
`migrate dev`), en prod `migrate deploy`. Dossier horodaté `prisma/migrations/`.

```prisma
enum AccessProviderKind {
  AKILES
  STATIC_CODE
}

enum AccessGrantStatus {
  ACTIVE          // member + PIN créés chez Akiles
  FAILED          // création/màj en échec, en attente de retry
  REVOKED         // révoqué (annulation) — état terminal
  REVOKE_FAILED   // DELETE member en échec, en attente de retry
}

model ClubAccessConfig {
  id                 String             @id @default(cuid())
  clubId             String             @unique
  club               Club               @relation(fields: [clubId], references: [id], onDelete: Cascade)
  provider           AccessProviderKind
  staticCode         String?            // mode STATIC_CODE (≤ 20 caractères, texte libre)
  akilesRefreshToken String?            // CHIFFRÉ AES-256-GCM (jamais en clair)
  akilesOrgName      String?            // affichage admin « Connecté à … »
  akilesDefaultGroupId String?          // member group = porte par défaut du club
  resourceGroups     Json?              // surcharges { [resourceId]: memberGroupId }
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  @@map("club_access_configs")
}

model AccessGrant {
  id             String            @id @default(cuid())
  reservationId  String            @unique
  reservation    Reservation       @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  clubId         String
  status         AccessGrantStatus
  code           String?           // le PIN Akiles émis
  akilesMemberId String?
  attempts       Int               @default(0)
  lastError      String?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  @@index([status, updatedAt])
  @@map("access_grants")
}
```

Points structurants :

- **Table séparée `ClubAccessConfig`**, pas des colonnes sur `Club` : le refresh token est un secret ;
  les selects de `Club` sont nombreux et ne doivent jamais pouvoir l'embarquer par accident.
  Pas de ligne = fonctionnalité désactivée pour le club.
- **`AccessGrant` ne trace que le mode AKILES** (état externe à synchroniser). Le mode
  `STATIC_CODE` n'a ni grant, ni retry, ni révocation : le code affiché est **lu en live** dans la
  config (si le club change son digicode, l'app montre toujours le bon ; seuls les emails déjà
  partis portent l'ancien — limitation assumée).

## 5. Chiffrement des secrets — `backend/src/utils/secretBox.ts`

Premier secret tiers stocké en base. Nouveau module :

- AES-256-GCM, clé 32 octets lue dans l'env **`ACCESS_ENCRYPTION_KEY`** (base64).
- Format stocké : `v1:<iv>:<tag>:<ciphertext>` (base64) — versionné pour rotation future.
- API : `seal(plaintext): string` / `open(sealed): string`.
- **Pas de repli en clair** : clé absente → la connexion Akiles échoue avec un message explicite
  (`ACCESS_ENCRYPTION_KEY manquante`) ; le mode `STATIC_CODE` fonctionne sans la clé.
- `.env.prod.example` complété (`ACCESS_ENCRYPTION_KEY`, `AKILES_CLIENT_ID`, `AKILES_CLIENT_SECRET`)
  + variables transmises au conteneur dans `docker-compose.prod.yml`.

## 6. Architecture backend — `backend/src/services/access/`

### `AccessService` (orchestrateur, singleton)

- `onConfirmed(reservationId)` — appelé **best-effort** (pattern `safeNotify` : try/catch + log,
  jamais bloquant) après la confirmation. Garde interne : résa `CONFIRMED`, type COURT, à venir,
  club avec config. AKILES → crée member + association groupe + PIN, écrit le grant `ACTIVE`,
  **puis** déclenche l'email « Votre code d'accès ». STATIC_CODE → pas de grant, envoie l'email
  avec le code courant. Échec Akiles → grant `FAILED` (attempts++, lastError), pas d'email
  (il partira au retry réussi).
- `onCancelled(reservationId)` — AKILES : `DELETE /members/{id}` (révocation immédiate) → `REVOKED` ;
  échec → `REVOKE_FAILED` (retry). STATIC_CODE : rien.
- `onRescheduled(reservationId)` — AKILES : `PATCH` des dates du member ; si le terrain change et
  que son groupe (surcharge ou défaut) diffère → delete + create de la group association (pattern
  « changement de chambre » du guide PMS). Échec → `FAILED` + retry. Le retry est **idempotent** :
  il relit l'état de la résa et reconstruit (member existant → PATCH ; absent → créer).
- `retryFailed()` — appelé par le **`cleanup.job` minute existant** : grants `FAILED`/`REVOKE_FAILED`
  avec `attempts < 5`, backoff exponentiel simple (retente si `updatedAt` plus vieux que
  `2^attempts` minutes), résa encore à venir uniquement.
- `codeForReservation(reservation)` — pour l'affichage/emails : STATIC_CODE → `config.staticCode`
  (live) ; AKILES → `grant.code` si `ACTIVE`, sinon `null`.
- Fenêtre de validité : constantes `ACCESS_WINDOW_BEFORE_MIN = 15`, `ACCESS_WINDOW_AFTER_MIN = 10`
  (starts_at = début − 15 min, ends_at = fin + 10 min, en UTC — Akiles est UTC natif, Palova aussi).

### `AkilesProvider`

- Base `https://api.akiles.app/v2`, `Authorization: Bearer <access_token>`.
- Gestion de token : access token (validité 1 h) obtenu via le refresh token déchiffré, **caché en
  mémoire par club** avec marge d'expiration ; refresh raté → erreur explicite remontée au grant.
- Appels : `POST /members` (name = `Palova · {terrain} · {date}`, `starts_at`/`ends_at` UTC,
  `metadata: { reservationId }`), `POST /members/{id}/group_associations`,
  `POST /members/{id}/pins` (PIN généré par Akiles, renvoyé dans la réponse),
  `PATCH /members/{id}`, `DELETE /members/{id}`, `GET /member_groups` (picker admin),
  flux OAuth (échange code → tokens, refresh).
- Résolution du groupe : `resourceGroups[resourceId]` sinon `akilesDefaultGroupId`.

### `StaticCodeProvider`

Trivial — pas d'état externe. Existe pour l'uniformité de l'interface et les tests.

### Points d'accroche dans le code existant (tous best-effort)

| Événement | Site | Action |
|---|---|---|
| Confirmation (client, Stripe client-confirm, webhook Stripe) | `ReservationService.confirmReservation` (point de convergence) | `onConfirmed` |
| Création CONFIRMED au planning admin | route/service de création admin du planning | `onConfirmed` |
| Annulation (joueur, admin, RGPD `cancelFutureReservationsForUser` via `performCancel`) | `performCancel` | `onCancelled` |
| Déplacement joueur (`?move=`) | `rescheduleReservation` | `onRescheduled` |
| Déplacement admin (drag & drop planning) | `adminRescheduleReservation` | `onRescheduled` |

L'ordre à la confirmation : grant **avant** les notifications pour que l'email d'accès parte avec
le code (les autres notifs existantes ne changent pas d'ordre).

## 7. OAuth Akiles (miroir du pattern Stripe Connect)

App OAuth unique déclarée par Palova dans le [Developer Center Akiles](https://docs.akiles.app/dev/)
(`AKILES_CLIENT_ID` / `AKILES_CLIENT_SECRET`). Chaque club connecte SON organisation Akiles :

1. `POST /api/clubs/:clubId/admin/access/akiles/connect` (**OWNER**, comme `/stripe/connect`) →
   renvoie l'URL d'autorisation Akiles (scopes `full_read_write offline`,
   `redirect_uri = {API_URL}/api/access/akiles/callback`, `state` = JWT court signé `{ clubId }`
   — anti-CSRF).
2. Le gérant autorise Palova sur son organisation chez Akiles.
3. `GET /api/access/akiles/callback` (route **publique**, nouveau routeur `access.ts`) : valide le
   `state`, échange le code contre access + refresh tokens, **chiffre et stocke** le refresh token +
   le nom d'organisation, redirige vers `clubUrl(slug, '/admin/access?connected=1')`.
4. `DELETE …/admin/access/akiles` (**OWNER**) : efface token + groupes (la config repasse
   déconnectée) ; les grants existants restent en base (les members Akiles expirent seuls).

Routes de configuration (**ADMIN**, `requireClubMember('ADMIN')`) :

- `GET …/admin/access` — config courante (sans le token !), statut connexion, liste des
  `member_groups` de l'organisation (proxy live vers Akiles pour les pickers), 20 derniers grants
  en échec.
- `PATCH …/admin/access` — `provider`, `staticCode` (trim, ≤ 20 car.), `akilesDefaultGroupId`,
  `resourceGroups` (ids de ressources du club validés), ou `provider: null` = désactivation.
- `POST …/admin/access/test` — crée un member « Test Palova » de 5 min + PIN et renvoie le code
  (l'admin le tape sur le clavier ; le member expire tout seul).
- `POST …/admin/access/grants/:id/retry` — retry manuel d'un grant en échec.

## 8. Exposition du code aux joueurs (API)

Champ additif `accessCode: string | null` **uniquement dans les payloads scopés au viewer** :

- `listUserReservations` (`MyReservation`) → Mes réservations, calendrier, **BookingSuccess**
  (qui lit `getMyReservations`).
- DTO `OpenMatch` (`toDTO`) → **seulement si `viewerIsParticipant || viewerIsOrganizer`**, sinon
  `null` — couvre `/parties` et `/parties/[id]` pour les joueurs qui ont rejoint.
- `listClubReservations` (admin) → modale de résa du planning + Paiements.

Jamais de code dans les DTO publics/anonymes ni dans la carte OG de partage. Le code n'apparaît
dans aucun log.

## 9. Emails & notifications

- **Nouveau type `access.code` « Votre code d'accès »** — 20ᵉ entrée d'`EMAIL_DEFS`
  (personnalisable dans `/admin/emails` comme les autres). Variables : code, terrain, date/heure,
  fenêtre de validité, nom du club. Destinataires : organisateur + participants inscrits au moment
  du grant (dédupliqués). Envoi **après** grant réussi (AKILES) ou à la confirmation (STATIC_CODE).
  Catégorie de préférence : `MY_GAMES` (in-app + email ; pas de nouvelle catégorie).
- **Rappels J-1/H-2 enrichis** : `notifyReservationReminder` ajoute le code au corps quand
  `codeForReservation` en renvoie un — rendu **au moment de l'envoi** (code statique live, grants
  rattrapés entre-temps, retardataires d'une partie ouverte couverts : les rappels partent déjà à
  tous les participants).
- Un joueur qui **rejoint** une partie ouverte après la confirmation ne reçoit pas d'email d'accès
  dédié en v1 : il voit le code dans l'app (carte/fiche partie) et le recevra dans le rappel.

## 10. UI admin — page `/admin/access` « Contrôle d'accès »

Entrée sidebar « Contrôle d'accès » (section Configuration, près de Réglages ; icône `lock` à
ajouter à `Icon.tsx` si absente). Page :

1. **Choix du mode** : Aucun / Code fixe / Akiles (cartes radio, pattern des réglages existants).
2. **Mode code fixe** : champ code + enregistrement (PATCH), rappel « affiché aux joueurs d'une
   réservation confirmée ».
3. **Mode Akiles** :
   - non connecté → bouton « Connecter mon compte Akiles » (**visible OWNER uniquement**, pattern
     gating `isClubOwner` de la page Paiement en ligne) + lien « Pas encore équipé ? » vers akiles.app ;
   - connecté → « Connecté à {org} », select **porte par défaut** (member groups live), tableau
     optionnel **surcharges par terrain** (une ligne par ressource du club, select groupe ou
     « — porte par défaut »), bouton **« Tester la porte »** (affiche le PIN de test 5 min),
     bouton Déconnecter (OWNER, ConfirmDialog).
4. **Échecs récents** : liste des grants `FAILED`/`REVOKE_FAILED` (résa, date, erreur, bouton
   Réessayer). Vide → rien d'affiché.

## 11. UI joueur

- **`BookingSuccess`** : bloc « Code d'accès » en vedette (code en gros display) quand
  `accessCode` présent ; si le club a une config active mais le code n'est pas encore là
  (grant FAILED en cours de retry) → « Votre code d'accès arrive — vous le recevrez par email. »
- **Mes réservations** (`/me/reservations` + `DayPanel` calendrier) : ligne discrète
  « 🔑 Code d'accès : {code} » sur les résas à venir.
- **Parties ouvertes** (carte + fiche `/parties/[id]`) : même ligne, seulement pour le viewer
  participant/organisateur.
- Helper pur front `lib/access.ts` : libellés (`accessCodeLine`), types.

## 12. Erreurs & sécurité

- **Best-effort partout** : aucune panne Akiles ne bloque une résa, une annulation ou un déplacement.
- Retry auto ≤ 5 tentatives (backoff 2^n min) via le cron minute ; au-delà, visible page admin +
  retry manuel.
- Refresh token chiffré (AES-256-GCM), jamais renvoyé par l'API, jamais loggé.
- `state` OAuth signé court (anti-CSRF) ; callback en échec → redirection admin avec `?error=`.
- Un member Akiles orphelin (résa annulée pendant une panne, retry épuisé) expire de lui-même à
  `ends_at` — l'exposition maximale est bornée au créneau.
- Codes jamais dans les logs ni les DTO publics.

## 13. Tests

- **Backend** : `secretBox` (seal/open, clé absente), `akilesProvider` (fetch mocké : token refresh,
  create/patch/delete member, mapping groupes), `access.service` (grant/cancel/reschedule/retry/
  static/gardes type-statut-futur), routes `admin.access.routes` (gating OWNER vs ADMIN vs STAFF,
  PATCH validation, callback OAuth state invalide), câblage `reservation.service` (onConfirmed
  appelé à la confirmation, échec non bloquant), `registry` (20ᵉ type).
- **Frontend** : `AdminAccess` (modes, connexion, surcharges, test, échecs), `BookingSuccess`
  (code affiché / message d'attente), Mes réservations + `DayPanel` (ligne code), `OpenMatchCard`
  (code viewer-gated), `access` (helpers purs), `AdminLayout` (entrée nav).
- Vérification visuelle CDP clair + sombre, desktop 1280 + mobile 390.

## 14. Déploiement

- Variables : `ACCESS_ENCRYPTION_KEY` (générer 32 octets base64), `AKILES_CLIENT_ID`,
  `AKILES_CLIENT_SECRET` — `.env.prod.example` + `docker-compose.prod.yml`.
- Redirect URI du callback à déclarer dans le Developer Center Akiles (prod : `https://api.palova.fr/api/access/akiles/callback` ; dev : `http://localhost:3001/api/access/akiles/callback`).
- Développement/tests sans matériel via les **organisations de test** du Developer Center Akiles.
- Migration : `prisma db execute` en dev, `migrate deploy` en prod.
