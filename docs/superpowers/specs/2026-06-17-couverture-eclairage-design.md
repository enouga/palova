# Couverture des terrains (Intérieur / Extérieur / Semi-couvert) + Éclairage par sport

Date : 2026-06-17

## Contexte

Aujourd'hui un terrain (`Resource`) porte un attribut booléen `attributes.covered`
(true = couvert, false = découvert), affiché côté joueur via le helper
`frontend/lib/courtType.ts` (`coveredType`) sous forme de badge **Couvert / Découvert**.
Côté admin (`/admin/courts`), c'est une simple case à cocher « Couvert ».

Deux évolutions demandées :

1. Remplacer le vocabulaire **Couvert / Découvert** par **Intérieur / Extérieur**,
   et ajouter un **3e état : Semi-couvert** (il existe des terrains semi-couverts).
2. Ajouter une notion d'**éclairage** (jouer le soir), pertinente pour certains sports
   (ex. tennis). L'éclairage est **activé par sport** par le superadmin, puis cochable
   sur chaque terrain du sport concerné, et affiché aux joueurs sous forme de badge.

## Décisions (validées)

- **Couverture = 3 états** : `Intérieur` / `Extérieur` / `Semi-couvert`.
  Le booléen `attributes.covered` est remplacé par `attributes.coverage`
  = `"indoor"` | `"outdoor"` | `"semi"`.
- Libellés : 3e état nommé **« Semi-couvert »** ; colonne admin nommée **« Couverture »**.
- **Éclairage par sport** : nouveau champ `Sport.hasLighting` (booléen, défaut `false`).
  Si activé, la case « Éclairage » apparaît sur **tous** les terrains du sport
  (quelle que soit la couverture). Stocké dans `attributes.lighting` (booléen).
- Badge **« Éclairage »** affiché côté joueur (page terrain + planning), à côté de
  la couverture et de la surface.
- Les **surfaces (matériaux)** restent inchangées.

## Modèle de données

### `Resource.attributes` (JSON)

Avant : `{ "covered": true, "surface": "Résine", "format": "double" }`
Après : `{ "coverage": "indoor", "lighting": false, "surface": "Résine", "format": "double" }`

- `coverage: "indoor" | "outdoor" | "semi"` — remplace `covered`.
- `lighting?: boolean` — présent uniquement si le sport a `hasLighting=true`
  (absent/false sinon).

### `Sport`

Nouveau champ :

```prisma
hasLighting Boolean @default(false) @map("has_lighting")
```

## Migrations (Prisma, additives)

1. **`add_sport_lighting`** (schema) :
   ```sql
   ALTER TABLE "sports" ADD COLUMN "has_lighting" BOOLEAN NOT NULL DEFAULT false;
   ```

2. **`backfill_resource_coverage`** (données, sur le JSON `attributes`) :
   convertit `covered` (booléen) → `coverage` (chaîne) et retire `covered`.
   ```sql
   UPDATE "resources"
   SET "attributes" = ("attributes" - 'covered')
     || jsonb_build_object(
          'coverage',
          CASE WHEN ("attributes" ->> 'covered') = 'true' THEN 'indoor' ELSE 'outdoor' END
        )
   WHERE "attributes" ? 'covered';
   ```
   Les terrains sans clé `covered` ne sont pas modifiés ; les sites de lecture
   traitent l'absence de `coverage` comme `"outdoor"` (rétrocompat).

## Backend

- **`schema.prisma`** : ajout `Sport.hasLighting`. Le commentaire d'exemple de
  `Resource.attributes` est mis à jour (`coverage`/`lighting`).
- **`services/sport-catalog.service.ts`** : `SportInput` accepte `hasLighting?: boolean`
  (défaut false) ; `createSport` / `updateSport` le persistent. Validation simple
  (coercition booléenne).
- **`routes/sports.ts`** (GET public `/api/sports`) : ajoute `hasLighting` au `select`.
- **`routes/platform.ts`** : inchangé structurellement (passe le body au service) ;
  vérifier que `hasLighting` traverse bien.
