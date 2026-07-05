# Club-house : sections configurables par l'admin (visibilité + ordre)

**Date** : 2026-07-05
**Statut** : validé (brainstorming)

## Objectif

Permettre aux admins de club (OWNER/ADMIN) de choisir quelles sections du Club-house
(landing page du club) sont affichées, et dans quel ordre, via une interface de
drag-and-drop dans `/admin/club`.

## Décisions de cadrage (validées)

1. **Un seul ordre pour tous** : la config s'applique aux visiteurs ET aux membres.
   Tant que l'admin n'a rien personnalisé (`config = null`), la page garde l'ordre
   adaptatif actuel (visiteur : découverte d'abord ; membre : action d'abord).
2. **Périmètre** : les 7 sections centrales sont réordonnables et masquables ; la
   rivière partenaires (`SponsorMarquee`) est masquable mais garde sa position fixe
   en queue ; le hero « À la une » reste fixe et toujours affiché.
3. **Emplacement admin** : nouvelle carte « Sections du Club-house » dans
   `/admin/club` (« Page club »), sous la galerie.
4. **Stockage** : colonne Json additive `Club.clubHouseSections` (pattern
   `bookingQuotas`/`quickPaymentMethods`).

## Modèle de données

Migration additive **`add_club_house_sections`** :

```prisma
model Club {
  // …
  clubHouseSections Json? @map("club_house_sections") // null = ordre adaptatif par défaut
}
```

Format stocké — tableau ordonné, **toujours complet** (les 8 clés) à l'écriture :

```json
[
  { "key": "matches",       "visible": true  },
  { "key": "posters",       "visible": true  },
  { "key": "agenda",        "visible": true  },
  { "key": "top",           "visible": false },
  { "key": "offers",        "visible": true  },
  { "key": "clubCard",      "visible": true  },
  { "key": "announcements", "visible": true  },
  { "key": "sponsors",      "visible": true  }
]
```

Clés valides : `matches`, `agenda`, `posters`, `top`, `offers`, `clubCard`,
`announcements`, `sponsors`. La clé `sponsors` ne porte que la visibilité (position
ignorée au rendu : la rivière reste en bas de page).

⚠️ **Application** : en DEV via `prisma db execute` du SQL additif (dérive de base
connue — jamais `db push`/`migrate dev`) ; en prod `prisma migrate deploy`.

## Backend (`club.service.ts`)

- **`normalizeClubHouseSections(input: unknown)`** (export pur, calqué sur
  `normalizeQuickPaymentMethods`) :
  - `null`/`undefined`/non-tableau → `null` (écrit `DbNull` = reset au défaut) ;
  - chaque entrée doit être `{ key, visible }` avec `key` dans la liste valide et
    `visible` booléen ; entrée invalide ou clé inconnue → rejetée ;
  - doublons dédupliqués (première occurrence gagne) ;
  - clés valides manquantes ajoutées **en fin** avec `visible: true` → la config
    stockée est toujours complète ;
  - tableau vide après nettoyage → `null`.
- **Exposition** : `clubHouseSections` ajouté aux selects de `getClubBySlug`
  (payload public — voyage dans `ClubDetail`, zéro fetch supplémentaire) et
  `getClubForAdmin`, et aux params de `updateClub` (branché sur le normalizer,
  même motif conditionnel que `bookingQuotas`).
- **Aucune nouvelle route** : le PATCH admin club existant (`adminUpdateClub`)
  transporte la config.

## Rendu Club-house (`ClubHouse.tsx` + `lib/clubhouse.ts`)

