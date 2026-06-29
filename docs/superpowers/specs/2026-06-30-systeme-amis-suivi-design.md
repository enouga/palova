# Système d'amis (suivi de joueurs) — Design

> Date : 2026-06-30
> Statut : validé, prêt pour plan d'implémentation
> Périmètre : suivre des joueurs et les ajouter rapidement lors des parties

## Intention

Permettre à un joueur de **suivre** d'autres joueurs (« amis ») et de les **ajouter en un tap**
lors de la création d'une partie / réservation, du remplissage d'une partie ouverte, ou de la
recherche d'un coéquipier de tournoi. Le but produit : zéro friction pour rejouer avec les mêmes
personnes.

## Décisions cadres (validées avec l'utilisateur)

1. **Lien = suivi à sens unique** (modèle Instagram), pas de demande/acceptation. Le statut
   « ami » (réciproque) est **dérivé** quand les deux se suivent — jamais un modèle séparé.
2. **Friendship globale, action de suivi club-scoped.** Les données d'amitié sont globales
   (ta liste d'amis te suit à travers tous tes clubs), mais **l'action « suivre » exige d'être
   co-membre actif** du club où la rencontre a lieu. Cela donne, gratuitement :
   - une frontière de confidentialité naturelle (on ne peut suivre que des gens qu'on côtoie déjà
     dans un club — pas d'énumération d'inconnus) ;
   - un `clubId` pour brander la notification « X vous suit » ;
   - une liste d'amis qui persiste à travers les clubs.
3. **Ajout rapide partout** : création de partie/réservation, rejoindre une partie ouverte,
   recherche de coéquipier (tournois), fiche joueur / annuaire.

Alternatives écartées : suivi global sans contrôle de co-membre (fuite d'identités /
énumération) ; amis par club (oblige à re-suivre dans chaque club — contraire au choix « global »).

## 1. Modèle de données

Migration **additive** `add_player_follows` (1 table).

```prisma
model Follow {
  id          String   @id @default(cuid())
  followerId  String   // qui suit
  followingId String   // qui est suivi
  createdAt   DateTime @default(now())
  follower    User @relation("FollowsGiven",    fields: [followerId],  references: [id], onDelete: Cascade)
  following   User @relation("FollowsReceived", fields: [followingId], references: [id], onDelete: Cascade)
  @@unique([followerId, followingId])
  @@index([followingId])
}
```

- Pas de `clubId` sur la ligne — la **friendship est globale**.
- **« Ami » (mutuel) est dérivé** : les deux lignes existent → mutuel. Aucun champ stocké.
- **Auto-suivi interdit** (garde dans le service, `followerId !== followingId`).
- Relations ajoutées sur `User` : `followsGiven Follow[] @relation("FollowsGiven")`,
  `followsReceived Follow[] @relation("FollowsReceived")`.
- **Application** : `prisma db push` en DEV (dérive de migrations connue), **SQL hand-authored** +
  `prisma migrate deploy` pour la prod (cf. mémoire « Prisma: migrate deploy, not migrate dev »).

## 2. Backend — `FollowService` + routes

Nouveau service `backend/src/services/follow.service.ts`. Conventions existantes : services reçoivent
le `userId` décodé, erreurs = chaînes mappées en codes HTTP par le `handleError` des routes,
transactions Serializable si multi-étapes (ici simple upsert/delete, pas besoin).

### Action de suivi (club-scoped, co-membre vérifié)

- `POST   /api/clubs/:slug/follows/:userId` → `follow(slug, followerId, targetUserId)`
- `DELETE /api/clubs/:slug/follows/:userId` → `unfollow(slug, followerId, targetUserId)`

Règles :
- club `ACTIVE` ; **les deux** utilisateurs ont une `ClubMembership` `status:ACTIVE` sur ce club
  (sinon `NOT_A_MEMBER` / `FORBIDDEN`).
- auto-suivi → `CANNOT_FOLLOW_SELF` (400).
- **idempotent** : suivre deux fois = pas d'erreur (upsert sur `@@unique`) ; désuivre ce qui
  n'existe pas = succès silencieux.
- au `follow` (création réelle d'une nouvelle ligne uniquement, pas un re-follow) : notification
  best-effort `SOCIAL` / type `follow.new` → titre « X vous suit », **in-app + push, pas d'email**,
  `clubId` = club courant (branding), `url = /me/friends?tab=followers`. Coalescing simple : ne pas
  renotifier si une notif `follow.new` non lue du même `followerId` existe déjà.
- retourne l'état de relation : `{ iFollow: boolean, followsMe: boolean, mutual: boolean }`.

### Lectures (globales)

- `GET /api/me/following?q=` → `listFollowing(userId, q?)`
- `GET /api/me/followers`     → `listFollowers(userId)`

Chaque entrée : `{ id, firstName, lastName, avatarUrl, mutual }`, filtrable par nom (`q`).
`mutual` calculé en une requête (présence de la ligne inverse).

### Ajout rapide (club-scoped) — l'endpoint pivot

- `GET /api/clubs/:slug/friends?q=` → `listClubFriends(slug, userId, q?)`

Renvoie **mes amis globaux ∩ membres ACTIFS de ce club**, avec leur **niveau pour le sport préféré
du club** (réutilise `ratingService.getLevelsForUsers`, comme `searchMembers`) :
`{ id, firstName, lastName, avatarUrl, level, mutual }[]`. C'est la seule source des surfaces
d'ajout rapide. Exclut le caller, les `BLOCKED`, et les non-membres.

### Enrichissement de `searchMembers`

`club.service.searchMembers` ajoute par résultat `iFollow` / `mutual`, pour afficher un toggle
Suivre/Suivi(e) en direct dans l'annuaire (une requête `Follow` groupée sur les ids retournés).
`ClubMemberSearchResult` gagne `iFollow?: boolean` et `mutual?: boolean` (additif, optionnels).

### Catégorie de notification

Ajouter la valeur **`SOCIAL`** à l'enum `NotificationCategory` (migration additive, ou incluse dans
`add_player_follows`). Défaut des préférences : in-app + push ON, email non utilisé pour cette
catégorie. Libellé de préférence FR « Amis & suivi » dans `lib/notifications.ts`.

## 3. Surfaces d'ajout rapide (frontend)

### A — Création de partie / réservation (`PlayerPicker` + `BookingModal`)
Rangée horizontale **« Mes amis »** de chips-avatars au-dessus du champ de recherche : amis membres
du club (via `listClubFriends`), avec niveau. 1 tap = ajouté comme partenaire ; ami déjà ajouté =
coche ; rangée masquée si vide. Préserver les retouches cosmétiques en cours du champ de recherche.

### B — Partie ouverte (`OpenMatchCard` / `OpenMatches`)
- **Preuve sociale** : un anneau « ami » teinté (réutilise `Avatar` + `colorForSeed`) sur les
  avatars des joueurs que je suis, + ligne d'incitation « Léa et 1 ami dans cette partie ».
- **Ajout organisateur** : même `FriendsQuickRow` quand l'organisateur ajoute un joueur.
- ⚠️ `OpenMatches` monte le **vrai `ClubNav`** dans ses tests : étendre le mock `lib/api` de ces
  suites, **ne jamais ajouter d'appel `api.*` dans `ClubNav`** (cf. mémoire).

### C — Coéquipier de tournoi (`PartnerSearch`)
Section **« Mes amis »** épinglée en haut du dropdown (mutuel + niveau), résultats de recherche en
dessous. Préserver les retouches cosmétiques en cours.

### D — Fiche joueur & participants (`FollowButton`)
Toggle compact **Suivre / ✓ Suivi(e)** (état **« Ami »** si mutuel) à côté de chaque joueur visible :
lignes de `searchMembers`, participants d'une partie ouverte, cartes de participants tournoi/event.

## 4. Hub « Mes amis » + composants partagés

- **Page `/me/friends`** (shell de `/me/profile`) : onglets **Amis** (mutuels, épinglés),
  **Je suis** (following), **Me suivent** (followers) ; recherche ; follow/unfollow inline.
  Lien depuis `ProfileMenu` (« Mes amis », avec compteur). Cible des notifications `follow.new`.
- **Composants partagés réutilisés partout** :
  - `FollowButton` — toggle optimiste, 3 états (Suivre / Suivi(e) / Ami), `Icon` + accent.
  - `FriendsQuickRow` — la rangée de chips-avatars d'ajout rapide (A, B-organisateur, alimente C) ;
    réutilise `Avatar` (+ `colorForSeed`) et `LevelChip`.
- **`lib/api.ts`** : `listFollowing`, `listFollowers`, `followUser(slug, id)`,
  `unfollowUser(slug, id)`, `listClubFriends(slug, q?)` + types `Friend`, `FollowRelation`.

## 5. Tests

### Backend — `follow.service.test.ts`
- follow/unfollow **idempotents** ; auto-suivi refusé ; co-membre actif requis (non-membre /
  BLOCKED refusés) ; détection du `mutual` ; `listClubFriends` n'intersecte que les membres actifs
  du club (exclut non-membres et autres clubs) ; enrichissement `iFollow`/`mutual` de
  `searchMembers` ; notification `follow.new` déclenchée une fois, échec email/push non bloquant.

### Frontend
- `FollowButton.test.tsx` (3 états, optimiste, rollback sur erreur), `FriendsQuickRow.test.tsx`
  (ajout 1 tap, déjà ajouté, vide), ajouts dans les suites `PlayerPicker` / `PartnerSearch` /
  `OpenMatch*`. Étendre les mocks `lib/api` des suites montant le vrai `ClubNav`.

## Hors périmètre (v1)

Chat réservé aux amis ; flux/notif « un ami a créé une partie » ; classements entre amis ;
blocage/sourdine. Évolutions faciles ensuite.

## Fichiers touchés (récapitulatif)

| Domaine | Fichiers |
|---|---|
| Schéma / migration | `backend/prisma/schema.prisma`, `backend/prisma/migrations/<ts>_add_player_follows/migration.sql` |
| Service / routes | `backend/src/services/follow.service.ts`, `backend/src/services/club.service.ts` (searchMembers), `backend/src/routes/clubs.ts`, `backend/src/routes/me.ts` |
| Notifications | enum `NotificationCategory` (+`SOCIAL`), `backend/src/services/notification/*`, `frontend/lib/notifications.ts` |
| API front | `frontend/lib/api.ts` (méthodes + types) |
| Composants | `frontend/components/social/FollowButton.tsx`, `frontend/components/social/FriendsQuickRow.tsx`, `frontend/app/me/friends/page.tsx`, `frontend/components/ProfileMenu.tsx`, `PlayerPicker.tsx`, `BookingModal.tsx`, `PartnerSearch.tsx`, `OpenMatchCard.tsx`, `OpenMatches.tsx` |
| Tests | `backend/src/services/__tests__/follow.service.test.ts`, `frontend/__tests__/{FollowButton,FriendsQuickRow,...}.test.tsx` |
