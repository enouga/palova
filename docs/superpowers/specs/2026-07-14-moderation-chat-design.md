# Modération & anti-abus des chats — Design

**Date** : 2026-07-14
**Périmètre** : 4 volets — rate-limiting Redis, signalement de messages (DSA/LCEN), fermeture du trou membre BLOCKED → DM, ré-encodage sharp des images DM.

## Contexte et motivation

Audit des deux systèmes de chat (chat de partie ouverte + messagerie privée 1-à-1) : la base
technique est saine (XSS, contrôle d'accès, pierres tombales, blocage de paire), mais quatre
trous exposent la plateforme :

1. **Aucun mécanisme de signalement** — le DSA (règlement UE 2022/2065, art. 16) impose à tout
   hébergeur, même micro-entreprise, un mécanisme de notification de contenu illicite et un
   point de contact. La LCEN va dans le même sens. C'est le principal risque légal.
2. **Aucun rate-limiting** — le chat de partie envoie 1 email par message à chaque destinataire
   absent : une boucle (malveillante ou boguée) détruit la réputation SMTP de la boîte OVH et
   fait partir les emails transactionnels (codes d'inscription) en spam.
3. **Un membre `BLOCKED` du club garde son accès DM** — `postMessage` ne vérifie que le blocage
   de paire, jamais le statut d'adhésion. Un joueur banni du club pour harcèlement continue
   d'écrire aux membres.
4. **Images DM non vérifiées** — mimetype déclaré par le client (pas de magic bytes), EXIF/GPS
   conservés (une photo peut embarquer les coordonnées du domicile de l'expéditeur).

## Décisions de cadrage (validées avec Eric)

- **Routage des signalements** : chat de partie → staff du club (OWNER/ADMIN, modérateurs
  naturels — ils peuvent déjà supprimer) ; **DM → superadmin plateforme uniquement** (le staff
  d'un club ne lit jamais les messages privés de ses membres).
- **BLOCKED→DM** : re-vérification de la co-adhésion ACTIVE à chaque envoi (pas de ban
  plateforme dans cette passe). S'ils partagent un autre club actif, ils peuvent encore
  s'écrire (assumé).
- **Pouvoirs du superadmin sur un DM signalé** : voir le message signalé (+ sa photo le cas
  échéant), le supprimer (pierre tombale), clore avec décision. Le signalement embarque **le
  message signalé seul**, jamais le fil (confidentialité ; si insuffisant, le superadmin
  contacte le signaleur).
- **Architecture signalement** : approche « modèle `MessageReport` + files de modération
  dédiées » retenue (vs email simple ou notifications in-app) — seule option avec trace
  d'audit, dédup et clôture propre.

## 1. Modèle de données (migration additive `add_message_reports`)

```prisma
enum ReportReason { HARASSMENT ILLEGAL SPAM OTHER }
enum ReportStatus { OPEN RESOLVED }
enum ReportResolution { DELETED REJECTED }

model MessageReport {
  id                 String            @id @default(cuid())
  openMatchMessageId String?           // exactement UNE des deux FK est renseignée (pattern Payment)
  directMessageId    String?
  reporterId         String
  clubId             String?           // routage : club de la résa (match) ; conversation.clubId informatif (DM)
  reason             ReportReason
  detail             String?           // texte libre <= 500
  status             ReportStatus      @default(OPEN)
  resolution         ReportResolution?
  resolvedById       String?
  resolvedAt         DateTime?
  createdAt          DateTime          @default(now())

  @@unique([openMatchMessageId, reporterId])
  @@unique([directMessageId, reporterId])
  @@index([clubId, status])
  @@index([status])
}
```

- FK : messages `onDelete: Cascade` (jamais hard-deleted en pratique — pierres tombales),
  `reporterId`/`resolvedById` → User (`Cascade`/`SetNull`).
- Les deux `@@unique` partiels assurent la dédup par signaleur (Postgres autorise les nulls
  multiples : chaque unique ne contraint que son kind).
- « Exactement une FK » est garanti par le service (pas de contrainte CHECK — cohérent avec
  le pattern `Payment` existant).
- ⚠️ Migration appliquée en DEV via `prisma db execute` du SQL additif (jamais `db push` —
  dérive de base connue) + `prisma generate` ; en prod `prisma migrate deploy`.

## 2. Backend signalement — `ModerationService`

Nouveau `backend/src/services/moderation.service.ts` :

- **`reportOpenMatchMessage(slug, reservationId, messageId, reporterId, { reason, detail })`** :
  garde d'accès = même `assertChatAccess` que la lecture du chat (il faut pouvoir voir le
  message pour le signaler) ; message vivant appartenant à cette résa (`MESSAGE_NOT_FOUND`) ;
  **son propre message est refusé** (`VALIDATION_ERROR`) ; doublon → P2002 avalé (idempotent,
  renvoie l'existant). `clubId` = club de la résa. Notifie le staff OWNER/ADMIN du club par
  **email best-effort** (builders purs, infra `sendMail` existante ; pas de nouvelle catégorie
  de préférence — volume très faible, toujours envoyé).
- **`reportDirectMessage(conversationId, messageId, reporterId, { reason, detail })`** : garde
  participant (même logique que `MessagingService.assertParticipant`), mêmes règles (vivant,
  pas soi-même, dédup). `clubId` = `conversation.clubId`. Notifie **par email les
  `User.isSuperAdmin`** (best-effort).
- **`listClubReports(clubId, { status? })`** : signalements des messages de chat de partie du
  club (jamais de DM), enrichis : corps + auteur du message, partie (terrain/date), signaleur,
  motif/détail, statut/décision. OPEN d'abord, puis RESOLVED récents.
- **`resolveClubReport(clubId, reportId, moderatorUserId, action: 'DELETE' | 'REJECT')`** :
  vérifie que le report appartient au club et est OPEN (`REPORT_NOT_FOUND`) ; `DELETE` =
  pierre tombale du message (mêmes effets que la suppression staff existante : `deletedAt` +
  `deletedById` = modérateur, unlink photo le cas échéant, broadcast SSE `chat_deleted`) ;
  `REJECT` = clôture sans toucher au message. Dans les deux cas, **tous les signalements OPEN
  du même message sont clos avec la même décision** (updateMany). Report déjà RESOLVED →
  renvoyé tel quel (idempotent, pas de re-broadcast) ; message déjà supprimé par son auteur →
  la clôture s'applique quand même (la suppression est idempotente, pattern existant).
- **`listPlatformReports({ status? })`** / **`resolvePlatformReport(reportId, superAdminUserId,
  action)`** : miroir DM pour le superadmin ; `DELETE` = tombstone du `DirectMessage` + unlink
  du fichier photo + broadcast `dm_deleted`.
- **`platformReportImagePath(reportId)`** : chemin absolu + mime de la photo d'un DM signalé
  (réutilise la regex anti-traversée de `messaging.service.ts`) — le superadmin doit pouvoir
  juger un signalement d'image.

### Routes

| Route | Garde | Notes |
|---|---|---|
| `POST /api/clubs/:slug/open-matches/:id/chat/messages/:messageId/report` | auth | body `{ reason, detail? }` |
| `POST /api/conversations/:id/messages/:messageId/report` | auth | idem |
| `GET /api/clubs/:clubId/admin/moderation/reports?status=` | `requireClubMember('ADMIN')` | aligné sur le droit de suppression staff existant |
| `POST /api/clubs/:clubId/admin/moderation/reports/:reportId/resolve` | `requireClubMember('ADMIN')` | body `{ action: 'DELETE' \| 'REJECT' }` |
| `GET /api/platform/moderation/reports?status=` | `requireSuperAdmin` | DM seulement |
| `POST /api/platform/moderation/reports/:reportId/resolve` | `requireSuperAdmin` | |
| `GET /api/platform/moderation/reports/:id/image` | `requireSuperAdmin` | streame la photo du DM signalé |

Codes : `VALIDATION_ERROR` 400, `MESSAGE_NOT_FOUND`/`REPORT_NOT_FOUND` 404, `RATE_LIMITED` 429.

### Point de contact DSA

Entrée FAQ plateforme « Signaler un contenu » (`lib/platformContent.ts`, rubrique existante) :
explique le bouton Signaler + donne l'adresse de contact. Pas de page légale complète dans
cette passe.

## 3. Rate-limiting — `backend/src/services/rateLimit.ts`

Helper unique :

```ts
export async function assertRateLimit(bucket: string, userId: string, max: number, windowSec: number): Promise<void>
```

- Clé `rl:{bucket}:{userId}:{floor(now/windowSec)}` — `INCR`, si résultat `=== 1` → `EXPIRE
  windowSec` ; si `> max` → `throw RATE_LIMITED` (mappé **429** dans les routes).
- **Fail-open** : toute erreur Redis (down, timeout — `enableOfflineQueue:false` fait échouer
  immédiatement) → log + on laisse passer. Le chat ne meurt jamais avec Redis.
- Fenêtre fixe (pas de sliding window) : simple, suffisant à ce volume ; le pire cas
  (2× la limite à cheval sur deux fenêtres) est acceptable.

| Bucket | Limite | Appliqué dans |
|---|---|---|
| `match:post` | 12 / min | `OpenMatchChatService.postMessage` |
| `dm:post` | 12 / min | `MessagingService.postMessage` + `createImageMessage` (bucket commun) |
| `dm:image` | 20 / h | `createImageMessage` (en plus de `dm:post`) |
| `dm:newconv` | 15 / h | `getOrCreateConversation` — compté **seulement à la création réelle** (pas au get) |
| `report` | 10 / h | les deux routes de signalement |

Front : mapping `RATE_LIMITED` → « Vous envoyez trop de messages, patientez un instant. »
dans les deux composers (`MessageComposer`, `OpenMatchChatSheet`).

## 4. Fermeture BLOCKED→DM

Helper privé **`assertCanWrite(meId, otherId)`** dans `MessagingService` = `assertNotBlocked`
existant **+ co-adhésion re-vérifiée** (réutilise `sharedActiveClubId` : ≥ 1 club ACTIF où les
deux adhésions sont ACTIVES ; échec → `NOT_CO_MEMBERS`, mappé 403).

- Appliqué à **`postMessage`, `createImageMessage`, `addReaction`**.
- Volontairement PAS sur `typing` (fréquent, sans enjeu), ni `markRead`/`removeReaction`
  (nettoyage de son propre état), ni la lecture (le fil reste lisible, comme pour le blocage
  de paire).
- Effet : le BLOCK d'un club devient une vraie sanction qui coupe aussi les DM quand c'était
  le seul club commun ; le superadmin peut s'appuyer dessus en traitant un signalement.
- Coût : ~2 requêtes par envoi — négligeable au volume d'un chat. Pas de cache (YAGNI).
- Front : bandeau inline « Vous ne pouvez plus écrire à ce joueur. » dans `MessageThread`
  (pattern du bandeau blocage existant).

## 5. Images DM ré-encodées (sharp)

Dans `MessagingService.createImageMessage`, avant écriture disque :

- **Format réel détecté par sharp** (`metadata().format`) — seuls `jpeg`/`png`/`webp` acceptés ;
  le mimetype déclaré par le client n'est plus la source de vérité ; l'extension du fichier
  stocké vient du format réel.
- `.rotate()` applique l'orientation EXIF, **puis** le ré-encodage supprime toutes les
  métadonnées (EXIF/GPS/ICC — comportement par défaut de sharp, pas de `withMetadata()`).
- Dimensions plafonnées **2048×2048** (`fit:'inside'`, `withoutEnlargement:true`).
- Ré-encodage dans le même format (jpeg q≈82, webp q≈82, png par défaut).
- Fichier corrompu / non-image → `VALIDATION_ERROR` (sharp throw attrapé).

Les autres uploads (avatars, affiches d'annonces, photos club, images d'offres/emails) ont le
même défaut mais sont **hors périmètre** de cette passe.

## 6. Frontend

- **`components/moderation/ReportDialog.tsx`** partagé : motifs en radio (Harcèlement /
  Contenu illicite / Spam / Autre) + texte libre optionnel + « Envoyer le signalement »,
  toast « Signalement envoyé » (re-signaler = même toast, idempotent côté serveur).
- Action « Signaler » sur les messages **des autres** (jamais les siens) dans
  `OpenMatchChatSheet` et `MessageThread`, à côté de la suppression existante.
- Page **`/admin/moderation`** (entrée nav « Signalements », section Au quotidien) : cartes
  signalement — extrait du message, auteur du message, signaleur, motif/détail, partie liée
  (terrain + date), date du signalement — actions **Supprimer le message / Rejeter**
  (ConfirmDialog), historique RESOLVED replié.
- Page **`/superadmin/moderation`** (entrée nav « Modération ») : miroir DM ; la photo d'un
  message image est affichée via la route dédiée.
- `lib/api.ts` : types `ReportReason`/`MessageReportRow`… + méthodes `reportOpenMatchMessage`,
  `reportDmMessage`, `adminListReports`, `adminResolveReport`, `platformListReports`,
  `platformResolveReport` (+ URL image).
- Mapping erreurs dans les composers : `RATE_LIMITED` (429) et `NOT_CO_MEMBERS` (403).

## 7. Tests

**Backend** :
- `moderation.service.test.ts` : dédup (2ᵉ signalement idempotent), auto-signalement refusé,
  gardes d'accès (non-membre 403/404), resolve DELETE = tombstone + clôture des signalements
  frères, REJECT ne touche pas le message, image path anti-traversée.
- `rateLimit.test.ts` : sous la limite OK, au-delà throw, fenêtre expirée réinitialise,
  **fail-open sur erreur Redis** (mock `__mocks__/redis.ts` existant).
- `messaging.service.test.ts` (ajouts) : membre BLOCKED du seul club commun → `NOT_CO_MEMBERS`
  sur post/image/réaction ; autre club commun ACTIF → passe encore ; lecture toujours ouverte.
- ré-encodage : format menteur (png déclaré jpeg) détecté et stocké `.png`, EXIF supprimés
  (buffer construit avec `sharp().withMetadata()`), garbage refusé, image surdimensionnée
  réduite.
- Routes : `admin.moderation.routes` (STAFF sans rôle ADMIN → 403), `platform.moderation.routes`
  (non-superadmin 403), routes report (auth requise, 429).

**Frontend** : `ReportDialog`, ajouts `MessageThread` (action Signaler, bandeau
`NOT_CO_MEMBERS`, message `RATE_LIMITED`), `OpenMatchChatSheet` (action Signaler),
`AdminModeration`, `SuperAdminModeration`.

## Hors périmètre (v1)

- Ban plateforme (`User.suspendedAt`) — le BLOCK club + la co-adhésion re-vérifiée couvrent le
  besoin actuel ; à revoir si un cas cross-club apparaît.
- Signalement de profils, photos, annonces (messages seulement).
- Ré-encodage des autres uploads (avatars, affiches, photos club).
- Rate-limit générique de l'API (login, réservations…).
- Contexte de fil pour le superadmin (message signalé seul en v1).
- Pages légales complètes / CGU (seule l'entrée FAQ point de contact est incluse).
- Notification in-app au signaleur du sort de son signalement (DSA art. 16 recommande un
  retour ; l'email de contact suffit à ce stade — à ajouter si le volume le justifie).
