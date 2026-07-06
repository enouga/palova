# Rôle staff depuis la page Membres — Design

**Date** : 2026-07-06
**Statut** : validé (brainstorming avec Eric)

## Problème

Le back-office club est gardé par la table `ClubMember` (rôles `OWNER / ADMIN / STAFF`,
middleware `requireClubMember` avec rangs `STAFF(1) < ADMIN(2) < OWNER(3)`). Mais aujourd'hui
**seule la ligne OWNER est créée** (à la création du club, dans `club.service.ts` et
`platform.service.ts`) : il n'existe **aucune route ni UI** pour nommer un ADMIN ou un STAFF.
Un gérant ne peut donc pas donner l'accès au back-office à un employé.

## Décisions (questions/réponses)

| Question | Décision |
|---|---|
| Rôles attribuables | **ADMIN et STAFF**. OWNER hors périmètre (unique, non transférable en v1). |
| Qui peut gérer le staff | **OWNER et ADMIN** (route gardée `requireClubMember('ADMIN')`). Un ADMIN ne touche jamais un OWNER. |
| Emplacement UI | **Tableau de `/admin/members`** : badge à côté du nom + action « Rôle… » ouvrant un petit menu (Aucun / Staff / Admin). |

## Architecture

Aucune migration. `ClubMember` et `ClubMembership` (fichier-membres) restent deux tables
distinctes ; promouvoir = upsert d'une ligne `ClubMember`, révoquer = suppression.

### Backend

**1. Enrichissement de `ClubService.listMembers(clubId)`** — chaque ligne gagne
`staffRole: 'OWNER' | 'ADMIN' | 'STAFF' | null`. Implémentation : un seul
`prisma.clubMember.findMany({ where: { clubId }, select: { userId, role } })` en parallèle du
`clubMembership.findMany` existant, mappé par `userId` (pas de N+1). Champ additif : les
consommateurs existants ne cassent pas.

**2. Nouvelle route** `PATCH /api/clubs/:clubId/admin/members/:userId/staff-role`
— body `{ role: 'ADMIN' | 'STAFF' | null }`, gardée **`requireClubMember('ADMIN')`**
(override par-route, même pattern que `POST /members/:userId/level`).
Appelle `ClubService.setMemberStaffRole(clubId, actorUserId, targetUserId, role)` avec
`actorUserId = req.user!.id`.

Gardes du service, dans l'ordre :

| Garde | Erreur | HTTP |
|---|---|---|
| `role` ∉ {`ADMIN`, `STAFF`, `null`} | `VALIDATION_ERROR` | 400 |
| cible = acteur | `CANNOT_CHANGE_SELF` | 409 |
| cible sans `ClubMembership` dans ce club | `MEMBER_NOT_FOUND` | 404 |
| cible actuellement `OWNER` dans `ClubMember` | `CANNOT_CHANGE_OWNER` | 403 |

- `role: null` → `clubMember.deleteMany({ where: { userId, clubId, role: { not: 'OWNER' } } })`
  — **idempotent** (0 ligne supprimée = OK, pas d'erreur).
- `role: 'ADMIN' | 'STAFF'` → `clubMember.upsert` sur `userId_clubId`.
- Retour : `{ userId, staffRole }` (nouvel état).
- `CANNOT_CHANGE_OWNER` (403) et `CANNOT_CHANGE_SELF` (409) ajoutés à `ERROR_STATUS` dans
  `routes/admin.ts`.
- Un membre `BLOCKED` peut recevoir/perdre un rôle (pas de couplage statut ↔ rôle) ; le
  blocage coupe la réservation, pas le back-office — comportement existant, inchangé.

**3. Effet de bord assumé sur `removeMember`** (« Suppr. » du fichier-membres) : supprime
aussi la ligne `ClubMember` **non-OWNER** du même user
(`clubMember.deleteMany({ where: { userId, clubId, role: { not: 'OWNER' } } })`) — sinon un
membre retiré du club garderait l'accès au back-office. Le `findUnique` existant du
`removeMember` récupère désormais aussi `userId`.

### Frontend

Tout dans `frontend/app/admin/members/page.tsx` + `lib/api.ts`.

- **`lib/api.ts`** : `Member.staffRole?: 'OWNER' | 'ADMIN' | 'STAFF' | null` (additif) +
  `adminSetMemberStaffRole(clubId, userId, role, token)`.
- **Badge** : `Chip` à côté du nom — `OWNER` → « Gérant », `ADMIN` → « Admin »,
  `STAFF` → « Staff » ; rien pour un membre simple.
- **Action « Rôle… »** dans la colonne d'actions : ouvre un petit popover inline
  (3 options radio-like : Aucun / Staff / Admin, rôle courant marqué) ; clic sur une option →
  PATCH immédiat → fermeture → `load()`. Fermeture au clic extérieur et à Échap (pattern
  `SportPicker`).
- **Gating viewer** : le bouton n'est rendu que si le viewer est OWNER ou ADMIN du club —
  rôle lu via `api.getMyClubs(token)` (pattern du layout admin / ProfileMenu) ; l'id du
  viewer via `api.getMyProfile(token)` pour masquer l'action sur **sa propre ligne**.
  Le bouton est aussi masqué sur la ligne d'un **OWNER**. Un STAFF voit les badges mais
  jamais l'action.
- **Messages d'erreur** mappés : `CANNOT_CHANGE_OWNER` → « Le rôle du gérant ne peut pas
  être modifié. », `CANNOT_CHANGE_SELF` → « Vous ne pouvez pas modifier votre propre
  rôle. » (affichés dans le bandeau d'erreur existant de la page).

Effet immédiat pour le promu : `getMyClubs` étant dérivé de `ClubMember`, le lien
« Espace club » du `ProfileMenu` et l'accès `/admin` apparaissent sans autre changement.

## Tests

- **`club.service.test.ts`** : `listMembers` expose `staffRole` (OWNER/ADMIN/null) ;
  `setMemberStaffRole` — upsert ADMIN, upsert STAFF, révocation idempotente, refus
  `CANNOT_CHANGE_OWNER`, refus `CANNOT_CHANGE_SELF`, refus `MEMBER_NOT_FOUND`, refus
  `VALIDATION_ERROR` ; `removeMember` supprime la ligne `ClubMember` non-OWNER.
- **Route admin** (test de routes) : 403 pour un viewer STAFF, 200 pour ADMIN, mapping
  des codes d'erreur.
- **`AdminMembers.test.tsx`** : badge « Admin » affiché ; bouton « Rôle… » présent pour un
  viewer OWNER, absent pour un viewer STAFF, absent sur sa propre ligne et sur la ligne du
  gérant ; sélection « Staff » → PATCH émis puis rechargement.
  ⚠️ Mocker `api.getMyClubs` et `api.getMyProfile` dans la suite.

## Hors périmètre (v1)

- Attribution ou transfert du rôle OWNER (multi-gérants).
- Permissions fines par rôle (le STAFF garde l'accès quasi complet au back-office — Lot 2
  documenté dans `routes/admin.ts`, inchangé).
- Notification (email ou in-app) au membre promu/révoqué.
- Révocation du rôle staff au **blocage** d'un membre (seul « Suppr. » révoque).
