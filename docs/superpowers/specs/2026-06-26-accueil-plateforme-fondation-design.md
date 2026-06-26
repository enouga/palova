# Accueil palova.fr — Fondation : landing visiteur + adaptatif + géolocalisation

> **Date :** 2026-06-26
> **Statut :** Design validé (brainstorming) — prêt pour le plan d'implémentation.

## Contexte

L'accueil de la plateforme (`palova.fr`, c.-à-d. `useClub().slug === null`) doit devenir une **page d'accueil marketing adaptative** qui change selon l'état de connexion et le rôle. Aujourd'hui :

- Un **visiteur non connecté** qui ouvre `palova.fr/` est **renvoyé vers `/login`** (`proxy.ts` : `if (!token && !isPublicPath(...)) redirectToLogin()` — `/` n'est pas dans `PUBLIC_PATHS`). Il n'y a donc **aucune vitrine publique**.
- `components/PlatformLanding.tsx` ne gère que **joueur connecté** (ses clubs + annuaire) et **gérant connecté** (boutons vers l'admin). La branche « visiteur anonyme » du plan `2026-06-07-accueil-adaptatif.md` n'a jamais été construite (le code redirige vers `/login`).
- La base n'a **aucune géolocalisation** : `Club` a un champ `city` (texte libre, nullable) et `country`. L'annuaire (`ClubDirectory` / `club.service.listClubs`) filtre par `name` / `city` (texte) / `sport`.

### Décomposition d'ensemble (le besoin complet)

La demande initiale (« organiser la page d'accueil ») se découpe en **4 chantiers livrables**, chacun avec sa spec/plan :

1. **Fondation : landing visiteur + adaptatif + couche géo** — *cette spec*.
2. **Calendrier des tournois multi-clubs** — agrégat public opt-in des tournois de tous les clubs + UI calendrier sur l'accueil.
3. **Parties ouvertes géolocalisées** — ouvrir les parties (aujourd'hui réservées aux membres d'un seul club) en cross-club « près de moi ». Réutilise la couche géo de la fondation.
4. **Mode d'emploi admin** — centre d'aide / guide accessible depuis l'accueil gérant et depuis `/admin`.

### Décisions produit validées (compagnon visuel)

- **Organisation 3 publics** sur la même URL : Visiteur (vitrine marketing) · Joueur connecté (hub de jeu) · Gérant connecté (pilotage + lien guide).
- **Parti pris de la landing visiteur : « joueur d'abord » (C)** — la page parle d'abord au grand public (recherche immédiate, émotionnel) ; le pitch clubs (B2B) vit plus bas et dans la nav.
- **Art direction : « éditorial clair » (2)** — fond clair, grande typo display, beaucoup d'air, accent discret, registre premium (Apple/Linear).
- **Enchaînement des sections validé** (cf. § Frontend).
- **Géolocalisation : version complète, dès la fondation** — lat/long via géocodage, « près de moi » (géoloc navigateur), tri par distance + filtre par région.

---

## Architecture

Trois couches, dont une seule (la géo) est de l'infrastructure neuve :

```
┌─ Front (Next.js, hôte plateforme) ──────────────────────────┐
│  app/page.tsx → PlatformLanding (dispatch)                  │
│    ├─ AnonymousView  (NEUF)  — vitrine joueur-d'abord       │
│    ├─ PlayerView     (existe) + tri « près de moi »         │
│    └─ ManagerView    (existe) + lien futur guide            │
│  ClubDirectory / ClubCard (réutilisés, enrichis distance)  │
└─────────────────────────────────────────────────────────────┘
┌─ Déverrouillage plateforme ─────────────────────────────────┐
│  authGate.ts : `/` (+ chemins hero) → PUBLIC_PATHS         │
│  proxy.ts : l'anonyme passe sur l'hôte plateforme          │
└─────────────────────────────────────────────────────────────┘
┌─ Backend ───────────────────────────────────────────────────┐
│  geo.service.ts (NEUF) — géocode une adresse via la BAN     │
│  club.service : géocode à create/update ; listClubs +geo    │
│  schema.prisma : Club +latitude/longitude/region/postalCode │
└─────────────────────────────────────────────────────────────┘
```

---

## Backend — couche géolocalisation

### Modèle de données

Migration **additive** `add_club_geolocation` sur `Club` (tous nullables — un club sans géocode reste pleinement fonctionnel) :

| Champ | Type | Rôle |
|-------|------|------|
| `latitude`  | `Float?`  | Coordonnée (tri par distance) |
| `longitude` | `Float?`  | Coordonnée |
| `region`    | `String?` | Région française (filtre « par région ») |
| `postalCode`| `String?` | Code postal (affichage + désambiguïsation) |

Pas de PostGIS : le nombre de clubs est modeste, la distance se calcule en service (haversine).

### `geo.service.ts` (nouveau)

Module isolé, **seule porte vers le géocodeur** (donc swappable sans toucher au reste).

```
geocodeAddress({ address, city?, postalCode? }) : Promise<GeoResult | null>
  → GeoResult = { latitude, longitude, region, postalCode, city }
```

- Source : **Base Adresse Nationale** — `GET https://api-adresse.data.gouv.fr/search/?q=<addr+city>&limit=1`. Gratuite, française, **sans clé API**. Réponse GeoJSON : `features[0].geometry.coordinates = [lon, lat]`, `properties.context = "75, Paris, Île-de-France"` (→ `region` = dernier segment), `properties.postcode`, `properties.city`.
- **Robuste** : timeout court (≈5 s), `try/catch` global, réponse vide / 0 feature → `null`. **Un échec ne fait jamais échouer** la création/màj du club (le club est juste sans coordonnées).
- Pas d'appel en boucle ni en transaction (réseau hors transaction).

### Intégration dans `club.service.ts`

- **À la création d'un club** et **à chaque changement d'`address`/`city`** : appeler `geocodeAddress`, persister le résultat (ou laisser null si échec). Centralisé pour couvrir les 3 points d'entrée d'écriture d'adresse :
  - création self-service (`/clubs/new`),
  - création super-admin (`PlatformService.createClub`, `POST /api/platform/clubs`),
  - mise à jour réglages (`updateClub`, `/admin/settings`).
  Le géocodage ne se déclenche **que si l'adresse change** (comparaison avant écriture) pour ne pas surcharger la BAN.
- **`listClubs(filters)`** — étendre les filtres (additif, défauts inchangés) :
  - `region?: string` → `where.region = region` (filtre par région).
  - `lat?, lng?: number` → **tri par distance croissante** (haversine en mémoire sur le jeu déjà filtré `status:ACTIVE, listedInDirectory:true`). Les clubs **sans coordonnées** passent en fin de liste. Optionnel : préfiltre bounding-box si le volume grandit (non requis en v1).
  - Sans `lat/lng` ni `region` : comportement actuel (tri par `name`) **inchangé**.
  - La projection renvoie en plus `latitude/longitude/region` pour permettre l'affichage d'une distance côté front si souhaité.

### Backfill

Script one-shot `backend/scripts/geocode-clubs.ts` : pour chaque club sans `latitude`, appeler `geocodeAddress` et écrire le résultat (idempotent, rejouable). À lancer une fois après la migration.

---

## Frontend — vue Visiteur (`AnonymousView`)

Nouvelle branche de `components/PlatformLanding.tsx` (le dispatcher existant rend déjà un squelette anti-flash tant que le rôle n'est pas résolu) :

```
!ready || (token && managed === null)  → PlatformSkeleton   (existe)
!token                                 → AnonymousView       (NEUF)
managed.length > 0                     → ManagerView         (existe)
sinon                                  → PlayerView          (existe)
```

> ⚠️ `PlatformLanding` redirige aujourd'hui `!token → /login` (ligne 25). On **retire** cette redirection : l'anonyme rend désormais `AnonymousView`.

### Sections (de haut en bas) — ambiance éditoriale claire

1. **Nav** — logo `Logotype` · liens *Jouer / Tournois / Clubs* (ancres ou pages) · `ThemeToggle` · **Connexion** (`/login`).
2. **Hero** — titre display « Trouvez un terrain, une partie, un tournoi. » + **barre de recherche** (ville/région + sport) + stats discrètes (nb joueurs / clubs) — **statiques en v1** (YAGNI ; un compteur réel pourra venir plus tard).
3. **Clubs près de chez vous** — `ClubDirectory` enrichi : bouton **« Autour de moi »** → `navigator.geolocation.getCurrentPosition` → relance `listClubs({ lat, lng })` (tri distance). **Pas de prompt automatique** ; repli = ville/région tapée. Refus de géoloc → message neutre + recherche texte.
4. **Parties ouvertes près de moi** — **emplacement** (état « Bientôt » soigné ou masqué). Rempli par le chantier 3.
5. **📅 Calendrier des tournois** — **emplacement** (idem). Rempli par le chantier 2.
6. **Bandeau « Vous gérez un club ? »** — transition B2B, CTA → `/offres`.
7. **Ce que Palova fait pour votre club** — 3 cartes fonctionnalités (Réservation & planning · Caisse & carnets · Tournois & events) + liens **« Voir les tarifs »** (`/tarifs`) et **« Créer mon club »** (`/clubs/new`).
8. **Preuve sociale** — logos / chiffres clubs (statique v1).
9. **Footer** — FAQ / Tarifs / CGV / Mentions légales / Confidentialité (pages existantes).

### Réutilisations

`ClubDirectory`, `ClubCard`, `Screen`, atoms (`Logotype`, `Btn`, `ThemeToggle`), `useTheme`, `clubUrl`, pages contenu `/offres` `/tarifs` `/faq` (`platformContent.ts`). Le bloc « pour les clubs » réutilise au maximum le contenu B2B existant.

### Adaptatif — vues existantes

- **PlayerView** : on ajoute le **« Autour de moi »** à son annuaire (même composant `ClubDirectory`). Reste sinon identique.
- **ManagerView** : inchangée, hormis un **lien vers le futur mode d'emploi** (chantier 4) — placeholder discret en v1.

---

## Déverrouillage de l'hôte plateforme

- **Comportement voulu** : sur l'**hôte plateforme uniquement**, l'anonyme accède à `/` (et aux pages marketing publiques) sans être renvoyé vers `/login`. Le comportement de l'**hôte club reste inchangé** dans ce chantier (la question « le Club-house doit-il être public ? » est hors périmètre).
- ⚠️ **`isPublicPath` est commun aux deux hôtes.** Pour éviter de rendre `/` public sur les sous-domaines club par effet de bord, la décision se prend **dans `proxy.ts`, branche hôte plateforme** (`if (!slug)`), **pas** par un ajout brut de `/` à `PUBLIC_PATHS`. Concrètement : dans cette branche, autoriser `/` (+ la petite liste de chemins marketing publics) **avant** le `redirectToLogin()`. Implémentation à pinner au plan : helper `isPlatformPublicPath(pathname)` (ou condition explicite). La purge anti-spoofing des en-têtes `x-club-*` reste.
- Vérifier que `/` anonyme rend bien `app/page.tsx` → `PlatformLanding` → `AnonymousView`.
- **Endpoints data** : `listClubs` et `getSports` sont **déjà publics** (pas d'auth). Le filtre géo n'ajoute pas d'auth.
- ⚠️ **Ne pas déverrouiller** les chemins privés (`/me/*`, `/admin/*`, etc.) ni l'hôte club : seules les portes publiques de la plateforme changent.

---

## Tests

**Backend**
- `geo.service.test.ts` : parse d'une réponse BAN type (lat/lon/region/postcode), réponse vide → `null`, exception réseau → `null` (jamais de throw).
- `club.service.test.ts` : `listClubs` avec `region` (filtre), avec `lat/lng` (ordre par distance, clubs sans coordonnées en fin), sans filtre géo (tri `name` inchangé) ; géocodage appelé à create/update **seulement si l'adresse change** (mock `geo.service`).

**Frontend**
- `AnonymousView` (dans `PlatformLanding.test.tsx`) : rendu des sections sans token ; absence de redirection `/login` ; CTA → `/login` `/clubs/new` `/offres` `/tarifs`.
- `ClubDirectory` : « Autour de moi » déclenche `listClubs({lat,lng})` ; refus de géoloc → repli texte. `navigator.geolocation` **stubé** dans `jest.setup.ts`.

---

## Hors périmètre (chantiers suivants)

- Agrégat **tournois multi-clubs** (chantier 2) — la section reste un emplacement.
- **Parties ouvertes** cross-club / géolocalisées (chantier 3) — réutilisera `geo.service` + le tri distance ; la section reste un emplacement.
- **Mode d'emploi admin** (chantier 4) — simple lien placeholder dans `ManagerView`.
- Géoloc **inverse** / autocomplétion d'adresse, multi-pays (BAN = France) — non requis.

---

## Fichiers touchés (indicatif — le plan pinnera les lignes)

**Backend**
- `prisma/schema.prisma` (champs géo sur `Club`) + migration `add_club_geolocation`.
- `src/services/geo.service.ts` (**nouveau**).
- `src/services/club.service.ts` (`listClubs` + hook géocodage create/update).
- `src/services/platform.service.ts` (géocodage à `createClub`).
- `scripts/geocode-clubs.ts` (**nouveau**, backfill).
- Routes `clubs.ts` (params `region/lat/lng` sur l'annuaire public).
- Tests : `geo.service.test.ts`, `club.service.test.ts`.

**Frontend**
- `components/PlatformLanding.tsx` (branche `AnonymousView`, retrait du redirect `/login`).
- `components/ClubDirectory.tsx` (bouton « Autour de moi », tri distance).
- `lib/api.ts` (`listClubs` accepte `region/lat/lng` ; types `ClubSummary` + champs géo).
- `proxy.ts` (branche hôte plateforme : `/` + chemins marketing publics accessibles à l'anonyme) ; éventuel helper `isPlatformPublicPath` dans `lib/authGate.ts`.
- Tests : `PlatformLanding.test.tsx`, `ClubDirectory.test.tsx`, stub géoloc `jest.setup.ts`.

---

## Vérification (manuelle)

1. Docker up + backend + frontend.
2. Migration + `npx prisma generate` + `node backend/scripts/geocode-clubs.ts` (les clubs seedés obtiennent des coordonnées).
3. `curl "http://localhost:3001/api/clubs?lat=48.86&lng=2.35"` → clubs triés par distance ; `?region=Île-de-France` → filtrés.
4. Sur l'**hôte plateforme** `localhost:3000` **sans cookie token** : `/` rend la **vitrine** (plus de redirection `/login`), hero + recherche, « Autour de moi » (avec géoloc accordée → tri distance ; refusée → repli texte), bandeau + fonctionnalités club → `/offres` `/tarifs` `/clubs/new`.
5. **Joueur** connecté : `/` rend ses clubs + annuaire avec « Autour de moi ». **Gérant** : boutons admin + lien guide (placeholder). Anti-flash conservé.
6. Non-régression : `<slug>.localhost:3000/` rend toujours le Club-house ; `/clubs` et `/reserver` inchangés ; un club sans adresse géocodable reste listé (sans distance).
