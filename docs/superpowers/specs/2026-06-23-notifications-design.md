# Système de notifications (in-app + push web + email) — Design

> Spec validée le 2026-06-23. Statut : à implémenter.

## 1. Objectif

Doter Palova d'un **système de notifications unifié** couvrant trois canaux —
**cloche in-app**, **push web** et **email** — avec :

- des **notifications automatiques** sur la vie des parties, réservations, inscriptions
  (tournois / events / cours), matchs et paiements, à chaque changement de statut et
  ajout/retrait de joueur ;
- un **broadcast admin → tous les membres** du club ;
- des **préférences par membre** : pour chaque famille de notifications, le choix des
  canaux reçus ;
- des **rappels** avant une partie / un event (J-1 et H-2).

Cible : fonctionne **partout** (Android, iPhone, desktop) via la cloche in-app ; le push
web s'ajoute par-dessus (natif Android/desktop, iPhone **si PWA installée**, iOS 16.4+).

## 2. Décisions cadrées (brainstorming)

| Sujet | Choix |
|---|---|
| Canaux V1 | **In-app + push web ensemble** (expérience complète) |
| Préférences | **Grille catégorie × canal**, **opt-out** (tout activé par défaut) |
| Cible broadcast | **Tous les membres actifs** (non BLOCKED) du club |
| Mute broadcast | **Cloche toujours ON** (verrouillée) ; **push/email coupables** |
| Emails existants | **Unifiés** : ils passent par le dispatcher (apparaissent dans la cloche, peuvent pousser, pilotés par les préférences, **sans double envoi**) |
| Rappels | **Inclus en V1** (job node-cron) |

## 3. Architecture — dispatcher unique, 3 canaux

