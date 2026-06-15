# Bouton « Publier » pour les sports (superadmin) — Design

**Date :** 2026-06-15
**Contexte :** Le catalogue des sports superadmin (`/superadmin/sports`, spec `2026-06-14-superadmin-sports-catalog-design.md`) permet de créer/modifier/supprimer des sports (durées + surfaces). Aujourd'hui **tous** les sports du catalogue sont immédiatement visibles et activables par **tous** les clubs (via `GET /api/sports`). On veut un cycle **brouillon → publié** : préparer un sport sans qu'il soit offert aux clubs, puis le **publier** quand il est prêt.

## Objectif

Donner au superadmin le contrôle de la disponibilité d'un sport aux clubs via un état `published`, exposé par un bouton **« Publier » / « Dépublier »** sur chaque sport.

## Décisions produit

- **Représentation** : un booléen `Sport.published` (2 états suffisent ; pas d'enum `status`).
- **Création** : un nouveau sport est créé **en brouillon** (`published = false`). Le superadmin le configure puis clique « Publier ».
- **Sports existants** : restent **publiés** (backfill `true` à la migration) — aucun club existant n'est impacté.
- **Ce que « publié » contrôle** : seuls les sports **publiés** sont proposés aux clubs (activation d'un sport, annuaire public, création de club). Un brouillon n'apparaît nulle part côté club/public.
- **Dépublication non destructive** : dépublier un sport **déjà activé** par des clubs **ne casse rien** — leurs `ClubSport`, courts, réservations et disponibilités continuent de fonctionner (ces chemins ne passent pas par `GET /api/sports`). La dépublication empêche seulement de **nouvelles** activations et retire le sport des listes publiques. Aucune garde « sport en cours d'utilisation » sur la dépublication (contrairement à la suppression).

## Modèle & migration

- **Schéma** : `model Sport { … published Boolean @default(false) }`.
- **Migration additive** `add_sport_published` :
  ```sql
  ALTER TABLE "sports" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;
  UPDATE "sports" SET "published" = true;
  ```
  `ADD COLUMN DEFAULT false` met les **futurs** inserts en brouillon ; `UPDATE … = true` rend les sports **existants** publiés. (Le défaut de colonne reste `false` → un `create` sans `published` = brouillon.)
- **Seed** (`seed.ts`, `seed-demo.ts`) : les sports du catalogue sont créés avec `published: true`.

## Backend

### Filtrage public (gate clubs)
- `backend/src/routes/sports.ts` — `GET /api/sports` ajoute `where: { published: true }` et `published: true` au `select`. **Consommateurs concernés** (tous doivent ne voir que les publiés) : `/admin/sports` (activation), `ClubDirectory` (filtre annuaire), `clubs/new` (création de club).

### Liste superadmin (voit tout)
- Nouvel endpoint **`GET /api/platform/sports`** (déjà derrière `authMiddleware` + `requireSuperAdmin`) → renvoie **tous** les sports (publiés + brouillons), triés par nom, avec le champ `published`. Implémenté via `SportCatalogService.listSports()` (findMany sans filtre, mêmes champs que le public + `published`).

### Bascule publier/dépublier
- `SportCatalogService.updateSport` accepte désormais `published` : `if (input.published !== undefined) data.published = Boolean(input.published);`. Aucune autre validation (pas de pré-requis de publication au-delà de ce que create/update imposent déjà — nom + ≥1 durée).
- La route existante `PATCH /api/platform/sports/:id` couvre la bascule (corps `{ published: true|false }`). Pas de route dédiée `/publish`.

## Frontend

- **Type** : `Sport` (dans `lib/api.ts`) gagne `published: boolean`. Le public et le superadmin renvoient tous deux ce champ.
- **API client** : la page superadmin passe de `api.getSports()` à un nouveau **`api.platformListSports(token)`** (`GET /api/platform/sports`). Nouveau helper **`api.platformSetSportPublished(id, published, token)`** → `PATCH /api/platform/sports/:id` avec `{ published }`.
- **Page `/superadmin/sports`** :
  - Chargement via `platformListSports` (token requis ; la page est déjà sous le garde superadmin).
  - Sur chaque carte sport : **badge « Brouillon »** discret si `!published` ; bouton **« Publier »** (si brouillon) ou **« Dépublier »** (si publié), à côté de Modifier/Suppr., qui appelle `platformSetSportPublished` puis recharge la liste. État `busy` réutilisé.

## Tests

- **Backend**
  - `GET /api/sports` ne renvoie **que** les sports publiés (un brouillon est absent).
  - `GET /api/platform/sports` renvoie **tous** les sports (publié + brouillon) ; 401/403 sans super-admin.
  - `PATCH /api/platform/sports/:id` avec `{ published: true }` → met `published=true` ; `{ published: false }` → `false`.
  - Création (`POST`) → le sport créé a `published=false` (brouillon).
- **Frontend** (`SuperAdminSportsPage` / mocks `lib/api`) : un sport brouillon affiche le badge « Brouillon » + bouton « Publier » ; un publié affiche « Dépublier » ; le clic appelle `platformSetSportPublished` avec le bon argument.

## Hors périmètre

- Enum de statut multi-états, planification de publication, historique. Workflow d'approbation. Notification aux clubs à la publication.

## Couverture

- Champ `published` + migration backfill + seed → Modèle & migration.
- Gate clubs (filtre `GET /api/sports`) → Backend / Filtrage public.
- Superadmin voit tout (`GET /api/platform/sports`) → Backend / Liste superadmin.
- Bascule (`PATCH {published}`) + bouton/badge → Backend / Frontend.
- Création = brouillon → défaut de colonne + service.
