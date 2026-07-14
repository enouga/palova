# Partenaires — section réordonnable du Club-house

## Contexte

Le Club-house a une carte admin « Sections du Club-house » (`/admin/club`) qui permet de réordonner
et masquer les sections de la page d'accueil du club (parties ouvertes, events, top du mois, offres,
présentation du club). La section « Partenaires » (rivière de logos sponsors) en est exclue : elle
n'a qu'une case « Afficher », pas de poignée de glisser ni de flèches ↑↓, et le code la rend
**toujours en dernier**, quelle que soit la configuration.

Demande : rendre « Partenaires » réordonnable comme les autres sections.

## Constat

Le comportement actuel est intentionnel et documenté (CLAUDE.md : « sponsors visibilité seule,
position fixe en bas »), mais entièrement porté par le **frontend** :

- `frontend/lib/clubhouse.ts` : `resolveSections()` retire `sponsors` du tableau `order` réordonnable
  et le renvoie à part comme booléen `sponsorsVisible` ; `SECTION_DEFS` (liste éditable) exclut
  `sponsors`, décrit séparément par `SPONSORS_DEF`.
- `frontend/components/ClubHouse.tsx` : rend `order.map(...)` puis, après coup, rend
  inconditionnellement `<SponsorFlipDeck>` — sa position dans la page ne dépend jamais de l'ordre.
- `frontend/components/admin/ClubHouseSectionsCard.tsx` : la ligne Partenaires n'a pas de poignée de
  glisser ni de boutons ↑/↓, contrairement aux 5 autres lignes.

Le backend (`Club.clubHouseSections` JSON + `normalizeClubHouseSections` dans
`backend/src/services/club.service.ts`) traite déjà les 6 clés de façon uniforme (aucune
distinction pour `sponsors` dans le stockage). **Aucun changement backend n'est nécessaire.**

## Design

Faire de « Partenaires » une section pleinement équivalente aux autres :

1. **`frontend/lib/clubhouse.ts`**
   - Fusionner `SPONSORS_DEF` dans `SECTION_DEFS` (même liste, un seul tableau de définitions).
   - `resolveSections()` : supprimer le traitement spécial de `sponsors` — la clé participe au
     tableau `order` comme n'importe quelle autre (poussée si visible, ignorée sinon). Le retour
     perd `sponsorsVisible` (déductible de la présence dans `order`).
   - Ajuster en conséquence `hiddenSectionKeys()` (qui consommait `sponsorsVisible`) pour dériver
     la visibilité de la présence dans `order`, comme pour les autres clés.
   - Ajouter `'sponsors'` en fin des tableaux par défaut `MEMBER_ORDER` et `VISITOR_ORDER`, pour que
     l'ordre par défaut (config `null`, jamais personnalisée) reste visuellement identique à
     aujourd'hui — seule une personnalisation explicite peut la déplacer.
   - `fullSectionSettings()` : garder son comportement (retourne les 6 clés complètes), simplement
     sans distinguer `sponsors` du reste dans la boucle de complétion.

2. **`frontend/components/ClubHouse.tsx`**
   - Ajouter une entrée `sponsors` dans l'objet `sections` (celui consommé par `order.map(...)`) :
     `spons.length > 0 && <SponsorFlipDeck sponsors={spons} now={clock} />`.
   - Supprimer le rendu conditionnel séparé après la boucle (`{sponsorsVisible && <SponsorFlipDeck.../>}`).
   - `SponsorFlipDeck` gère déjà son propre padding horizontal de bord (`0 20px`) et son propre
     padding vertical (`26px 0 8px`), contrairement aux autres sections qui reçoivent un wrapper
     générique `padding:'30px 20px 0'` via la fonction `wrap()`. Pour ne pas doubler ce padding
     (40px au lieu de 20px de chaque côté), le rendu de la clé `sponsors` dans la boucle
     `order.map(...)` **contourne `wrap()`** et rend le nœud tel quel (avec sa propre `key`).

3. **`frontend/components/admin/ClubHouseSectionsCard.tsx`**
   - Supprimer le bloc JSX spécial de la ligne Partenaires (sans poignée/flèches) et le `SPONSORS_DEF`
     séparé qui l'alimentait ; la ligne Partenaires est produite par la même boucle `rows.map(...)`
     que les 5 autres (poignée de glisser + ↑/↓ + case Afficher).
   - Le hint affiché perd la mention « — toujours en bas de page » (plus vraie).
   - Simplifier `rows`/`sponsors`/`rebuild` en conséquence : les 6 clés vivent dans un seul tableau
     réordonnable ; `persist()` envoie directement la liste complète sans recomposition spéciale.

## Compatibilité

- Aucune migration, aucun changement d'API/route.
- Clubs n'ayant jamais personnalisé (`clubHouseSections: null`) : rendu identique à aujourd'hui
  (Partenaires reste visuellement en dernier par défaut).
- Clubs ayant déjà une config sauvegardée sans entrée `sponsors` explicite dans l'ordre (l'ancien
  format ne l'y mettait jamais) : à la prochaine lecture, `sponsors` est complétée en fin de liste
  par la même logique de « clé connue absente ajoutée en fin visible » qui existe déjà pour les
  autres clés — comportement inchangé pour ces clubs tant qu'ils ne réordonnent pas explicitement.

## Tests

- `frontend/__tests__/clubhouse.test.ts` : `resolveSections`/`hiddenSectionKeys`/`fullSectionSettings`
  avec `sponsors` positionné à divers endroits de l'ordre (début, milieu, fin), visible/masqué.
- `frontend/__tests__/ClubHouse.test.tsx` : la rivière de partenaires apparaît à la position
  configurée (pas seulement en dernier).
- `frontend/__tests__/AdminClub.test.tsx` (carte Sections) : la ligne Partenaires a désormais une
  poignée de glisser et des boutons ↑/↓ actifs/désactivés selon sa position, comme les autres lignes.

## Hors périmètre

- Aucun changement au kiosque « À la une » (toujours en tête de page, non concerné par cette carte).
- Aucun changement de la logique métier des partenaires (offres, expiration, etc.).
