# Offres : tri par sport + couleurs sport/type distinctes (Club-house + admin)

**Date** : 2026-07-17
**Statut** : validé (palette « Pastel nature » + mise en page « sections par sport » choisies par Eric sur maquettes comparées dans le companion visuel — 3 pistes de tri/couleur, puis 2 palettes de teintes)

## Contexte et problème

Les offres (abonnements, carnets, porte-monnaie) sont déjà tagables par sport (`sportKeys: string[]`, existant côté API) mais ce tag n'est aujourd'hui qu'une ligne de texte dans les caractéristiques — aucun tri ni couleur ne s'appuie dessus. Deux surfaces affichent ces offres en cartes teintées par **type** uniquement (`offerTint(kind)` : bleu = Abonnement, abricot = Carnet, émeraude = Porte-monnaie) :

- **Club-house** (page d'accueil du club) — rail « Abonnements & offres » (`OffersShowcase.tsx`).
- **Admin** — page « Offres » (`/admin/packages`), vitrine miroir.

Sur un club multi-sport, les offres de sports différents sont mélangées sans indication visuelle, et rien ne les trie. Eric demande : trier par sport + une couleur par sport **en plus** de la couleur de type déjà en place.

## Gate mono-sport : rien ne change

Tout ce qui suit ne s'active que si `clubIsMultiSport(club)` est vrai (le club a **plus d'un** sport actif — helper déjà utilisé pour les badges sport ailleurs, `lib/sportBadge.ts`). Sur un club mono-sport (grande majorité des clubs aujourd'hui), aucune section, aucune couleur de sport, aucun changement visuel — le tri par sport n'a pas de sens quand il n'y a qu'un sport.

## 1. Palette « Pastel nature » — une couleur par sport

Nouveau dictionnaire fixe (couvre les 6 sports du catalogue plateforme, `SPORT_OPTIONS`) :

| Sport | Couleur |
|---|---|
| `padel` | Sauge `#7FAE86` |
| `tennis` | Bleu poudré `#6F9FC4` |
| `squash` | Terracotta `#D69574` |
| `badminton` | Prune poudré `#A78FC4` |
| `pickleball` | Ocre `#CDA553` |
| `pingpong` | Rose poudré `#C98FA0` |

Une offre taguée sur **exactement un** sport prend la couleur de ce sport. Une offre taguée sur **0 ou plusieurs** sports (« Tous sports ») tombe dans un compartiment neutre, couleur grise chaude dédiée `#B9B3A8` — pas de couleur inventée pour un cas ambigu, et pas de doublon d'une offre dans plusieurs sections.

Ces couleurs sont **indépendantes** des couleurs de type déjà en place (bleu/abricot/émeraude) — les deux dimensions restent lisibles simultanément sur une même carte (cf. §3).

## 2. Tri / groupement

Sur un club multi-sport, les offres sont regroupées par sport puis affichées **section par section** (petit en-tête = point coloré + nom du sport), dans l'**ordre des sports du club** (`club.clubSports`, même ordre que partout ailleurs — Réserver, SportPicker, onglet Sports). Le compartiment « Tous sports » est toujours affiché **en dernier**, section masquée s'il est vide. À l'intérieur de chaque section, l'ordre actuel est préservé (abonnements avant carnets/porte-monnaie ; actif avant retiré de la vente côté admin) — c'est un **regroupement stable**, pas un nouveau tri secondaire.

- **Club-house** : le rail unique « Abonnements & offres » se subdivise en sous-sections par sport (mini-rails horizontaux successifs sous le même `SectionHeader`).
- **Admin** : les deux kickers actuels « Abonnements » / « Carnets & Porte-monnaie » sont **remplacés** par des kickers par sport (même dictionnaire de couleurs) ; à l'intérieur d'une section sport, abonnements puis carnets/porte-monnaie s'affichent dans une même grille, dans cet ordre.

## 3. Deux couleurs par carte, pas une

Les deux composants de carte (`OffersShowcase.tsx` → `OfferCard` local, et `components/admin/offers/OfferCard.tsx`) couplent aujourd'hui une seule couleur (`tint`) à la fois pour le bandeau du haut (4 px) **et** le badge de type (« Abonnement »/« Carnet »/« Porte-monnaie »). Ce couplage est cassé : chaque carte reçoit désormais **deux** teintes indépendantes —

- **`sportTint`** → bandeau du haut de carte (4 px) + point du kicker de section. Reflète le sport.
- **`typeTint`** → badge `kindLabel`, et sur la carte Club-house le bouton « Souscrire » (bordure/texte) — inchangé dans son comportement actuel, juste renommé. Reflète le type (abonnement/carnet/porte-monnaie), calculé comme aujourd'hui via `offerTint(kind)`.

Même split dans **`OfferPreviewCard.tsx`** (aperçu joueur en direct du studio admin) : `OfferStudio.tsx` calcule `sportTint` à partir des sports cochés dans le formulaire (`sportOfferTint(sports)`, recalculé à chaque coche) en plus du `typeTint` existant — l'aperçu reste fidèle à ce qui sera réellement affiché.

## 4. Nouveaux helpers purs (`frontend/lib/adminOffers.ts`)

Colocalisés avec `offerTint` existant (déjà importé par les deux surfaces) :

- `SPORT_COLORS: Record<string, string>` — le dictionnaire du §1.
- `SPORT_COLOR_OTHER` — la couleur neutre du compartiment « Tous sports ».
- `sportOfferTint(sportKeys: string[]): string` — résout la couleur d'une offre (règle du §1 ; une clé inconnue du dictionnaire retombe aussi sur `SPORT_COLOR_OTHER`, jamais de `undefined`).
- `sportGroupLabel(key: string | null, club): string` — libellé de section (« Tous sports » si `key` est `null`, sinon le nom du sport résolu via le club comme `sportNames`/`sportBadge.ts`).
- `groupOffersBySport<T extends { sportKeys: string[] }>(items: T[], clubSports: { sport: { key: string } }[]): { key: string | null; items: T[] }[]` — partition stable (préserve l'ordre relatif à l'intérieur de chaque groupe), ordonnée sur `clubSports`, clés hors catalogue du club ajoutées après (ordre de première apparition), compartiment `null` toujours en dernier, groupes vides omis.

Aucun appel réseau, aucune migration : tout part de `sportKeys` déjà exposé par l'API (`PublicPlan`, `PublicPackageTemplate`, `SubscriptionPlan`, `PackageTemplate`).

## 5. Fichiers touchés

- `frontend/lib/adminOffers.ts` — nouveaux helpers (§4).
- `frontend/components/clubhouse/OffersShowcase.tsx` — regroupement + rendu des sous-sections, `OfferCard` local passe à `sportTint`/`typeTint`.
- `frontend/components/admin/offers/OfferCard.tsx` — `OfferCardProps.tint` → `sportTint`/`typeTint`.
- `frontend/app/admin/packages/page.tsx` — kickers par sport à la place des kickers par type ; construit la liste combinée (plans + carnets) taguée sport avant de grouper.
- `frontend/components/admin/offers/OfferPreviewCard.tsx` — `OfferPreview.tint` → `sportTint`/`typeTint`.
- `frontend/components/admin/offers/OfferStudio.tsx` — calcule les deux teintes, `sportTint` recalculé à chaque coche de sport dans le formulaire.

Aucun changement backend, aucune migration.

## 6. Tests

- `adminOffers.test.ts` — `sportOfferTint` (clé connue, clé inconnue, 0 clé, 2+ clés), `groupOffersBySport` (ordre `clubSports`, clé hors catalogue, compartiment `null` en dernier, groupes vides omis, ordre relatif préservé à l'intérieur d'un groupe).
- `OffersShowcase.test.tsx` — club multi-sport : sections par sport dans l'ordre du club + « Tous sports » en dernier si présent ; club mono-sport : rendu strictement inchangé (pas de section).
- `AdminPackages.test.tsx` — sections par sport remplacent Abonnements/Carnets ; une carte affiche un bandeau et un badge de couleurs différentes quand sport ≠ type de référence.
- Vérification visuelle CDP (skill `verify`) clair + sombre, desktop 1280 + mobile 390, club de démo passé temporairement multi-sport si besoin pour peupler plusieurs sections.

## Hors périmètre

- Réordonnancement manuel des sections par l'admin (l'ordre suit `club.clubSports`, non éditable indépendamment).
- Couleur de sport configurable par le club (palette fixe, pas de personnalisation).
- Application de cette palette ailleurs dans l'app (badges sport sur parties/tournois/events restent inchangés, cf. section « Badges sport & club » du CLAUDE.md — hors périmètre de cette évolution).
