# Pages /me en pleine largeur 1080 + shell standard pour Notifications — Design

**Date :** 2026-07-15
**Contexte :** suite du chantier « largeur desktop pages joueurs 820 → 1080 » (spec `2026-07-15-largeur-desktop-pages-joueurs-design.md`, terminé). En testant, Eric a relevé que trois pages ne sont « pas à la bonne largeur comme les autres » : Mon profil (contenu clampé 760), Mes amis (contenu clampé 900) et Notifications (640, sans barre du haut). Décision d'Eric : **tout en pleine largeur 1080**, cohérence visuelle maximale — on retire les clamps internes posés pendant le chantier précédent.

## Problème

- `/me/profile` : le contenu (titre + nav de sections + cartes) est clampé à 760px centré (Task 4 de l'ancien plan). Perçu comme une anomalie de largeur.
- `/me/friends` : contenu clampé à 900px (ajout de la passe de vérif, commit `88250ed`). Même perception.
- `/me/notifications` et `/me/notifications/settings` : **exceptions historiques** — pas de `Screen`, pas de `ClubNav` (aucune barre du haut, même sur hôte club), conteneur `maxWidth: 640` codé en dur, titre h1 22px `fontUI` au lieu du display 38px standard. Construites comme de simples listes ouvertes depuis la cloche / le menu profil, jamais alignées sur le shell des autres pages `/me/*`.

## Décisions

1. **Pleine largeur partout** : le contenu des pages joueurs occupe toute la colonne `Screen` (1080 desktop), comme `/parties`, `/reserver`, `/me/messages`. Plus aucun clamp interne sur `/me/profile` ni `/me/friends`.
2. **Notifications rejoint le shell standard**, sur le modèle exact de `/me/profile` : `Screen` + double branche d'en-tête — hôte club (`slug && club`) → `<ClubNav club={club} />` ; hôte plateforme → rangée `BackButton href="/clubs"` + `ThemeToggle` + `ProfileMenu` (padding `28px 20px 6px`). Titre en display standard (`th.fontDisplay`, 500, 38px, letterSpacing −0.5, padding `18px 20px 0`). S'applique aux **deux** pages (liste + réglages).

## Changements

### 1. `frontend/app/me/profile/page.tsx`
Retirer le wrapper `<div style={{ maxWidth: 760, margin: '0 auto' }}>` et son `</div>` de fermeture (+ le commentaire « Clamp desktop »). Aucun autre changement — ClubNav, mesure `headerRef`, `ProfileSectionNav`, ancres et scroll-spy intacts.

### 2. `frontend/app/me/friends/page.tsx`
Retirer le wrapper `<div style={{ maxWidth: 900, margin: '0 auto' }}>` et sa fermeture (+ commentaire). Rien d'autre.

### 3. `frontend/app/me/notifications/page.tsx`
- Envelopper dans `<Screen>` + conteneur `paddingBottom: 48`.
- En-tête double branche (pattern `/me/profile`, sans la mesure `headerRef` — pas de nav collante interne ici) : `useClub()` pour `slug`/`club`.
- Titre « Notifications » en display 38px standard.
- Le conteneur `maxWidth: 640, margin: '0 auto', padding: 16` devient un simple `padding: '18px 20px 0'` pleine largeur.
- Logique inchangée : chargement paginé (`getNotifications` + curseur), état vide, `NotificationRow variant="page"`, marquage lu + navigation au clic, bouton « Charger plus ».
- La garde « connecté » existante (`ready && !token → /login`) reste.

### 4. `frontend/app/me/notifications/settings/page.tsx`
Même traitement de shell (Screen + double branche + titre display + pleine largeur). Le sous-titre explicatif et toute la logique (statut push, grille catégories × canaux, sauvegarde) inchangés.

## Hors périmètre

- Aucun changement backend, aucune migration, aucune route.
- Pas de refonte visuelle des lignes de notification ni de la grille de réglages — seule la coquille change.
- Pages admin/superadmin/auth : non concernées.

## Tests

- `MeProfile.test.tsx`, suites FriendsHub : doivent rester vertes sans modification (wrappers neutres retirés).
- `NotificationSettings.test.tsx` : à ajuster pour le nouveau shell. ⚠️ Piège connu des suites *real-mount* : si le test rendait la page avec un `useClub` retournant un club, la vraie `ClubNav` monterait et exigerait le mock de ses appels API (`getMyClubs`, flux SSE…). Le plus simple : mocker `useClub` en **hôte plateforme** (`slug: null, club: null`) → branche en-tête plateforme, zéro appel ClubNav. Ajouter au besoin le mock de `ProfileMenu`/`BackButton` si le rendu réel pose problème (composants légers, a priori OK).
- Pas de suite existante pour la page liste `/me/notifications` — pas de nouveau test exigé (changement de coquille pur) ; si un test est ajouté, même stratégie plateforme.

## Vérification

Visuelle (skill `verify`, CDP) sur les 4 pages : desktop 1280 (clair + sombre) + mobile 390 (`mobile:false`, largeur fixe — piège d'émulation connu), sur hôte club (`padel-arena-paris.localhost:3000`) ET hôte plateforme pour Notifications. Critères : barre du haut présente et de même largeur que les autres pages, contenu pleine colonne, aucun débordement horizontal (`scrollWidth ≤ innerWidth`).
