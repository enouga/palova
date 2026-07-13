# Rôles admin vs staff — gating du tableau de bord + explication des rôles

**Date** : 2026-07-13
**Statut** : validé par Eric (design approuvé en session)

## Problème

Le back-office `/admin` est accessible à tout `ClubMember` (OWNER / ADMIN / STAFF), mais deux
éléments du tableau de bord sont réservés aux admins **par accident** :

- `StartChecklist` (guide de démarrage) appelle `GET /admin/onboarding-status`, gardé
  `requireClubMember('ADMIN')` → un STAFF reçoit 403, le composant avale l'erreur et ne rend rien.
- `BillingBanner` (relance abonnement Palova) appelle `GET /admin/billing`, gardé
  `requireClubMember('ADMIN')` → même 403 silencieux.

Résultat : le comportement voulu (« le staff ne voit pas ça ») existe déjà, mais sans intention —
2 appels API voués à l'échec à chaque visite du dashboard par un staff, aucun test, et l'entrée
sidebar « Abonnement Palova » reste visible pour le staff avec une page en erreur derrière.

Par ailleurs, la règle « chaque club a obligatoirement un compte admin » est déjà garantie par le
backend (création de club = compte OWNER ; `MEMBER_IS_STAFF` refuse de supprimer un membre staff ;
`CANNOT_CHANGE_OWNER`), mais elle n'est expliquée nulle part : ni à la création du club, ni en FAQ.

## Décisions de cadrage (validées)

1. **Dashboard : garder l'existant** — pas de nouvelle carte « Abonnement » permanente. La
   bannière (seulement en cas de souci) + le guide de démarrage, rendus uniquement pour
   OWNER/ADMIN. Le détail vit sur `/admin/billing`.
2. **Sidebar : masquer uniquement « Abonnement Palova » au staff.** Les autres entrées
   ADMIN-gatées (Messages, Page club…) restent visibles — à traiter plus tard si besoin.
3. **Explication à la création : `/clubs/new` + écran final du wizard d'onboarding.**
4. **FAQ : entrée dans la FAQ plateforme statique** (`PLATFORM_FAQ`), rubrique « Démarrer ».

## Design

### 1. Rôle du viewer exposé par le layout admin (aucun appel API ajouté)

`app/admin/layout.tsx` appelle déjà `api.getMyClubs(token)` pour sa garde d'accès
(`allowed = cs.some(c => c.clubId === club.id)`). On y récupère aussi le rôle :

```ts
const mine = cs.find((c) => c.clubId === club.id);
setAllowed(!!mine);
setRole(mine?.role ?? null);
```

Le rôle (`'OWNER' | 'ADMIN' | 'STAFF' | null`) est exposé via un **nouveau contexte
`AdminRoleContext`** (défini dans le même fichier que `AdminChromeContext`, hook `useAdminRole()`).
On ne surcharge pas `AdminChromeContext` (sémantique chrome/repli, signature consommée par le
Planning). Défaut du contexte : `null` → traité comme « pas admin » (sûr par défaut).

Comme la garde bloque le rendu des enfants tant que `allowed !== true`, **le rôle est toujours
résolu quand une page admin se rend** — pas d'état intermédiaire à gérer côté pages.

Helper pur **`frontend/lib/adminRole.ts`** :

```ts
export type ClubStaffRole = 'OWNER' | 'ADMIN' | 'STAFF';
export function isClubAdmin(role: ClubStaffRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}
```

### 2. Sidebar : entrée « Abonnement Palova » gatée

Dans la section « Finances » du menu, l'entrée `/admin/billing` n'est rendue que si
`isClubAdmin(role)` — même pattern conditionnel que le lien « Matchs » gaté par
`club.levelSystemEnabled`.

### 3. Tableau de bord : guide + bannière gatés

`app/admin/page.tsx` lit `useAdminRole()` et ne monte `StartChecklist` et `BillingBanner` que si
`isClubAdmin(role)`. Le staff ne déclenche plus les deux appels 403. **Les composants eux-mêmes ne
changent pas**, et le backend non plus (les gardes serveur restent la défense en profondeur).

### 4. `/clubs/new` : explication sous le bloc « Gérant »

Sous les champs du compte gérant (prénom/nom/email/mot de passe), une ligne d'info discrète
(fontUI ~12.5, `th.textMute`) :

> Ce compte sera le **compte gérant (administrateur)** de votre club : lui seul gère l'abonnement
> Palova et pilote la configuration. Vous pourrez ensuite nommer des admins et du staff depuis la
> page Membres — le staff gère le quotidien sans voir ces informations.

### 5. Wizard d'onboarding : rappel sur l'écran final festif

Dans `StepLaunch` (phase `done`), sous les CTAs « Découvrir mon club-house / Aller à l'espace de
gestion », une courte mention (style `WIZ.mute`) :

> Invitez votre équipe : nommez des admins ou du staff depuis la page Membres. Le staff gère le
> quotidien (planning, caisse) mais ne voit ni l'abonnement Palova ni ce guide.

### 6. FAQ plateforme : nouvelle entrée « Démarrer »

Dans `PLATFORM_FAQ` (`frontend/lib/platformContent.ts`), rubrique `Démarrer` :

- **Question** : « Gérant, admin, staff : qui voit quoi ? »
- **Réponse** : « Chaque club a obligatoirement un compte gérant, créé en même temps que le club
  (il ne peut pas être supprimé). Le gérant a tous les droits, dont la gestion de l'abonnement
  Palova. Il peut nommer des admins (toute la gestion du club) et du staff depuis la page Membres,
  bouton « Rôle… ». Le staff gère le quotidien (planning, caisse, réservations, membres) mais ne
  voit ni l'abonnement Palova, ni le guide de démarrage, ni les outils réservés aux admins. »

### 7. Tests

- `__tests__/adminRole.test.ts` : `isClubAdmin` (OWNER/ADMIN → true ; STAFF/null/undefined → false).
- `AdminLayout.test.tsx` : avec `getMyClubs` mocké rôle STAFF → « Abonnement Palova » absent de la
  sidebar ; rôle ADMIN (ou OWNER) → présent. (Les mocks existants renvoient déjà un `clubId`
  correspondant ; il faut y fixer le `role`.)
- Nouveau test du dashboard (`AdminDashboard.test.tsx`) : monté sous `AdminRoleContext.Provider` —
  rôle STAFF → ni guide ni bannière, `adminGetOnboardingStatus`/`adminGetBilling` **non appelés** ;
  rôle ADMIN → les deux rendus (appels effectués).
- `NewClubPage.test.tsx` : le texte d'explication du compte gérant est présent.
- `StepRulesLaunch.test.tsx` : la mention équipe est présente sur l'écran final (phase `done`).

## Hors périmètre

- Masquage des autres entrées sidebar ADMIN-gatées (Messages, Page club, niveaux membres…).
- Refactor de `/admin/members` (qui relit le rôle via `getMyClubs`+`getMyProfile`) sur le nouveau
  contexte — adoption possible plus tard.
- Toute modification backend (gardes inchangées).
- FAQ club (socle) : l'explication des rôles est B2B, elle vit dans la FAQ plateforme uniquement.

## Notes d'implémentation

- `ManagedClub.role` existe déjà dans `lib/api.ts` (`'OWNER' | 'ADMIN' | 'STAFF'`).
- 100 % frontend, aucune migration.
- ⚠️ Suites *real-mount* : rien de nouveau — aucun appel API ajouté (le layout réutilise
  `getMyClubs` déjà mocké dans `AdminLayout.test.tsx`).
