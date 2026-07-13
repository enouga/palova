# Redesign des listes admin Tournois & Events — cartes enrichies, groupage par statut, liseré

**Date :** 2026-07-13
**Surfaces :** `/admin/tournaments` et `/admin/events` (quasi-jumelles).

## Problème

La liste actuelle est indigente : une ligne `catégorie · nom · STATUT` où le statut est le **texte
brut de l'énum** (`DRAFT`, `PUBLISHED`), suivie de deux boutons fantômes serrés. Aucune date, aucune
jauge de remplissage, aucun genre, aucun frais — alors que ces données sont **déjà chargées**. À côté,
les cartes joueur (`AgendaCard`) sont soignées (tuile icône teintée, pastilles, jauge). L'admin détonne.

## Direction retenue (validée en companion visuel)

**Carte enrichie (langage `AgendaCard`) + groupage par statut + liseré latéral coloré.**

### Groupage par statut

La liste est découpée en **sections ordonnées**, chacune précédée d'un point coloré et d'un compteur ;
une section vide n'est pas rendue :

| Section | Contenu | Accent (point + liseré) |
|---|---|---|
| **Brouillons** | `status = DRAFT` | apricot |
| **Publiés · à venir** | `PUBLISHED` et `(endTime ?? startTime) ≥ now` | emerald |
| **Passés** | `PUBLISHED` et `(endTime ?? startTime) < now` | faint (gris estompé) |
| **Annulés** | `status = CANCELLED` | coral |

Ordre intra-section : Brouillons & À venir par `startTime` **croissant** (le plus proche d'abord),
Passés & Annulés par `startTime` **décroissant** (le plus récent d'abord).

### Anatomie de la carte

Ligne : `[liseré 5px] [tuile icône 44px] [corps]`. Le corps empile : rangée 1 (tag catégorie/genre ou
type en capitales + pastilles à droite : **compte à rebours** coral si urgent, **Complet**), **titre**,
**date** (`formatDateShortTimeRange`, fuseau club), rangée pied (**jauge** de remplissage + `N/M
binômes|inscrits` + `K en attente` en coral + **chips** frais / CB en ligne / Membres / sport), puis
**rangée d'actions** alignée à droite. La carte est `flex-wrap` : sur mobile étroit les actions passent
sous le corps — **jamais de débordement horizontal** (préférence forte d'Eric). Surface = `th.shadow`
(ombre douce, plus l'inset border). Tuile teintée façon `AgendaCard` (floodlit `${accent}24`/icône
accent ; daylight `${accent}40`/icône encre). Passés & annulés : carte à `opacity .72`.

Tuile : **trophée / apricot** pour les tournois, **éclair (bolt) / cyan** pour les events (langage
« Compétitions » vs « Animations » du design system).

### Actions par section

- **Brouillons / Annulés** → `Publier` (bouton **plein accent**) ; events : + `Modifier`, + `Supprimer` (si 0 inscrit).
- **À venir** → `Annuler` (fantôme) ; events : + `Modifier`, + `Repasser en brouillon`.
- **Passés** → aucune action de statut (juste `Inscrits`, + `Modifier` côté events).
- `Inscrits` (fantôme) est toujours présent et ouvre le tiroir — le compte migre dans la carte, donc le bouton n'affiche plus « (N/M) ».

## Architecture (réutilisation)

Les deux pages étant jumelles, on factorise :

- **`frontend/lib/adminAgenda.ts`** — helper **pur, générique, testé** :
  `groupAdminAgenda<T>(items, now, { status, start, end })` → `AgendaGroup<T>[]` ordonnés (label +
  clé d'accent + items), sections vides omises. Classification + tri décrits ci-dessus.
- **`frontend/components/admin/AgendaAdminCard.tsx`** — carte présentational (props : `icon`, `accent`,
  `stripe`, `faded`, `tag`, `title`, `dateLabel`, `deadline`, `now`, `ratio`, `full`, `countLabel`,
  `waitlist`, `chips[]`, `actions: ReactNode`). Réutilise `deadlineCountdown`.
- **`frontend/components/admin/AgendaAdminList.tsx`** — rend les en-têtes de section (point coloré +
  label + compteur) puis mappe chaque item via une prop `renderCard`. Gère l'état vide (`emptyLabel`).

Chaque page : charge `now` via un effet (`useState<Date|null>` posé au mount — hydration-safe, on ne
rend les sections que `now` connu), construit les groupes avec le helper, et mappe ses items vers
`AgendaAdminCard` (tag/chips/actions spécifiques) dans `AgendaAdminList`.

## Retouches d'accompagnement (même langage)

- **Bannière d'erreur** : le rouge codé en dur (`#3a1d1d`/`#ff6b6b`, illisible en thème clair) devient
  une bannière **coral** dérivée du thème (fond `coral` léger + encre lisible + liseré), dans les 2 pages.
- **Conteneur de formulaire** : ombre douce `th.shadow` + petit titre de section (`Nouveau tournoi` /
  `Nouvel event` / `Modifier l'event`). Champs **inchangés** (les tests de formulaire restent verts).
- **Tiroir « Inscrits »** : cartes d'inscription en ombre douce + **pastille de statut** (`Confirmé`
  emerald / `Liste d'attente` gris) au lieu du texte capitale coloré ; actions inchangées.

## Tests

- `frontend/__tests__/adminAgenda.test.ts` — classification (draft/à-venir/passé/annulé, frontière
  `endTime ?? startTime`), tri intra-section, omission des sections vides.
- Extension `AdminTournaments.test.tsx` — un brouillon + un publié à venir + un passé se rangent sous les
  bons en-têtes ; le brouillon montre « Publier », l'à-venir « Annuler », le passé aucun des deux.
- Les suites existantes (formulaire, `Modifier` event, `requirePrepayment`) **restent vertes**.

## Hors périmètre

Filtres/recherche, pagination, tableaux de résultats (poules/scores), refonte du formulaire de saisie
lui-même, blocage de terrains. Aucune migration, aucun changement backend (toutes les données existent).