Un **seul point d'entrée** `NotificationService.notify(event)` que tout évènement
notifiable appelle, **après commit**, en **best-effort** (un échec ne casse jamais
l'action déclenchante — pattern des emails actuels).

Pour chaque destinataire, le dispatcher :

1. crée une ligne **`Notification` en base = la cloche in-app** (source de vérité,
   marche partout, sans condition) ;
2. la pousse en **live via SSE** si le membre a l'app ouverte ;
3. **fan-out selon les préférences** du destinataire : **push web** (si abonnement +
   canal activé) et **email** (si canal activé, en réutilisant les templates existants).

**Unification des emails.** `src/email/notifications.ts` n'appelle plus `sendMail` en
direct : ses fonctions deviennent des appels au dispatcher (le canal email du dispatcher
réutilise les **builders/templates conservés tels quels** : `src/email/templates/emails.ts`,
`src/email/links.ts`). Bénéfice : chaque évènement déjà géré apparaît aussi dans la cloche
et peut pousser, sans double envoi.

**Réutilisé** : infra email (templates), `SSEService` (généralisé en canal par-utilisateur),
install PWA existante (`lib/install.ts`, `lib/useInstallPrompt.ts` — prérequis du push iOS).

## 4. Modèle de données (migration **additive** `add_notifications`)

```prisma
enum NotificationCategory {
  MY_GAMES         // ajout/retrait, join/leave d'une partie, statut de ma réservation
  MY_REGISTRATIONS // tournoi/event/cours : confirmation, liste d'attente, promotion, annulation par le club
  MY_MATCHES       // demande de confirmation de résultat, litige
  PAYMENTS         // remboursement
  CLUB_MESSAGES    // broadcast admin
  ORGANIZER        // (staff) inscriptions/désinscriptions sur ce que j'organise
  REMINDERS        // rappel avant une partie/event
}

enum NotificationChannel { INAPP  PUSH  EMAIL }

model Notification {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  clubId    String?  @map("club_id")
  category  NotificationCategory
  type      String                       // ex "open_match.joined", "activity.cancelled_by_club", "club.broadcast"
  title     String
  body      String
  url       String?                      // lien profond
  data      Json?                        // ids utiles (reservationId, fenêtre de rappel…)
  readAt    DateTime? @map("read_at")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([userId, readAt])
  @@index([userId, createdAt])
  @@map("notifications")
}

// On ne stocke QUE les écarts au défaut (opt-out) : pas de ligne = canal activé.
model NotificationPreference {
  id       String  @id @default(cuid())
  userId   String  @map("user_id")
  category NotificationCategory
  channel  NotificationChannel
  enabled  Boolean

  @@unique([userId, category, channel])
  @@map("notification_preferences")
}

model PushSubscription {
  id         String   @id @default(cuid())
  userId     String   @map("user_id")
  endpoint   String   @unique
  p256dh     String
  auth       String
  userAgent  String?  @map("user_agent")
  createdAt  DateTime @default(now()) @map("created_at")
  lastSeenAt DateTime? @map("last_seen_at")

  @@index([userId])
  @@map("push_subscriptions")
}

// Audit/historique des broadcasts (le fan-out crée N Notification).
model ClubBroadcast {
  id             String   @id @default(cuid())
  clubId         String   @map("club_id")
  sentByUserId   String   @map("sent_by_user_id")
  title          String
  body           String
  url            String?
  recipientCount Int      @map("recipient_count")
  createdAt      DateTime @default(now()) @map("created_at")

  @@index([clubId, createdAt])
  @@map("club_broadcasts")
}
```

Relations ajoutées côté `User`/`Club` selon les conventions Prisma du projet (additif).

## 5. Résolution des préférences (fonction pure `preferences.ts`)

Pour un `(userId, category, channel)` :

- **Défaut = activé** (opt-out) ; désactivé uniquement si une `NotificationPreference`
  `enabled=false` existe.
- **Exception** : `CLUB_MESSAGES` + `INAPP` est **toujours ON** (non désactivable —
  ignore toute ligne contraire).
- Le canal **PUSH** n'est effectif que si le destinataire a au moins une
  `PushSubscription`.
- **La ligne `Notification` est TOUJOURS créée** dès qu'au moins un canal est actif pour
  ce `(user, category)` — elle est la source de vérité et la cible du lien profond de
  chaque canal. Le canal **INAPP** ne contrôle que **l'affichage dans la cloche**
  (présence dans la liste + comptage des non-lus) : INAPP coupé pour une catégorie ⇒ la
  notif existe en base (et a pu pousser/emailer) mais **n'apparaît pas dans la cloche** ni
  dans le compteur. `CLUB_MESSAGES` ⇒ INAPP forcé, donc toujours visible.

## 6. Catalogue des évènements

`✅` = email déjà existant → on migre l'aiguillage vers le dispatcher. `🆕` = à construire.

| Catégorie | `type` | Destinataire(s) | Statut |
|---|---|---|---|
| **MY_GAMES** | `open_match.joined` / `.left` | organisateur de la partie | ✅ |
| | `open_match.added` / `.removed` | joueur ajouté / retiré | ✅ |
| | `match.partners_invited` | partenaire ajouté | ✅ |
| | `reservation.member_assigned` | membre rattaché par le staff | ✅ |
| | `reservation.cancelled` / `.rescheduled` | participants de la résa | 🆕 |
| **MY_REGISTRATIONS** | `registration.confirmed` / `.waitlisted` / `.promoted` / `.cancelled` | joueur(s) | ✅ |
| | `activity.cancelled_by_club` | tous les inscrits (tournoi/event/cours annulé) | 🆕 |
| **MY_MATCHES** | `match.pending_confirmation` | les 3 autres joueurs | ✅ |
| | `match.comment` | participants + staff du litige | ✅ |
| **PAYMENTS** | `payment.refunded` | propriétaire de la résa | ✅ |
| **ORGANIZER** *(staff)* | `organizer.registration` / `.cancellation` | OWNER/ADMIN du club | ✅ |
| **CLUB_MESSAGES** | `club.broadcast` | tous les membres actifs | 🆕 |
| **REMINDERS** | `reminder.upcoming_game` | participants (J-1 / H-2) | 🆕 |

Le **contenu** (titre + corps + lien profond) de chaque `type` est produit par des
**builders purs** `content.ts`, testables un par un (même esprit que `templates/emails.ts`).

## 7. Écrans

### 7.1 Cloche in-app
Icône cloche dans les headers connectés, **à côté de `ProfileMenu`** (`ClubNav`, `/me`,
sidebars `/admin` et `/superadmin`). Badge de non-lus, panneau déroulant (notifs récentes,
temps relatif, clic → lien profond + marque comme lu), « Tout marquer comme lu », lien vers
la page complète **`/me/notifications`**. Live via SSE (badge incrémenté sans recharger).

### 7.2 Préférences — `/me/notifications/settings`
Grille : lignes = catégories, colonnes = **Cloche · Push · Email**.
- Tout coché par défaut (opt-out). `CLUB_MESSAGES`+Cloche **verrouillé ON** (cadenas,
  libellé « toujours reçu »).
- **ORGANIZER** affichée seulement si le membre est OWNER/ADMIN d'au moins un club.
- Colonne **Push** désactivée tant que le push n'est pas autorisé : bandeau en tête
  « Activer les notifications push » → demande de permission. **Sur iPhone non installé**,
  on affiche à la place le tuto d'install (`lib/install.ts`).
- Entrée « Notifications » ajoutée dans `ProfileMenu`.

### 7.3 Broadcast admin — `/admin/broadcast`
Réservé **OWNER/ADMIN**. Composer : titre + message + lien optionnel ; aperçu du nombre de
destinataires (« X membres actifs ») ; envoi derrière `ConfirmDialog` ; **historique** des
broadcasts (`ClubBroadcast`). À l'envoi : `createMany` des `Notification` pour les membres
actifs, puis fan-out push/email best-effort via le dispatcher (cloche forcée).

## 8. Push web — service worker + VAPID

- **Backend** : dépendance `web-push`. Clés **VAPID** en env (`VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:noreply@palova.fr`), ajoutées à
  `.env.prod.example` + `docker-compose.prod.yml`. Clé publique exposée par
  `GET /api/push/vapid-public-key`.
- **Service worker** `public/sw.js` **écrit à la main**, dédié au push : `push` →
  `showNotification` (titre/corps/icône/`data.url`) ; `notificationclick` → focus l'onglet
  existant ou ouvre le lien profond. **Aucun precaching → aucun conflit Turbopack, next-pwa
  reste inactif.**
- **Abonnement** (`lib/usePush.ts`, calqué sur `useInstallPrompt`) : enregistrer le SW →
  `Notification.requestPermission()` → `pushManager.subscribe({ userVisibleOnly:true,
  applicationServerKey })` → `POST /api/me/push-subscriptions` (endpoint + clés p256dh/auth
  + userAgent). Désabonnement → `DELETE /api/me/push-subscriptions`.
- **iPhone** : push uniquement en **PWA installée** (standalone, iOS 16.4+). Le hook détecte
  le mode standalone ; si iOS **non installé**, on affiche le tuto d'install au lieu de la
  demande de permission.

### Réponse « ça marche sur Android / iPhone ? »
- **Android** (Chrome/Edge/Firefox/Samsung Internet), **desktop** (Chrome/Edge/Firefox) :
  ✅ push complet, même app fermée.
- **iPhone/iPad** : ✅ **à condition d'avoir installé la PWA** sur l'écran d'accueil
  (iOS 16.4+). Sinon, pas de push (mais la cloche in-app reste accessible à l'ouverture).

## 9. Temps réel — SSE généralisé par-utilisateur

On **généralise `SSEService`** : on conserve l'API par-terrain et on ajoute un canal
**par-utilisateur** (`addUserClient(userId, res)` / `notifyUser(userId, payload)`). Nouvel
endpoint authentifié `GET /api/me/notifications/stream`. Le dispatcher appelle `notifyUser`
après création de la `Notification` → la cloche s'incrémente en live. Keep-alive ping déjà
géré dans le service existant.

## 10. Rappels — job node-cron

`src/jobs/reminders.job.ts` (pattern de `cleanup.job.ts`), toutes les ~15 min : trouve les
parties / events / inscriptions **à venir** entrant dans les fenêtres **J-1** et **H-2**
(fuseau du club, Luxon) et dispatche `reminder.upcoming_game`. **Idempotence** : pas d'envoi
si une `Notification` de ce `type` existe déjà pour ce `(userId, reservationId, fenêtre)` —
la fenêtre (`J-1` / `H-2`) est encodée dans `data`. Logique de fenêtre = fonction pure
paramétrée par `now` + tz.

## 11. Gestion d'erreurs (best-effort partout)

- Dispatch **après commit**, données chargées **hors transaction** ; chaque destinataire
  isolé en `try/catch` → un échec n'en bloque pas un autre, et **ne casse jamais l'action
  déclenchante** (`safeNotify`).
- **Push** : `404/410 Gone` → suppression de la `PushSubscription` périmée. Autres erreurs
  loggées, non bloquantes.
- **Email / SSE** : best-effort existant (drop des clients SSE morts déjà en place).
- **Broadcast** : `createMany` des `Notification`, puis boucle push/email best-effort.

## 12. Tests

- **Purs** : `content.ts` (titre/corps/url par `type`), `preferences.ts` (défaut ON,
  opt-out, `CLUB_MESSAGES`+INAPP forcé, push exige un abonnement), fenêtres de rappel
  (paramétrées par `now` + tz).
- **Service** : dispatcher (bons canaux selon prefs, **nettoyage des abonnements périmés**
  sur 410, best-effort non bloquant).
- **Routes** : notifications (list / read / unread-count), préférences (GET/PUT),
  push-subscriptions (POST/DELETE, auth), broadcast (**OWNER/ADMIN only**, cible les membres
  actifs, crée N + `ClubBroadcast`).
- **Nouveaux évènements** : `reservation.cancelled/.rescheduled`,
  `activity.cancelled_by_club`, rappel envoyé **une seule fois**.
- **Front** : `NotificationBell` (badge, marque-lu, live SSE), grille de préférences
  (cadenas `CLUB_MESSAGES`, colonne Push gated), `usePush` (jsdom — `matchMedia` déjà stubé,
  mock `serviceWorker`/`PushManager`), formulaire broadcast.

## 13. Découpage en lots (ordre de construction — tout reste en V1)

1. **Lot 1 — Socle + cloche** : modèles + migration `add_notifications`, dispatcher
   (`content`/`preferences` purs), SSE par-utilisateur, routes `/api/me/notifications*` +
   préférences, **migration des emails existants vers le dispatcher** (sans double envoi),
   cloche + `/me/notifications` + écran préférences (Push présent mais inactif).
2. **Lot 2 — Push web** : `web-push` + VAPID, `public/sw.js`, `usePush`, endpoints push +
   clé VAPID, activation colonne Push + bandeau permission + tuto iOS.
3. **Lot 3 — Nouveaux évènements** : `reservation.cancelled/.rescheduled`,
   `activity.cancelled_by_club` (branchés dans reservation/event/tournament/lesson services).
4. **Lot 4 — Broadcast admin** : `ClubBroadcast`, route admin, `/admin/broadcast`.
5. **Lot 5 — Rappels** : job node-cron + dedupe J-1/H-2.

## 14. Fichiers (indicatif)

**Backend**
- `prisma/schema.prisma` (+ modèles, migration `add_notifications`)
- `src/services/notification/{dispatcher,content,preferences,push}.ts`
- `src/services/sse.service.ts` (généralisé) — ou `userStream.service.ts`
- `src/routes/notifications.ts`, `src/routes/admin.broadcast.ts`
- `src/jobs/reminders.job.ts`
- refactor des call-sites de `src/email/notifications.ts`
- env : clés VAPID (`.env.prod.example`, `docker-compose.prod.yml`)

**Frontend**
- `components/notifications/{NotificationBell,NotificationPanel}.tsx`
- `app/me/notifications/page.tsx`, `app/me/notifications/settings/page.tsx`
- `app/admin/broadcast/page.tsx`
- `lib/notifications.ts` (libellés, miroir de résolution), `lib/usePush.ts`
- `public/sw.js`

## 15. Hors périmètre (V2)

- Segments/filtres avancés du broadcast (par niveau, ancienneté, sport…).
- Digest / regroupement d'emails.
- Notifications natives via app store (l'app reste une PWA).
- Préférences par-club (V1 = préférences globales par utilisateur).
