# Discussion / commentaires sur un match en litige — Design

**Date :** 2026-06-22
**Statut :** validé, prêt pour plan d'implémentation
**Feature parent :** Système de niveau de joueur (Glicko-2) — matchs & litiges. Aujourd'hui un
joueur peut *contester* un résultat (le match passe `DISPUTED`) et le staff *arbitre* (Valider /
Annuler) depuis `/admin/matches → Litiges`, **sans aucun contexte sur le pourquoi du litige**.

## Besoin

Permettre au joueur d'**ajouter des commentaires (entamer une discussion)** en cas de litige :
un fil d'échange attaché au match, entre les 4 joueurs et le staff, pour expliquer / clarifier
avant que le staff ne tranche.

## Décisions de périmètre (le « pourquoi »)

Issues du brainstorming (choix utilisateur) :

1. **Déclencheur = motif à la contestation, puis fil.** Cliquer « Contester » exige désormais un
   **motif** (texte obligatoire) ; ce motif **est le 1er message** du fil. Ensuite, tant que le match
   est `DISPUTED`, les participants ajoutent des messages.
2. **Participants = 4 joueurs + staff.** Les 4 `MatchPlayer` **et** le staff (`ClubMember`
   OWNER/ADMIN/STAFF du club du match) peuvent **lire et écrire**. Le staff répond/questionne dans
   le fil avant d'arbitrer.
3. **Notification = email à chaque message.** À chaque nouveau message, les autres participants
   (4 joueurs + staff − l'auteur) reçoivent un email (infra best-effort existante).
4. **Après arbitrage = lecture seule (archivé).** Une fois le match résolu (Valider → `CONFIRMED`,
   Annuler → `CANCELLED`), le fil reste consultable mais **plus personne n'écrit** (le statut n'est
   plus `DISPUTED`).

**Hors v1 (assumé) :** pièces jointes / photos du tableau de score ; édition/suppression d'un
message ; accusés de lecture ; temps réel (SSE) ; mentions ; discussion sur un match **non** litigieux
(en attente de confirmation) — on n'écrit que sur `DISPUTED`.

## A. Modèle de données

Nouveau modèle Prisma `MatchComment` (un message = une ligne) :

```prisma
model MatchComment {
  id        String   @id @default(cuid())
  matchId   String   @map("match_id")
  userId    String   @map("user_id")
  body      String
  createdAt DateTime @default(now()) @map("created_at")

  match Match @relation(fields: [matchId], references: [id], onDelete: Cascade)
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([matchId, createdAt])
  @@map("match_comments")
}
```

