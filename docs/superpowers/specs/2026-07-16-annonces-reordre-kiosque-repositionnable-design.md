# Annonces réordonnables + kiosque « À la une » repositionnable — Design

**Date :** 2026-07-16
**Statut :** spec validée (design approuvé, plan non rédigé)

## Contexte & motivation

Deux surfaces admin liées aux annonces manquent de souplesse et de finition visuelle :

1. **Page « Annonces »** (`/admin/announcements`) : les annonces n'ont **aucun ordre manuel**. Elles sont triées `pinned desc, createdAt desc` (épinglées d'abord, puis les plus récentes). Impossible de choisir l'ordre d'affichage sur le Club-house. La page est aussi datée : gros formulaire toujours ouvert en haut + liste plate en dessous.
2. **Page « Page club »** (`/admin/club`) → carte « Sections du Club-house » : le kiosque « À la une » (les annonces) est **verrouillé en tête de page** (« toujours en tête de page »), seule section non déplaçable. Un club voudrait pouvoir le repositionner comme les autres sections.

Objectif : **glisser-déposer** sur les deux surfaces + **refonte graphique** des deux pages, dans le style maison récent (cartes à ombre douce, chips, brume bleue pour les « moments »).

## Décisions de conception

- **Ordre manuel roi** (sujet 1) : ce qu'on range par glisser-déposer devient l'ordre affiché partout (page Annonces **et** kiosque Club-house). **« Épinglée » ne trie plus** — elle devient une **mise en avant visuelle** (badge ★ côté admin ; la colonne `pinned` reste, éditable).
- **Kiosque = section comme les autres** (sujet 2) : il rejoint la liste des sections réordonnables, avec sa poignée, ses flèches ↑↓ et son **interrupteur « Afficher »**. Par défaut : **affiché, en tête** (identique à aujourd'hui). Nouvelle clé de section **`kiosk`** (nom neuf, pour ne pas ressusciter d'anciennes configs contenant les clés `announcements`/`posters` retirées en juillet 2026).
- **Nouvelle annonce en tête** de liste par défaut (`sortOrder = min − 1`) → le comportement « plus récent d'abord » est conservé tant que le club ne range rien.
- **Directions visuelles retenues** (validées en companion visuel) : page Annonces = **B** (liste épurée + « studio » en fenêtre avec aperçu direct) ; carte Sections = **A** (rangées polies, identité par section, kiosque ★ en tête avec son réglage de défilement replié dessous).
- **Hors périmètre (reporté)** : refonte de l'upload/affichage des photos de la galerie de la page club (« oublie les images pour l'instant »). La page club ne change que sur la carte Sections + harmonisation légère.

## Sujet 1 — Page Annonces : glisser-déposer + studio

### Modèle de données
- Migration **additive** : `Announcement.sortOrder Int @default(0) @map("sort_order")`.
  - Application : dossier de migration horodaté + SQL `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;` — **dev** via `prisma db execute` (dérive de base connue), **prod** via `migrate deploy`.
  - Backfill implicite : toutes les annonces existantes à `sortOrder = 0` ; le tri secondaire `createdAt desc` préserve l'ordre actuel (plus récentes d'abord) jusqu'au premier réordonnancement.

### Backend (`announcement.service.ts` + `routes/admin.ts`)
- **Tri** de `listPublic` et `listAdmin` : `orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }]` (on **retire** `pinned: 'desc'`).
- **`create`** : calcule `sortOrder = (min sortOrder du club) − 1` (0 si aucune annonce) → la nouvelle annonce apparaît en tête.
- **Nouvelle méthode `reorder(clubId, orderedIds: string[])`** : dans une transaction, réécrit `sortOrder = index` pour chaque id appartenant au club (ids étrangers/inconnus ignorés) ; renvoie la liste réordonnée (`listAdmin`).
- **Nouvelle route** `PATCH /api/clubs/:clubId/admin/announcements/reorder`, body `{ orderedIds: string[] }`, gate `requireClubMember('STAFF')` cohérent avec les autres routes `/announcements` (à confirmer : elles sont montées derrière la garde existante du routeur admin).
- `pinned` conservé (éditable, exposé) mais **ne participe plus au tri** ; il alimente le badge ★ côté admin. Le kiosque n'a pas de rendu spécial « épinglé » à ajouter.

