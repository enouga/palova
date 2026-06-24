# Image de couverture du club — design

> Statut : validé en brainstorming le 2026-06-24. Prochaine étape : plan d'implémentation.

## Problème

La carte d'un club dans l'annuaire (`/clubs`, et le même bloc réutilisé sur l'accueil
plateforme) affiche aujourd'hui un simple `<Placeholder>` (dégradé rayé + nom du club). Il
n'existe aucune image illustrant le club. On veut que **chaque club soit illustré par une
image** — soit une **photo importée** par le club, soit une **illustration générée
localement** (le « par IA », sans appel externe) — et que cette couverture apparaisse sur
**la carte d'annuaire** *et* sur **la page d'accueil du club**.

## Décisions de cadrage (issues du brainstorming)

1. **« Par IA » = illustration générée 100 % localement**, déterministe, à partir de la
   couleur d'accent + nom + sports du club. Pas d'appel à un fournisseur externe, pas de clé
   API, pas de coût, instantané. (Une vraie génération via API externe est explicitement
   **hors périmètre**.)
2. **Portée d'affichage = annuaire + page du club** (carte `ClubCard`, accueil plateforme,
   bannière en tête de Club-house).
3. **Défaut = illustration auto** : un club sans choix (`coverImageUrl = null`) affiche
   immédiatement l'illustration générée. Le `<Placeholder>` rayé actuel est **entièrement
   remplacé** par l'illustration générée comme nouveau défaut. La photo importée est une
   amélioration optionnelle.
4. **Bannière page club = couverture en fond + logo + nom superposés** (avec dégradé de
   lisibilité), choix « vitrine » assumé même si l'identité figure aussi dans `ClubNav`.

## Modèle de données (additif)

Un seul champ sur `Club` :

```prisma
coverImageUrl String? @map("cover_image_url")
```

- Migration **additive** `add_club_cover_image`.
- **`null`** → illustration générée (défaut). **valeur** (`/uploads/covers/…`) → photo importée.
- La source est **implicite** (null vs valeur) : pas d'enum à maintenir.

Lecture exposée dans :
- `ClubService.listClubs` → `ClubSummary.coverImageUrl`
- `ClubService.getClubBySlug` → `ClubDetail.coverImageUrl`
- `ClubService.getClubForAdmin` → préremplissage des réglages

Écriture via `ClubService.updateClub` (champ ajouté à `UpdateClubBody` côté front + validation
back : chaîne `/uploads/covers/…` ou `null`).

## Composant `ClubCover` + helpers purs

### `frontend/lib/clubCover.ts` (pur, testé)

Helpers déterministes, aucun `new Date()` / aléatoire :

- `coverHash(seed: string): number` — FNV‑1a (réutilise le pattern de `lib/playerColors.ts`).
- `coverGradient(seed: string, accentColor: string): { angle, from, to }` — angle (0–360) et
  2ᵉ teinte dérivés du hash, de sorte que **même slug → même dégradé** (déterminisme testable),
  mais deux clubs différents obtiennent des dégradés distincts. `from` = `accentColor`,
  `to` = teinte décalée/assombrie.
- `coverInitials(name: string): string` — 1–2 initiales en capitales.

### `frontend/components/ClubCover.tsx`

Props : `{ club: { name; slug; accentColor; coverImageUrl: string | null; sports: {icon}[] }, variant: 'card' | 'banner' }`.

- Si `coverImageUrl` → `<img src={assetUrl(coverImageUrl)!}>` en `object-fit: cover`,
  hauteur/rayon selon `variant`.
- Sinon → **illustration générée** :
  - fond = dégradé `coverGradient(slug, accentColor)`,
  - **motif de lignes de court** discret (traits faible opacité) en surcouche,
  - **emoji du sport principal** en filigrane,
  - **initiales du club** en gros (police display), filigrane.
- `variant='card'` : hauteur ~104, coins déjà gérés par la carte (radius 0, comme l'actuel
  `<Placeholder>`).
- `variant='banner'` : pleine largeur, ~160 px, **dégradé de lisibilité bas** + **logo + nom**
  superposés (cf. décision 4). Pour une photo importée, le nom/logo restent lisibles grâce au
  scrim ; pour l'illustration générée, ils complètent le visuel.

## Affichage

- **`ClubCard`** : remplace `<Placeholder label={club.name} height={104} radius={0} />` par
  `<ClubCover variant="card" club={club} />`. La pastille couleur (coin haut-droit) reste.
- **Page du club** (`app/page.tsx` → `ClubHouse`) : insérer `<ClubCover variant="banner">` en
  **tête de `ClubHouse`**, sous `ClubNav`, **au-dessus** du hero d'annonce. Pleine largeur du
  `Screen`.

## Réglage admin (« les options »)

Dans `frontend/app/admin/settings/page.tsx`, section **« Identité visuelle »**, **sous le logo**,
un bloc **« Image de couverture »** :

- **Aperçu live** via `<ClubCover variant="card">` (reflète l'état courant du formulaire).
- **« Importer une photo »** → `<input type=file>` → `api.uploadClubCover(clubId, file, token)`
  (nouvelle route, voir ci-dessous) ; au retour, `set('coverImageUrl', res.coverImageUrl)` met
  à jour l'aperçu. Persisté **immédiatement** côté serveur (comme le logo).
- **« Utiliser l'illustration automatique »** → `set('coverImageUrl', null)` ; persisté au
  prochain **Enregistrer** (champ normal de `UpdateClubBody`, cohérent avec les autres réglages).
- Légende « JPEG, PNG ou WebP · 2 Mo max ».

## Backend — upload

Route calquée sur `POST /club-logo` (dans `backend/src/routes/admin.ts`) :

- **`POST /api/clubs/:clubId/admin/club-cover`** — `multer` mémoire 2 Mo, formats `EXT_BY_MIME`
  (JPEG/PNG/WebP), écrit dans **`uploads/covers/`** (`COVERS_DIR` ajouté à
  `backend/src/utils/uploads.ts` + `ensureUploadDirs`), persiste `club.coverImageUrl =
  '/uploads/covers/<clubId>-<ts>.<ext>'`, **nettoie best-effort** l'ancienne couverture si
  elle pointait dans `uploads/covers/`. Réponse `{ coverImageUrl }`.
- Servi par l'`express.static('/uploads')` existant. **Prod** : volume `backend_uploads:/app/uploads`
  déjà monté → `covers/` couvert, rien à changer dans `docker-compose.prod.yml`.

## Tests

- **Backend**
  - `backend/src/routes/__tests__/admin.club-cover.routes.test.ts` (calqué sur
    `admin.club-logo.routes.test.ts`) : upload OK → `coverImageUrl` renvoyé + persisté ;
    format refusé (400) ; taille > 2 Mo (400).
  - Complément `club.service` : `listClubs` / `getClubBySlug` exposent `coverImageUrl`.
- **Frontend**
  - `frontend/__tests__/clubCover.test.ts` : déterminisme (`coverGradient` stable pour un même
    slug, distinct pour deux slugs), `coverInitials`.
  - Rendu `ClubCover` : `<img>` quand `coverImageUrl` est défini ; illustration générée quand
    `null`. (⚠️ les tests qui mockent `lib/api` doivent exposer `assetUrl`.)

## Hors périmètre (YAGNI)

- Génération via API IA externe (OpenAI, etc.).
- Choix parmi plusieurs variantes générées, recadrage/cropping, position du focus.
- Couverture distincte par sport ; galerie multi-images.
