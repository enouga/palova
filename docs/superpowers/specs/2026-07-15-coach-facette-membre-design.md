# Coach = facette du membre + bloc « Rôle » visible dans le panneau membre — Design

**Date** : 2026-07-15
**Statut** : validé par Eric (brainstorming en session)
**Périmètre** : suppression de la page `/admin/coaches`, gestion des coachs depuis `/admin/members`, relocalisation du contrôle de rôle staff (aujourd'hui caché derrière le bouton « Rôle… » en pied de panneau).

---

## 1. Contexte & problème

Trois constats sur l'existant :

1. **La page `/admin/coaches` est une surface de plus pour presque rien** : un formulaire nom/bio/ordre/actif + une liste. Le coach y est une entité « fantôme » (table `Coach`, aucun lien avec un compte utilisateur).
2. **Deux champs mal en point** : `Coach.bio` n'est affiché **nulle part** côté public (la fiche cours `/cours/[id]` ne montre que nom + photo) — champ mort. `Coach.photoUrl` est affiché publiquement mais **aucune UI ne permet de le renseigner** — champ orphelin.
3. **L'attribution du rôle staff est trop cachée** : le bouton « Rôle… » vit dans la rangée d'actions du pied du panneau membre, entre « Bloquer » et « Supprimer le membre », et n'ouvre qu'un popover (`StaffRoleMenu`). Invisible tant qu'on n'a pas cliqué.

## 2. Décisions

1. **Coach devient une facette du membre**, gérée depuis le panneau membre de `/admin/members` — même philosophie que les rôles staff. La page `/admin/coaches`, son entrée sidebar et son test sont **supprimés**.
2. **Le contrôle de rôle devient un bloc visible « RÔLE »** dans le panneau membre : chips segmentées Membre / Staff / Admin à **application immédiate** (comportement du popover actuel conservé), hint de l'option active dessous, puis case **« Coach — anime des cours »** (application immédiate aussi). Le bouton « Rôle… » et le composant `StaffRoleMenu` disparaissent. *(Option A retenue parmi 3 maquettes comparées.)*
3. **La table `Coach` reste l'ancre des FK** (les séries de cours pointent dessus en `Restrict`, `Reservation.coachId` en `SetNull`) : on lui ajoute simplement un **`userId` nullable**. Cocher « Coach » sur un membre crée/réactive sa ligne `Coach` ; décocher la désactive (soft, `isActive:false` — les cours existants restent intacts).
4. **Nom et photo d'un coach lié = dérivés du compte user à la sérialisation** (prénom + nom, `avatarUrl`) — le problème de la photo disparaît : le coach gère son avatar depuis son profil. Repli sur les colonnes `Coach.name`/`photoUrl` pour les coachs legacy (sans `userId`).
5. **`bio` n'est plus ni saisi ni exposé.** La colonne reste en base (pas de drop destructif), simplement inutilisée.
6. **Un coach doit désormais être membre du club** (avoir un compte Palova). Compromis assumé — cf. §7.

Croquis du panneau (option retenue) :

```
┌─ Panneau membre ────────────────┐
│ ● Alice Martin                  │
│   alice@exemple.fr              │
│   [Actif]                       │
│                                 │
│ RÔLE                            │
│ ( Membre │ Staff● │ Admin )     │ ← s'applique au clic
│   Accès au back-office du club  │ ← hint de l'option active
│ ☑ Coach — anime des cours       │ ← s'applique au clic
│                                 │
│ TÉLÉPHONE …                     │
│ [       Enregistrer       ]     │
│ ─────────────────────────────   │
│ [Bloquer]   [Supprimer membre]  │
└─────────────────────────────────┘
```

## 3. Modèle de données — migration additive `add_coach_user_link`

```prisma
model Coach {
  // …champs existants inchangés (name, photoUrl, bio, isActive, sortOrder)…
  userId String? @map("user_id")
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@unique([clubId, userId])
}
```

- SQL additif : `ALTER TABLE coaches ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;` + index unique `(club_id, user_id)`.
- **Postgres autorise les NULL multiples dans un index unique** → les coachs legacy (`user_id` null) cohabitent sans contrainte, un même user ne peut être coach qu'une fois par club.
- Dossier de migration horodaté `prisma/migrations/20260715…_add_coach_user_link/` ; **DEV via `prisma db execute`** (dérive de base connue), **prod `migrate deploy`**.
- À la création de la ligne `Coach`, `name` est snapshoté depuis le user (`Prénom Nom`) : il sert de repli d'affichage et garde le chemin legacy uniforme.

## 4. Backend

### 4.1 `CoachService.setMemberCoach(clubId, userId, isCoach)`

- Vérifie l'adhésion du user au club (`ClubMembership`) → **`MEMBER_NOT_FOUND` 404** sinon.
- `isCoach: true` : upsert sur `[clubId, userId]` — ligne existante → `isActive: true` ; sinon `create { clubId, userId, name: 'Prénom Nom', isActive: true }`.
- `isCoach: false` : `updateMany → isActive: false` (idempotent, pas d'erreur si aucune ligne).
- **Pas de garde self/owner** : contrairement au rôle staff (privilèges d'accès → `CANNOT_CHANGE_SELF`/`CANNOT_CHANGE_OWNER`), être coach ne confère aucun droit — un admin peut se marquer lui-même coach, et le gérant peut l'être.

### 4.2 Route

`PATCH /api/clubs/:clubId/admin/members/:userId/coach` — **`requireClubMember('ADMIN')`** (même gate que `staff-role`), body `{ isCoach: boolean }` (absent ou non-booléen → `VALIDATION_ERROR` 400). Déclarée à côté de `staff-role` dans `admin.ts`.

### 4.3 `listMembers` expose `isCoach`

`ClubService.listMembers` ajoute `isCoach: boolean` — **une** requête groupée `coach.findMany({ where: { clubId, isActive: true, userId: { in: memberUserIds } } })` (pattern `staffRole`, pas de N+1).

### 4.4 Sérialisation nom/photo — helper pur `coachDisplay`

Helper pur exporté par `coach.service.ts` :

```ts
coachDisplay(c: { name; photoUrl; user?: { firstName; lastName; avatarUrl } | null })
  → { name, photoUrl }   // user présent → `Prénom Nom` + avatarUrl ; sinon colonnes Coach
```

Sites à brancher (étendre les `select` avec `user: { firstName, lastName, avatarUrl }` puis mapper) :
- `lesson.service.ts` : les ~6 selects `coach: { name, photoUrl }` (rows publiques, détail de séance, hydratations).
- `email/notifications.ts` : 2 sites `coach: { select: { name } }` (libellé « Cours — {coach} »).
- `CoachService.listAdmin` (alimente le picker « Nouveau cours » du planning) : renvoie `name`/`photoUrl` dérivés ; forme de réponse inchangée pour le front.

### 4.5 Routes supprimées

`POST /coaches`, `PATCH /coaches/:id`, `DELETE /coaches/:id` + les méthodes `CoachService.create/update/remove` (plus aucun appelant). **`GET /coaches` est conservé** (picker du planning, accessible STAFF comme le reste du routeur admin).

## 5. Frontend

### 5.1 `MemberPanel` — bloc « RÔLE »

- **Position** : sous la rangée de chips d'état, au-dessus des champs éditables (visible sans scroll).
- **Segmented Membre / Staff / Admin** à application immédiate — composant `Segmented` existant de `ui/atoms` (celui des onglets de la fiche membre) ; réutilise le callback `onSetRole` existant (la page appelle déjà `adminSetMemberStaffRole`, gardes backend inchangées). Le **hint** de l'option active (textes repris de `StaffRoleMenu` : « Membre simple, pas d'accès au back-office » / « Accès au back-office du club » / « Back-office + gestion du staff et des niveaux ») s'affiche sous les chips.
- **Case « Coach — anime des cours »** : application immédiate, nouvelle callback `onSetCoach` → `api.adminSetMemberCoach`, puis re-load (même cycle que `onSetRole`).
- **Gating** : bloc rendu si `canManageStaff` (viewer OWNER/ADMIN). Sur la ligne du **gérant** et sur **sa propre ligne**, le segmented est remplacé par le libellé statique du rôle (« Gérant », « Admin »…) — mêmes cas que le masquage actuel du bouton « Rôle… » ; la **case Coach reste opérable** dans ces deux cas (aucun privilège en jeu).
- La **chip de rôle staff en tête de panneau est retirée** (redondante avec le bloc) ; les chips des lignes de liste restent, et gagnent une chip **« Coach »**.
- `StaffRoleMenu.tsx` est **supprimé** ; le message d'erreur `MEMBER_IS_STAFF` (suppression d'un membre staff) est reformulé — il référence aujourd'hui le « bouton “Rôle…” ».

### 5.2 Suppressions & API front

- Page `app/admin/coaches/page.tsx`, entrée sidebar « Coachs », `AdminCoaches.test.tsx` : supprimés.
- `lib/api.ts` : `adminCreateCoach`/`adminUpdateCoach`/`adminDeleteCoach` retirés ; `adminListCoaches` conservé ; **`adminSetMemberCoach(clubId, userId, isCoach, token)`** ajouté ; type `Member` gagne `isCoach: boolean` ; type `CoachBody` retiré.

### 5.3 Picker « Nouveau cours » (planning)

**Inchangé.** Il liste les coachs actifs via `GET /coaches` ; un membre qu'on vient de cocher « Coach » y apparaît immédiatement, avec son nom de profil.

## 6. Parcours résultant

1. L'admin ouvre `/admin/members`, clique un membre → panneau.
2. Le bloc RÔLE est visible d'emblée : il coche « Coach — anime des cours ».
3. Dans `/admin/planning` → « Nouvel événement » → « Cours encadré », le membre apparaît dans le sélecteur de coach.
4. Sur la fiche publique du cours, nom et photo viennent du profil du coach (avatar qu'il gère lui-même).

## 7. Compromis assumés & hors périmètre

- **Plus d'ajout de coach « nom seul »** : un coach doit être membre du club (s'inscrire prend une minute et lui donnera accès à son planning à terme). Les coachs legacy existants restent actifs et sélectionnables dans le picker, **sans UI de gestion** (limitation assumée, adoption quasi nulle en prod).
- **RGPD** : un user anonymisé (soft delete) encore lié à un coach verrait son nom dérivé anonymisé — au club de décocher la case. Edge accepté.
- **Hors périmètre** : espace coach (voir son planning, ses élèves), photo de coach distincte de l'avatar, bio publique, rémunération, transfert des coachs legacy vers des comptes.

## 8. Tests

**Backend** :
- `coach.service` : `setMemberCoach` (création, réactivation, désactivation, idempotence, `MEMBER_NOT_FOUND`), `coachDisplay` (user présent / legacy).
- `club.service` : `listMembers.isCoach` (actif lié → true ; désactivé ou legacy sans userId → false).
- `lesson.service` : nom/photo dérivés du user quand lié, repli colonnes pour un coach legacy.
- Routes admin : `PATCH …/coach` (ADMIN 200, STAFF 403, body invalide 400) ; `POST/PATCH/DELETE /coaches` → 404.

**Frontend** :
- `MemberPanel` : segmented applique `onSetRole`, hint affiché, case Coach applique `onSetCoach`, gating gérant/self (libellé statique mais case Coach opérable), chip staff retirée du panneau.
- Page membres : chip « Coach » dans les lignes.
- `AdminLayout` : entrée « Coachs » absente.
- Suites existantes membres adaptées ; `AdminCoaches.test.tsx` supprimé.