- Relations ajoutées : `Match.comments MatchComment[]` et `User.matchComments MatchComment[]`.
- **Migration additive** `add_match_comments` (création de table seulement — zéro risque sur
  l'existant ; à appliquer au boot via `prisma migrate deploy`).
- `body` : texte **trimmé, 1 à 1000 caractères**. Pas de pièce jointe (YAGNI v1).
- **Pas de champ `disputeReason` séparé** sur `Match` : le motif de contestation **est** le 1er
  `MatchComment`.

## B. Service & permissions (backend)

Helper d'accès unique, `assertMatchAccess(matchId, userId)` → renvoie `{ match, isPlayer, isStaff }`
ou jette :
- `MATCH_NOT_FOUND` si le match n'existe pas ;
- lecture/écriture autorisées si `isPlayer` (l'un des 4 `MatchPlayer`) **ou** `isStaff`
  (`ClubMember` OWNER/ADMIN/STAFF du `match.clubId`) ; sinon `FORBIDDEN`.
- Garde `levelSystemEnabled` du club (cohérent avec le reste du système de niveau).

`MatchService` :
- **`dispute(matchId, userId, message)` — signature modifiée.** En une transaction : valide le
  message (trimmé, 1–1000, sinon `VALIDATION_ERROR`) ; les gardes actuelles restent (`loadPending` :
  match `PENDING` + `userId` est un joueur) ; passe la confirmation du contestataire à `DISPUTED`,
  le match à `DISPUTED`, et **crée le 1er `MatchComment`** (auteur = `userId`, body = message).
  Après commit : `safeNotify(notifyNewMatchComment(matchId, userId, { isFirst: true }))`.
- **`listComments(matchId, userId)`** → `assertMatchAccess` ; renvoie le fil trié `createdAt asc`
  (chaque message : `id`, auteur `{ firstName, lastName, avatarUrl }`, `isStaff`, `body`,
  `createdAt`) **+ `status`** du match (le client en déduit `canWrite`).
  ⚠️ Le `isStaff` **par message** qualifie **l'auteur du message** (badge « Staff ») — à ne pas
  confondre avec le `isStaff` de `assertMatchAccess` qui qualifie **le demandeur**. Calculé en
  comparant chaque `userId` auteur à l'ensemble des `ClubMember` du club du match (chargé une fois).
- **`addComment(matchId, userId, body)`** → `assertMatchAccess` **+ exige `match.status ===
  'DISPUTED'`** (sinon `MATCH_NOT_DISPUTED` = lecture seule) ; valide `body` (1–1000) ; crée le
  `MatchComment`. Après commit : `safeNotify(notifyNewMatchComment(matchId, userId, { isFirst: false }))`.

`resolveDispute` / `voidMatch` **inchangés** : ils ne touchent pas aux commentaires (le fil est
conservé) ; le passage hors `DISPUTED` suffit à le figer en lecture seule.

## C. Routes API

Dans `src/routes/matches.ts` (à côté de `confirm`/`dispute`), toutes derrière `authMiddleware` :

| Méthode | Route | Corps | Autorisé |
|---|---|---|---|
| `POST` | `/api/matches/:id/dispute` | `{ message }` **(obligatoire)** | joueur du match |
| `GET`  | `/api/matches/:id/comments` | — | joueur **ou** staff |
| `POST` | `/api/matches/:id/comments` | `{ body }` | joueur **ou** staff, si `DISPUTED` |

L'autorisation joueur **ou** staff est portée par `assertMatchAccess` dans le service (la route passe
seulement `req.user.id`). Mapping d'erreurs : 404 `MATCH_NOT_FOUND` ; 403 `FORBIDDEN` ; 409
`MATCH_NOT_PENDING` (dispute) / `MATCH_NOT_DISPUTED` (addComment) ; 400 `VALIDATION_ERROR` ; 403
`LEVEL_SYSTEM_DISABLED`.

**Payloads enrichis (compteur, sans charger le fil) :** ajouter `commentCount` (via
`_count.comments`) à :
- `GET /api/me/matches` (côté joueur) ;
- la liste admin `GET /api/clubs/:clubId/admin/matches` (`ClubMatch`).
→ Permet d'afficher « 💬 3 » sans appeler `listComments`. Forme des réponses sinon inchangée
(ajout purement additif).

## D. Notifications email

Un seul orchestrateur **`notifyNewMatchComment(matchId, authorUserId, { isFirst })`** (dans
`src/email/notifications.ts`, appelé par `dispute` et `addComment`) :
- Charge **hors transaction** le match + ses 4 joueurs + le staff (OWNER/ADMIN/STAFF) du club + le
  dernier message.
- **Destinataires** = (4 joueurs + staff) **− l'auteur**, dédupliqués.
- Sujet différencié : `isFirst` → « *{Auteur} a contesté le résultat de votre match* » ; sinon
  « *Nouveau message sur le litige de votre match* ». Corps = nom de l'auteur + extrait du message +
  lien vers le match (sous-domaine club). Builder pur ajouté dans
  `src/email/templates/emails.ts` (réutilise `layout.ts`, `escapeHtml`, `readableTextOn`, `links.ts`).
- **Best-effort** : tout échec SMTP est loggé, **jamais** propagé (`safeNotify`) — un email raté
  n'empêche ni la contestation ni le commentaire.

## E. Frontend

**Composant partagé `frontend/components/match/MatchDiscussion.tsx`** (joueur + staff) :
- Props : `matchId`, `token`, `canWrite` (= `status === 'DISPUTED'`). Charge
  `GET /api/matches/:id/comments` à l'ouverture.
- Affiche les messages : avatar + nom (badge **« Staff »** si `isStaff`), texte, date relative,
  triés. Zone de saisie (textarea ≤ 1000 + « Envoyer ») si `canWrite`, sinon mention
  **« Discussion close »** (lecture seule). Optimiste : recharge le fil après envoi.
- Méthodes `lib/api.ts` : `getMatchComments(id, token)`, `postMatchComment(id, body, token)` ;
  **`disputeMatch(id, message, token)`** (signature enrichie d'un `message`). Types `MatchComment`
  (`id`, `author { firstName, lastName, avatarUrl }`, `isStaff`, `body`, `createdAt`) et `MatchThread`
  (`status`, `comments`).

**Côté joueur — `frontend/components/match/MyMatchesList.tsx` :**
- « Contester » ouvre une **zone de motif** (textarea obligatoire) → `disputeMatch(id, message)`
  (au lieu de contester sans texte). Bouton désactivé tant que le motif est vide.
- Les matchs `DISPUTED` (et résolus avec `commentCount > 0`) affichent un toggle **« 💬 Discussion »**
  (avec le compteur) dépliant `MatchDiscussion`. Écriture seulement si `DISPUTED`.

**Côté staff — `frontend/app/admin/matches/page.tsx` :**
- Onglet **Litiges** : chaque litige affiche `MatchDiscussion` inline (motif + échanges) avec zone
  de réponse staff, au-dessus des boutons Valider / Annuler.
- Onglet **Matchs confirmés** : toggle **« Voir la discussion »** (si `commentCount > 0`) en
  **lecture seule** (même composant, `canWrite=false`) — l'archive du litige résolu.

## F. Tests (TDD, Prisma mocké)

**Backend :**
- `match.service.test.ts` (bloc « commentaires de litige ») : `dispute` exige un motif non vide +
  crée le 1er commentaire + passe `DISPUTED` ; `addComment` exige `DISPUTED` (sinon
  `MATCH_NOT_DISPUTED`) ; accès joueur **et** staff OK, tiers → `FORBIDDEN` ; lecture du fil après
  arbitrage = lecture seule (write refusé) ; notif appelée mais **échec non bloquant**.
- Tests de routes (`matches.routes`) : auth, mapping des erreurs, `dispute` rejette un corps sans
  `message`.
- `emails.test.ts` : builder `notifyNewMatchComment` — sujet 1er-vs-réponse, échappement HTML,
  destinataires hors auteur, lien club.

**Frontend :**
- `MatchDiscussion.test.tsx` : rend le fil ; saisie gatée par `canWrite` ; envoi → POST + recharge.
- `MyMatchesList.test.tsx` : « Contester » impose un motif (bouton désactivé si vide) ; envoi avec
  message ; toggle Discussion.
- Test admin matches : fil affiché dans Litiges + réponse staff ; archive lecture seule en Matchs
  confirmés.

## Récap des fichiers touchés

- **Back** : `prisma/schema.prisma` (+ modèle `MatchComment`, relations) ; migration
  `add_match_comments` ; `src/services/match.service.ts` (dispute signature + listComments/addComment
  + assertMatchAccess) ; `src/routes/matches.ts` (3 routes) ; `src/routes/me.ts` (commentCount) ;
  `src/routes/admin.ts` (commentCount) ; `src/email/notifications.ts` + `src/email/templates/emails.ts`.
- **Front** : `lib/api.ts` (types + méthodes, signature `disputeMatch`) ;
  `components/match/MatchDiscussion.tsx` (nouveau) ; `components/match/MyMatchesList.tsx` ;
  `app/admin/matches/page.tsx`.
- **Migration** : une seule, additive (`add_match_comments`).