- **Helper pur `resolveSections(config, isMember)`** dans `lib/clubhouse.ts` →
  `{ order: string[], sponsorsVisible: boolean }` :
  - `config == null` → les deux ordres actuels inchangés
    (membre : `matches, agenda, posters, top, offers, clubCard, announcements` ;
    visiteur : `matches, clubCard, agenda, posters, offers, top, announcements`),
    `sponsorsVisible: true` ;
  - sinon : ordre = clés `visible: true` dans l'ordre de la config ; clé inconnue
    ignorée ; clé connue absente de la config ajoutée en fin, visible (tolérance
    aux versions : une section ajoutée après la sauvegarde de la config s'affiche) ;
  - `sponsors` toujours retiré de `order` (sa visibilité sort dans `sponsorsVisible`).
- `ClubHouse.tsx` remplace son ternaire `order` par `resolveSections(club.clubHouseSections, !!token)`
  et saute `SponsorMarquee` si `sponsorsVisible` est faux.
- **Fetchs sautés** quand la seule section consommatrice est masquée :
  `openMatches` (matches), `tournaments`/`events`/`next` (agenda), `presentation`
  (clubCard), `offers`+`hasSub` (offers), `topMonth` (top), `spons` (sponsors).
  Le fetch **annonces reste inconditionnel** (le hero en dépend). Effet assumé sur
  le pouls du hero : section matches masquée → chip « parties » absente (cohérent,
  l'ancre `#ch-matches` n'existe plus) ; agenda masqué → chip « event » absente.
- Les sections vides continuent de s'auto-masquer (inchangé) ; le calcul `empty`
  fonctionne sans modification (les états des sections masquées restent vides
  puisque leurs fetchs sont sautés).
- **Cumul avec `showOffersPublicly`** : le toggle de section masque l'affichage ;
  `Club.showOffersPublicly` (réglage existant) contrôle l'existence publique des
  données d'offres. Les deux se cumulent (section visible + API vide → rien).

## UI admin (`/admin/club`)

Nouvelle carte **« Sections du Club-house »** sous la galerie :

- Une ligne par section réordonnable : poignée grip + **drag-and-drop natif HTML5**
  (pattern exact de `/admin/courts` : `draggable`/`onDragStart`/`onDragOver`/`onDrop`,
  opacité réduite pendant le drag) + **boutons ↑↓** (mobile/accessibilité — le drag
  natif ne fonctionne pas au doigt) + **interrupteur Afficher/Masquer**.
- Libellés/descriptions FR dans une constante **`SECTION_DEFS`** de `lib/clubhouse.ts`
  (partagée admin/tests) :
  - `matches` — « Ça joue bientôt » (parties ouvertes)
  - `agenda` — « Prochains events & vos réservations »
  - `posters` — « À l'affiche » (annonces avec image)
  - `top` — « Top du mois »
  - `offers` — « Offres du club » (hint : « S'affiche aussi selon “Vendre les
    offres en ligne” dans les Réglages »)
  - `clubCard` — « Le club » (présentation)
  - `announcements` — « Annonces » (annonces sans image)
- Ligne **« Partenaires »** fixe en bas de la carte, interrupteur seul (pas de grip).
- Note : « Le bandeau “À la une” est toujours en tête de page. »
- **Persistance immédiate** à chaque geste (drop, ↑↓, toggle → `adminUpdateClub`
  avec la liste complète), état local optimiste, erreur réseau → message + reload.
- Lien **« Réinitialiser l'ordre par défaut »** → ConfirmDialog → PATCH
  `clubHouseSections: null`.
- État initial chargé via `adminGetClub` (la page charge déjà présentation/photos ;
  un appel de plus au montage).

## Types (`lib/api.ts`)

- `ClubHouseSectionKey` (union des 8 clés), `ClubHouseSectionSetting = { key, visible }`.
- `clubHouseSections?: ClubHouseSectionSetting[] | null` additif sur `ClubDetail`
  et sur le type club admin + `UpdateClubBody`.

## Tests

- **Backend `club.service.test.ts`** : normalizer (clés inconnues rejetées,
  doublons, complétion des manquantes, non-tableau → null, tableau vide → null) ;
  `updateClub` écrit la config normalisée ; `getClubBySlug`/`getClubForAdmin`
  l'exposent.
- **Front `clubhouse.test.ts`** : `resolveSections` (null → deux ordres adaptatifs,
  ordre custom appliqué, sections masquées exclues, clé manquante ajoutée en fin,
  `sponsorsVisible`).
- **Front `AdminClub.test.tsx`** : rendu de la carte, toggle → payload PATCH complet,
  ↑↓ réordonne + PATCH, réinitialisation (ConfirmDialog + PATCH null).
- **Front suite ClubHouse** : section masquée absente du DOM ; ordre custom respecté ;
  config null → comportement actuel (cas existants inchangés).

## Hors périmètre (v1)

- Deux ordres distincts visiteur/membre.
- Aperçu live du Club-house dans l'admin.
- Configuration du hero (toujours affiché) et de sa rangée « pouls ».
- Sections conditionnées par sport.
- Drag tactile (les boutons ↑↓ couvrent le mobile).