### Frontend
- **`lib/api.ts`** : `Announcement.sortOrder: number` ; méthode `adminReorderAnnouncements(clubId, orderedIds, token)`.
- **`kiosqueSlides`** (`lib/clubhouse.ts`) : inchangé (garde l'ordre de l'API) ; commentaire mis à jour (« ordre manuel de l'admin » au lieu de « épinglées d'abord »). `AnnouncementKiosk` rend déjà `slides` tel quel (aucun re-tri interne — vérifié).
- **Page `/admin/announcements` réécrite (Direction B)** :
  - **Liste déplaçable** : glisser natif HTML5 (pattern `ClubHouseSectionsCard` : état `dragKey`, `onDragOver`→`preventDefault`, `onDrop`→réordonne puis persiste) + **flèches ↑↓** (mobile/accessibilité, comme les sections et les photos). Persistance **optimiste** (maj locale immédiate, `reorder` en tâche de fond, rechargement serveur si échec).
  - **Cartes riches** : poignée ⠿, vignette d'affiche (ou tuile de repli), titre, chips type (`INFO/OFFER/TOURNAMENT/EVENT`) + statut (Publiée/Brouillon), **badge ★ « À la une »** si `pinned`, actions Modifier / Supprimer.
  - **Bouton « + Nouvelle annonce »** ouvrant une **fenêtre studio** `components/admin/AnnouncementStudio.tsx` (extraction du formulaire actuel : titre, contenu, type, valable jusqu'au, lien, affiche, épinglée, publiée) avec **aperçu en direct** façon `OfferStudio` (colonne aperçu sur `HERO_GRADIENT`/`HERO_INK`, rendu type-kiosque : affiche + titre + chip). Édition = même fenêtre pré-remplie.
  - La logique existante (upload d'image en 2 temps après création, gestion `removeImage`, mapping d'erreurs) est déplacée dans le studio, **inchangée fonctionnellement**.

## Sujet 2 — Page club : kiosque section + refonte carte Sections (Direction A)

### Backend — **aucune migration** (`clubHouseSections` est du JSON)
- **`club.service.ts`** : `CLUB_HOUSE_SECTION_KEYS` passe à **7 clés** avec `kiosk`. Règle de complétion de `normalizeClubHouseSections` : si `kiosk` est **absent** d'une config fournie, il est **ajouté en tête** (les clubs déjà personnalisés gardent le kiosque en haut) ; les autres clés manquantes restent complétées **en fin** (visibles). La config stockée reste toujours complète.

### Frontend
- **`lib/clubhouse.ts`** :
  - `ClubHouseSectionKey` gagne `'kiosk'` ; `SECTION_KEYS` → 7 clés ; `SECTION_DEFS` gagne l'entrée `{ key: 'kiosk', label: 'À la une', hint: 'Vos annonces (kiosque) · défilement réglable' }`.
  - `MEMBER_ORDER` et `VISITOR_ORDER` : `kiosk` **préfixé** en tête.
  - `resolveSections` / `fullSectionSettings` : quand `kiosk` manque d'une config stockée, il est **inséré en tête** (les autres clés manquantes restent ajoutées en fin) — miroir exact du backend.
- **`ClubHouse.tsx`** :
  - Le `<AnnouncementKiosk>` codé en dur en haut est retiré ; il devient `sections.kiosk = <AnnouncementKiosk … />` (toujours truthy → se rend même sans annonce, via son repli « brume bleue »).
  - Rendu **à sa position** dans `order`, **hors `wrap()`** (comme `sponsors`, car le kiosque gère son propre bord) : `order.map((k) => (k === 'sponsors' || k === 'kiosk') ? sections[k] : wrap(k, sections[k]))`.
  - Masqué quand la section `kiosk` est désactivée (absent de `order`). Les annonces continuent d'être fetchées (peu coûteux, `slides` sert aussi à l'état `empty`).
  - Point d'attention : espacement vertical cohérent quand le kiosque n'est **pas** en première position (petit margin-top à prévoir).
- **`ClubHouseSectionsCard.tsx` refonte (Direction A)** :
  - Rangées polies : tuile d'icône colorée par section (accent cyclé), **interrupteurs** (style switch) au lieu des cases brutes, poignée ⠿ + flèches ↑↓ conservées.
  - **Rangée kiosque ★** : identité distincte (accent + marqueur ★), et le réglage **« Défilement des annonces »** (curseur 3–20 s + case « Pas de défilement automatique », logique `clubHouseKioskSeconds` inchangée) **replié sous cette rangée** au lieu du gros bloc séparé actuel. Le bloc n'est pertinent que si le kiosque est visible (grisé/replié sinon).
  - `fullSectionSettings` renvoyant désormais 7 entrées, la liste éditée inclut le kiosque automatiquement.

## Tests

**Backend**
- `announcement.service.test.ts` : `reorder` écrit `sortOrder = index` et ignore les ids étrangers ; `listAdmin`/`listPublic` triés par `sortOrder asc` ; `create` place en tête (`min − 1`) ; `pinned` ne modifie plus l'ordre.
- Route : `PATCH …/announcements/reorder` (200, ordre appliqué, ids étrangers ignorés).
- `club.service.test.ts` : `normalizeClubHouseSections` gère 7 clés ; `kiosk` absent → **complété en tête** ; clés inconnues toujours rejetées.

**Frontend**
- `clubhouse.test.ts` : `SECTION_KEYS` = 7 clés ; `resolveSections`/`fullSectionSettings` préfixent `kiosk` quand il manque ; `kiosqueSlides` inchangé.
- `AdminAnnouncements.test.tsx` : glisser-déposer / ↑↓ appellent `adminReorderAnnouncements` ; ouverture du studio ; rendu des cartes (badge ★).
- `AnnouncementStudio.test.tsx` : formulaire + aperçu en direct + upload d'image (chemin inchangé).
- `ClubHouse.test.tsx` : kiosque rendu **à sa position** (défaut : en tête) ; **masqué** quand la section `kiosk` est désactivée ; ordre custom respecté.
- `ClubHouseSectionsCard` / `AdminClub.test.tsx` : rangée kiosque présente avec ★ + réglage de défilement replié ; interrupteur ; réordonnancement.

## Hors périmètre (reporté / non fait)
- Refonte de l'upload/affichage des **photos** de la galerie de la page club.
- Rendu spécial « épinglé » sur le **kiosque public** (pinned reste un simple badge admin).
- Réordonnancement serveur paginé (le nombre d'annonces par club reste petit).
- Toute autre polish de la page club hors carte Sections (harmonisation légère seulement).