- **`seed-demo.ts`** / **`seed.ts`** : remplacer `covered` par `coverage`
  (`indoor`/`outdoor`/`semi`) dans les attributs des terrains de démo ; activer
  `hasLighting` sur le sport tennis s'il existe (sinon laisser padel sans éclairage,
  et ajouter au moins un terrain `semi` pour la démo).

## Frontend

### Types — `frontend/lib/api.ts`

- `Sport` : `+ hasLighting: boolean`.
- `SportCatalogBody` : `+ hasLighting: boolean`.
- `Resource.attributes` et `AdminResource.attributes` :
  `{ surface?: string; format?: string; coverage?: 'indoor' | 'outdoor' | 'semi'; lighting?: boolean }`.

### Helper — `frontend/lib/courtType.ts`

- Renommer/remplacer `coveredType(covered?: boolean)` par
  `coverageType(coverage?: 'indoor' | 'outdoor' | 'semi')` renvoyant
  `{ label, icon, color }` pour 3 cas :
  - `indoor` → « Intérieur », icône `indoor`, bleu Palova `#5e93da`
  - `outdoor` → « Extérieur », icône `sun`, apricot `#ef9f6a`
  - `semi` → « Semi-couvert », icône à choisir parmi `IconName` (teinte intermédiaire,
    ex. vert/sauge ; à vérifier dans le composant Icon)
- Ajouter un petit helper/constante pour le badge **Éclairage** (label + icône ;
  icône à choisir parmi les `IconName` disponibles, ex. une ampoule/étoile/lune).

### Page joueur — `app/courts/[id]/page.tsx` & `components/ClubReserve.tsx`

- Remplacer les appels `coveredType(...covered === true)` par
  `coverageType(...coverage)` (avec fallback `outdoor` si absent).
- Ajouter le badge « Éclairage » quand `attributes.lighting === true`.

### Admin terrains — `app/admin/courts/page.tsx`

- Colonne **« Couvert »** → **« Couverture »** : la checkbox devient un `<select>`
  Intérieur / Extérieur / Semi-couvert lié à `attributes.coverage`.
  - Remplacer le helper `editCovered` par `editCoverage(id, coverage)`.
  - État `nr` : `covered: false` → `coverage: 'outdoor'`.
- Nouvelle colonne/champ **« Éclairage »** (checkbox `attributes.lighting`), affiché
  **uniquement** si le sport du terrain a `hasLighting=true`
  (même condition que pour les surfaces : via `clubSport.sport.hasLighting`).
  - Vérifier que `AdminResource.sport` expose `hasLighting` (sinon l'ajouter au
    `select` backend de la route admin des terrains).

### Superadmin catalogue — `app/superadmin/sports/page.tsx`

- Ajouter au formulaire une case **« Éclairage disponible »** liée à
  `form.hasLighting`.
- Optionnel : afficher un indicateur « Éclairage » dans la liste des sports.

## Tests (TDD)

- **Backend**
  - Migration backfill : test (ou vérif) que `covered:true → coverage:'indoor'`,
    `covered:false → coverage:'outdoor'`.
  - `sport-catalog.service` : `createSport`/`updateSport` persistent `hasLighting`
    (true/false), défaut false si omis.
  - Route GET `/api/sports` renvoie `hasLighting`.
- **Frontend**
  - `coverageType` : 3 cas + fallback `outdoor` quand `coverage` absent.
  - Badge éclairage : présent ssi `lighting === true`.
  - (le cas échéant) rendu conditionnel de la case éclairage selon `sport.hasLighting`.
- **Gate vert** back + front (tsc clean) avant push.

## Hors périmètre (YAGNI)

- Pas de couverture configurable par sport (les 3 états s'appliquent à tous les sports).
- Pas d'horaires d'éclairage / tarif spécifique éclairage.
- Pas de logique « éclairage réservé aux extérieurs » (case dispo sur tous les
  terrains du sport activé, par choix validé).

## Flux d'intégration

Conforme aux habitudes du projet : worktree hors OneDrive, implémentation TDD pilotée
par sous-agents, revue finale, FF sur `main`, push `origin/main`. **Non déployé**
(migrations additives à appliquer au boot le moment venu). Attention à l'arbre de
travail : WIP utilisateur non commité (Stripe, etc.) à ne pas embarquer.
