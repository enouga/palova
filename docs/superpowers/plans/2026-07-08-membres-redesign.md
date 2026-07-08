# Refonte page admin « Membres » — liste riche, panneau d'édition, données vivantes

## Contexte

La page `/admin/members` est aujourd'hui un tableau brut de 8 colonnes (édition inline + bouton « Enregistrer » par ligne, deux gros formulaires d'ajout en bas, scroll horizontal en mobile). L'utilisateur veut une refonte **graphique et fonctionnelle** ambitieuse. Design validé avec lui :

- **Liste riche + panneau latéral** (pattern Encaissement) au lieu du tableau ;
- **Enrichissement backend complet** de `GET /admin/members` (avatar, abonnement, carnet, niveau, dernière activité) — additif, **aucune migration** ;
- 4 fonctionnalités : **filtres + tri + compteurs**, **bandeau KPI**, **export CSV**, **dialog « + Ajouter » unifié**.

Branche de travail : créer **`membres-redesign`** depuis `superadmin-v2` (propre). ⚠️ Vérifier `git branch --show-current` avant chaque commit (l'utilisateur change parfois de branche en parallèle).

## Lot 0 — Docs (convention repo)

Écrire et committer `docs/superpowers/specs/2026-07-08-membres-redesign-design.md` (design validé) et `docs/superpowers/plans/2026-07-08-membres-redesign.md` (ce plan).

## Lot 1 — Backend : enrichir `ClubService.listMembers` (TDD)

**Fichier : `backend/src/services/club.service.ts:385-405`** (2 requêtes aujourd'hui → 7 à plat, indépendant du nombre de membres). Route `GET /api/clubs/:clubId/admin/members` (garde STAFF, `admin.ts:324`) **inchangée**.

Champs additifs sur le DTO :
- `avatarUrl` — élargir le select `user` (coût zéro) ;
- `hasActiveSubscription` + `subscriptionPlan` — 1 requête `subscription.findMany({ where: { clubId, status: 'ACTIVE', expiresAt: { gt: now } }, select: { userId, plan: { select: { name } } } })` (prédicat miroir de `subscription.service.ts:162`) ; plusieurs abos actifs → premier nom ;
- `hasActivePackage` — 1 requête `memberPackage.findMany({ where: { clubId }, select: { userId, creditsRemaining, amountRemaining, expiresAt } })` + logique `isUsable` copiée de `memberStats.service.ts:210-219` ;
- `level` — `ratingService.getLevelsForUsers(userIds, LEVEL_SPORT_KEY)` (2 requêtes, clé fixe `'padel'` de `rating/level.ts:44`, **jamais** de sport préféré par user = N+1) avec `.catch(() => ({}))` (précédent `memberStats.service.ts:231`) ;
- `lastSeenAt` — 1 `$queryRaw` UNION (dernière résa CONFIRMED **passée**, organisateur OU participant), skippé si `userIds.length === 0` :

```sql
SELECT t."user_id" AS "userId", MAX(t."start_time") AS "lastSeenAt"
FROM (
  SELECT r."user_id", r."start_time" FROM "reservations" r
  JOIN "resources" rs ON rs."id" = r."resource_id"
  WHERE rs."club_id" = ${clubId} AND r."status" = 'CONFIRMED'
    AND r."start_time" <= ${now} AND r."user_id" IS NOT NULL
  UNION ALL
  SELECT rp."user_id", r."start_time" FROM "reservation_participants" rp
  JOIN "reservations" r ON r."id" = rp."reservation_id"
  JOIN "resources" rs ON rs."id" = r."resource_id"
  WHERE rs."club_id" = ${clubId} AND r."status" = 'CONFIRMED' AND r."start_time" <= ${now}
) t GROUP BY t."user_id"
```
(noms de tables/colonnes vérifiés dans schema.prisma : `reservations` @750, `reservation_participants` @773, `resources` @441 ; `user_id` nullable sur reservations @718 d'où le `IS NOT NULL`). Alias entre guillemets sinon pg renvoie du lowercase ; les dates sont des `Date` → `.toISOString()` dans le DTO.

**Décision** : filtrer les comptes supprimés RGPD — `where: { clubId, user: { deletedAt: null } }` (les lignes anonymisées « Joueur supprimé » polluent KPI/CSV et sont inertes).

**Tests d'abord — `backend/src/services/__tests__/club.service.test.ts` (describe listMembers, ~888)** : `prismaMock` est `mockDeep` reset à chaque test → ajouter les mocks par défaut dans le `beforeEach` (subscription.findMany, memberPackage.findMany, sport.findUnique, playerRating.findMany, `$queryRaw` → `[]`, précédent `event.service.test.ts:26`) **avant** de toucher le service, sinon le test existant crashe. Cas : mapping abo/plan, isUsable (valide/expiré/vide), niveau (+ assert `sport.findUnique` appelé avec `key: 'padel'`), sport absent → pas de throw, lastSeenAt ISO + null, avatarUrl, filtre deletedAt, pas de N+1 (chaque requête appelée 1 fois pour 2 membres).

## Lot 2 — Frontend : type + helpers purs (TDD)

**`frontend/lib/api.ts:1217`** — champs optionnels sur `Member` : `avatarUrl?`, `level?: UserLevel | null`, `hasActiveSubscription?`, `subscriptionPlan?`, `hasActivePackage?`, `lastSeenAt?` (tout optionnel → fixtures existantes compilent).

**Nouveau `frontend/lib/members.ts`** (+ tests `frontend/__tests__/members.test.ts`) — purs, sans DOM ni `new Date()` :
- `norm()` déplacé depuis page.tsx (recherche multi-termes ET, insensible aux accents — conservée) ;
- `MemberSeg = 'all'|'subs'|'staff'|'watch'|'blocked'`, `filterMembers(ms, q, seg)`, `segCounts(ms)` (compteurs calculés sur l'ensemble filtré par la recherche) ;
- `MemberSort = 'name'|'recent'|'activity'`, `sortMembers` (`localeCompare 'fr'` ; `recent` = `since` desc ; `activity` = `lastSeenAt` desc, null en dernier) ;
- `daysSince(iso, nowMs)`, `memberKpis(ms, nowMs)` → `{ total, subscribers, activeRecent (<30 j), blocked }` ;
- `membersCsv(ms, nowMs)` — BOM `﻿`, séparateur `;`, CRLF, échappement guillemets, booléens Oui/Non, dates JJ/MM/AAAA, en-têtes : Prénom;Nom;Email;Téléphone;N° adhérent;Abonné;Formule;Carnet actif;Statut;Rôle;Niveau;Dernière venue;Membre depuis;À surveiller;Note.

## Lot 3 — Frontend : composants + réécriture de la page

**Nouveau dossier `frontend/components/admin/members/`** (3 composants ; KPI et toolbar restent inline dans la page) :

- **`MemberRow.tsx`** `{ m, selected, nowMs, onOpen, onNavigate }` — carte-rangée (`th.surface` + inset line, anneau accent si sélectionnée, `.pl-lift`), `role="button"` « Ouvrir la fiche de X » → panneau. `Avatar` (photo ou initiales `colorForSeed(m.userId)`), **le nom reste un `role="link"` « Voir le passif de X »** (stopPropagation → navigation fiche : préserve `AdminMembersNav.test.tsx` tel quel), chips (Gérant/Admin/Staff, 👁 `title="À surveiller"`, « Abonné · {plan} », « Carnet », « Bloqué »), sous-ligne email · tél · n°, à droite `LevelChip` + `lastVisitLabel(daysSince(lastSeenAt))` (lib/memberStats) + chevron. Bloqué = opacité 0.55.
- **`MemberPanel.tsx`** `{ member, viewer, canManageStaff, isDesktop, onSave, onToggleBlocked, onSetRole, onDelete, onClose, error }` — header identité + lien « Voir la fiche complète → » ; brouillon phone/membershipNo/note/isSubscriber (reset sur changement de `member.userId`) + « Enregistrer » ; actions Bloquer/Débloquer, « Rôle… » (réutilise `StaffRoleMenu`, ancrage fixed identique à l'actuel page.tsx:236-252, gating inchangé : OWNER/ADMIN viewer, jamais soi-même ni le OWNER), « Supprimer » (coral). Desktop : colonne sticky `flex 0 0 380px` (pattern `app/admin/encaissement/page.tsx` ~340-365) ; mobile : overlay plein écran `sp-rise` + « ‹ Retour ».
- **`AddMemberDialog.tsx`** `{ clubId, token, onClose, onAdded }` — dialog overlay (`role="dialog"`, Échap/backdrop), `Segmented` 2 onglets « Compte existant » (email → `adminAddMemberByEmail`, mapping USER_NOT_FOUND) / « Nouveau compte » (formulaire → `adminCreateMember`, **reste ouvert** pour afficher le mot de passe temporaire, wording actuel conservé).

**Réécriture `frontend/app/admin/members/page.tsx`** — conserve : flux de chargement, fetch viewer (`getMyClubs`+`getMyProfile`), `STAFF_LABEL`/`STAFF_ERRORS`, handlers de mutation (dualité d'ids inchangée : update/blocked/remove = `m.id` ; staff-role/watch = `m.userId`), `ConfirmDialog` suppression (même wording). Nouveau state : `seg`, `sort`, `selectedUserId` (survit aux reloads ; effacé si le membre disparaît), `addOpen`, `nowMs` (posé à l'arrivée des données — page client, pas de souci d'hydration), `useIsDesktop(900)`.

Layout : (1) titre + **bandeau KPI** à droite (copier `kpiStat`/`kpiSep` de `app/admin/reservations/page.tsx:282-290,349-359`) ; (2) toolbar = recherche existante (aria-label conservé) + `Pill` segments avec compteurs dans `.sp-scroll-x` + select tri + bouton « Exporter CSV » (`Icon download`, Blob + createObjectURL, pattern `comptabilite/page.tsx:55-63`, fichier `membres-{date}.csv`) + `Btn icon="plus"` « Ajouter un membre » ; (3) flex liste (grid gap 8) + panneau ; états vides et compteur « N sur M » conservés (mêmes textes).

## Lot 4 — Tests front

- `AdminMembersNav.test.tsx` : doit passer **sans modification** (lien nom + title 👁 préservés) — vérifier.
- `AdminMembersStaff.test.tsx` : adapter — ouvrir le panneau (`Ouvrir la fiche de X`) avant d'asserter « Rôle staff de X » / menuitemradio / Supprimer→erreur MEMBER_IS_STAFF ; ajouter `adminUpdateMember`/`adminSetMemberBlocked` au mock api (garder `assetUrl`). jsdom `matchMedia` → `matches: false` = les tests exercent le panneau mobile (requêtes par rôle identiques).
- Nouvelle suite `AdminMembersFilters.test.tsx` : compteurs de pills, filtre Bloqués, tri, AddMemberDialog (email + reload ; mot de passe temporaire affiché), export CSV (contenu via mock de création d'URL ou assertion sur `membersCsv`).

## Vérification

1. Backend : `node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts` puis `node node_modules/typescript/bin/tsc --noEmit` (shims .bin cassés — appeler node directement).
2. Frontend : `node node_modules/jest/bin/jest.js __tests__/members.test.ts __tests__/AdminMembersNav.test.tsx __tests__/AdminMembersStaff.test.tsx __tests__/AdminMembersFilters.test.tsx` + `tsc --noEmit`. **Pas de full-suite** (flake BookingModal connu).
3. Visuel : stack locale démarrée, puis skill **`/verify`** sur `/admin/members` — mobile + desktop, clair + sombre : KPI, compteurs, chips/niveau/« Vu il y a N j », panneau (save/bloquer/rôle/suppr), dialog d'ajout, CSV ouvert dans Excel FR.
4. Commit par lot ; PR vers `main` à la fin (API GitHub avec credential git en cache — pas de gh CLI).

## Risques

- Mocks par défaut manquants dans `club.service.test.ts` → crash `undefined.map` : les poser au Lot 1a avant de modifier le service.
- Perf gros clubs : l'UNION scanne les résas confirmées du club — acceptable (indexes existants) ; optimisation `user_id = ANY(...)` possible plus tard.
- Invariants d'accessibilité à préserver à l'identique : « Voir le passif de X », « À surveiller », « Rôle staff de X », `menuitemradio`, « Supprimer ».
- Filtre `deletedAt` : change la liste pour les clubs ayant des comptes supprimés (voulu, documenté dans la spec).

## Fichiers critiques

- `backend/src/services/club.service.ts` (+ test `__tests__/club.service.test.ts`)
- `frontend/lib/api.ts`, `frontend/lib/members.ts` (nouveau, + test)
- `frontend/app/admin/members/page.tsx` (réécriture)
- `frontend/components/admin/members/{MemberRow,MemberPanel,AddMemberDialog}.tsx` (nouveaux)
- `frontend/__tests__/{AdminMembersNav,AdminMembersStaff,AdminMembersFilters,members}.test.*`
