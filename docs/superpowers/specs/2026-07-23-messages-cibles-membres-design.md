# Messages ciblés aux membres — sélection, type, consentement (design)

**Date** : 2026-07-23 · **Statut** : validé par Eric (brainstorming, flux maquetté dans le companion visuel)

## Contexte

La diffusion « Messages » (`/admin/broadcast`, `BroadcastService`) envoie un email riche + notification app à **tous** les membres actifs, sans ciblage. Eric veut envoyer des messages à des **membres sélectionnés** depuis la partie membre : infos pratiques, relances individuelles (impayé, abo qui expire), et promotions — donc les trois usages, ce qui impose un consentement marketing.

## Décisions de cadrage (validées)

- **v1 sans SMS** : email + notification app (infra existante, coût zéro). L'architecture prévoit le canal SMS (interrupteur grisé « bientôt disponible ») pour le brancher en v2 une fois le modèle économique choisi (crédits prépayés, compte club ou quota SaaS — non tranché).
- **Pas de nouvelle surface d'envoi** : on généralise la page « Messages » existante (éditeur riche, canaux, historique, désinscription déjà en place) en y ajoutant le ciblage, le type de message et les variables.
- **Trois portes d'entrée, un seul composer** : (1) sélection sur la liste des membres, (2) page Messages en direct (défaut = tous les actifs, comportement actuel), (3) bouton « Envoyer un message » de la fiche membre 360° (1 destinataire).
- **Deux types d'envoi** : **Info club** (vie du club — tous les destinataires choisis) et **Commercial** (promotions — exclut automatiquement les membres ayant refusé les offres, compteur visible avant envoi).
- **Consentement** : préférence « Offres du club », **activée par défaut** (exception client-existant admise pour l'email B2C), désinscription 1 clic. Le SMS marketing, lui, exigera un opt-in strict — traité en v2 avec le canal.
- ⚠️ **`EMAIL_BROADCAST_ENABLED` hérité tel quel** : le canal email des envois ciblés reste derrière le même interrupteur global (aujourd'hui `false` en attendant un provider adapté aux volumes).

## Données (migrations additives)

- **`NotificationCategory` + `CLUB_OFFERS`** : nouvelle catégorie de préférence (pattern existant, par catégorie × canal, défaut ON). Libellé front « Offres du club » dans `lib/notifications.ts` → apparaît dans les préférences du profil joueur.
- **`ClubBroadcast.kind`** : `String @default("INFO")` (`INFO` | `COMMERCIAL`).
- **Nouvelle table `ClubBroadcastRecipient`** : `broadcastId` (FK cascade), `userId` (FK cascade), `@@unique([broadcastId, userId])`, index `userId`. Persistée pour **tous** les envois (y compris « tous les membres ») — c'est ce qui permet l'historique par membre. Volumétrie acceptée (800 lignes pour un club de 800 membres).

DEV : `prisma db execute` du SQL additif ; prod : `migrate deploy`.

## Backend

### 1. `BroadcastService.send` étendu (route POST existante, body additif)

- **`recipientUserIds?: string[] | null`** : null/absent = tous les membres actifs (comportement actuel, inchangé). Fourni : **intersecté avec les adhésions ACTIVES du club** (on n'envoie jamais hors club ni à un bloqué) ; liste vide après intersection → `VALIDATION_ERROR`.
- **`kind?: 'INFO' | 'COMMERCIAL'`** (défaut INFO). `COMMERCIAL` route les notifications par la catégorie **`CLUB_OFFERS`** (au lieu de `CLUB_MESSAGES`) : les préférences par canal du membre s'appliquent naturellement — un refus des offres coupe l'email et/ou la cloche selon ses réglages. `INFO` garde le comportement actuel.
- **Variables** : substitution par destinataire de `{{prenom}}` (et `{{nom}}`) dans l'objet et le corps — l'envoi est déjà individualisé (lien de désinscription par destinataire), la substitution s'insère au même endroit. Placeholder inconnu retiré (pattern du registre d'emails).
- **Désinscription** : le lien d'un envoi `COMMERCIAL` porte la catégorie (`&cat=offers`) → la route `/api/unsubscribe` coupe `CLUB_OFFERS` (email) au lieu du comportement actuel ; un envoi `INFO` garde le lien actuel. Page de confirmation avec re-souscription, inchangée.
- **Persistance** : `kind` sur la ligne d'audit + une ligne `ClubBroadcastRecipient` par destinataire réellement visé (après intersection, avant filtrage par préférences — on trace « à qui le club a adressé le message »).

### 2. Aperçu d'audience — `POST /broadcast/audience` (nouvelle route, gate STAFF)

Body `{ recipientUserIds?, kind }` → `{ total, email, inApp, excluded }` : combien recevront l'email, la cloche, et combien ne recevront **rien** (toutes préférences de la catégorie coupées). Sert le bandeau « 2 des 12 membres ont refusé les offres — 10 recevront le message » du composer, débouncé.

### 3. Messages reçus par un membre — `GET /members/:userId/broadcasts` (nouvelle route admin, gate STAFF)

Les ~10 derniers envois adressés à ce membre (via `ClubBroadcastRecipient`) : date, titre, kind, canaux. Affiché sur la fiche 360° (sous la carte Contact).

## Frontend

### 4. Liste `/admin/members` : mode sélection

- Case à cocher par ligne (`MemberRow`, prop additive) + « Tout sélectionner (N) » = les lignes **visibles du filtre courant** (les filtres existants — segments, recherche, expirent bientôt, plan — deviennent le moteur de ciblage).
- Barre flottante sticky en bas : « N sélectionnés · ✉ Envoyer un message · ✕ » → navigue vers `/admin/broadcast`, ids transmis via **sessionStorage** (`palova:broadcast-recipients`) — jamais l'URL (200 ids ne tiennent pas).

### 5. Composer `/admin/broadcast` enrichi

- **Chips destinataires** : « N destinataires ▾ » dépliable, chips retirables une à une ; sans sélection → « Tous les membres actifs (N) » (défaut actuel).
- **Type** : Segmented **Info club / Commercial** ; en Commercial, bandeau d'audience (route aperçu) avec le compteur d'exclus.
- **Variables** : `RichEmailEditor` reçoit `vars=[{prenom},{nom}]` → jetons insécables « Prénom »/« Nom » via le bouton « ＠ Insérer une info » existant (gate `vars.length > 0` déjà en place).
- **Canaux** : Email / Cloche / Push inchangés + interrupteur **SMS désactivé** « bientôt disponible ».
- **Historique** : chaque envoi affiche sa cible (« 12 dest. » / « Tous ») et son type.

### 6. Fiche membre 360° : bouton « ✉ Envoyer un message »

Carte Contact → composer avec ce seul destinataire (même mécanique sessionStorage). En dessous, mini-liste des 3 derniers messages reçus (route §3).

### 7. Préférence joueur

« Offres du club » apparaît dans les préférences de notifications de `/me/profile` (catégorie `CLUB_OFFERS`, canaux email/cloche/push, ON par défaut).

## Prêt pour le SMS (v2, non implémenté)

`normalizeBroadcastChannels` tolère un slot `sms` (forcé `false` tant que non supporté) ; `User.phone` existe ; le choix provider/facturation (Brevo SMS, crédits prépayés, quota) est **explicitement non tranché**. Rien d'autre n'est codé.

## Tests

- Backend : `broadcast.service` (ciblage intersecté ACTIVE, liste vide rejetée, kind COMMERCIAL → catégorie CLUB_OFFERS + exclusions, variables substituées par destinataire, recipients persistés), `admin.broadcast.routes` (body additif, route audience, route broadcasts par membre), `unsubscribe.routes` (`&cat=offers`), `preferences` (CLUB_OFFERS défaut ON).
- Frontend : `broadcast` (helpers), `AdminBroadcast` (chips, type, bandeau d'audience, SMS grisé), `AdminMembersFilters` (sélection, tout-sélectionner sur filtre, barre flottante), `MemberHistory` (bouton message + derniers reçus), `MeProfile` (préférence Offres).

## Hors périmètre

Envoi SMS réel et son modèle économique · segments sauvegardés (« mes abonnés padel ») · statistiques d'ouverture/clic · modèles de messages réutilisables · planification d'envoi différé · opt-in SMS.
