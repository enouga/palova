# MatchTeams « mini-terrain » — refonte visuelle + feuilles d'ajout et d'actions

**Date :** 2026-07-02
**Statut :** validé (brainstorming avec maquettes navigateur — direction « mini-terrain »,
feuille d'ajout, feuille d'actions choisies par l'utilisateur)
**Complète :** `2026-07-02-matchteams-noms-abreges-design.md` (abréviation « Prénom N. »
en étroit — s'applique telle quelle aux noms rendus dans les quadrants).

## Problème

Le bloc d'équipes padel (`frontend/components/match/MatchTeams.tsx`, deux colonnes + VS)
est fonctionnel mais visuellement pauvre sur mobile : noms tronqués, icônes d'édition qui
chargent les mini-cartes, panneau d'ajout brut (label texte, barres de défilement visibles
sur la rangée « Mes amis » et le dropdown). L'utilisateur veut un rendu « pro » où **chaque
joueur est désigné à une place précise**.

## Décisions (3 briques)

### 1. Le bloc équipes devient un mini-terrain (vu de dessus)

- **Structure** : deux moitiés côte à côte (Éq.1 gauche, Éq.2 droite), **filet central en
  pointillés** avec **badge « VS » circulaire** (fond blanc/surface, bordure fine) posé
  dessus en absolu, **ligne de service** fine (1px `line`) séparant les 2 quadrants d'une
  moitié. Conteneur arrondi (~14px) à bordure fine, `overflow:hidden`.
- **Couleurs d'équipe** (inchangées) : Éq.1 = `ACCENTS.blue`, Éq.2 = `ACCENTS.coral`.
  Chaque moitié : fond en dégradé teinté léger (`${teamColor}10` → `${teamColor}26`) +
  **liseré épais 3px couleur d'équipe en haut**. Libellés « ÉQUIPE 1 / ÉQUIPE 2 » au-dessus
  du terrain (point coloré + texte uppercase, Éq.2 aligné à droite).
- **Quadrant = place précise** : badge **G/D dans le coin** (haut-gauche pour l'Éq.1,
  haut-droit pour l'Éq.2, fond teamColor + `inkOn`) — seulement en double (`half >= 2`,
  comme l'actuel `showGD`). Joueur en **colonne centrée** : avatar (couleur individuelle
  `colorForSeed`, anneau ami conservé), **nom dessous** (abrégé selon le spec noms,
  `title` = nom complet), `LevelChip`, « ORGA » le cas échéant. **Aucune icône d'action
  dans le quadrant** (terrain épuré, cf. brique 2).
- **Place vide** : cercle pointillé « + » + libellé « Ajouter », aux couleurs de l'équipe ;
  badge G/D atténué (`${teamColor}55`). Tap → ouvre la feuille d'ajout (brique 3).
- **Simple (capacité 2)** : une place par moitié, pas de badge G/D, terrain conservé.
- La logique d'emplacements **fixes et mémorisés en session** (`posRef`, G = 1er quadrant,
  D = 2e) est conservée telle quelle — le terrain ne change que la présentation.

Options écartées : colonnes premium (raffinement de l'existant), alignement avatars type
Playtomic — maquettes comparées dans le navigateur, l'utilisateur a choisi le terrain.

### 2. Édition : tap sur un joueur → feuille d'actions

- En mode `editable`, **tap sur un joueur** = il se met en **surbrillance** sur le terrain
  (outline teamColor + fond teinté) et une **feuille d'actions** s'ouvre.
- Nouveau composant **`components/match/PlayerActionSheet.tsx`**, rendu **par MatchTeams
  lui-même** (état interne « joueur sélectionné ») → toutes les surfaces en profitent sans
  câblage. Contenu : en-tête identité (avatar, **nom complet**, LevelChip, chip
  « ÉQ. X · G/D ») + actions en toutes lettres :
  - « ⇄ Passer dans l'équipe X » — même logique qu'aujourd'hui (`onMove` : place libre →
    déplacement, équipe pleine → échange avec le vis-à-vis), émise via `onSetTeams` ;
  - « 🔍 Remplacer par un autre joueur » → `onReplace(p)` ;
  - « ✕ Retirer de la partie » (teinte destructive `ACCENTS.coral`) → `onRemove(p)`.
- **Permissions inchangées** : chaque action n'apparaît que si permise (`canReplace`/
  `canRemove`, organisateur non retirable ; « Passer… » seulement si `editable` +
  `onSetTeams`). `busy` désactive tout. Fermeture : action choisie, clic overlay, Échap.
- Mobile = bottom sheet (pattern feuilles existantes) ; desktop = **dialogue centré**
  (`useIsDesktop`).
- Options écartées : rangée d'icônes visibles sous chaque joueur (charge le terrain :
  3 icônes × 4 joueurs) — maquettes comparées, feuille choisie.

### 3. Ajout / remplacement : feuille de sélection de joueur

- Nouveau composant **`components/match/AddPlayerSheet.tsx`**, rendu par les **surfaces
  parentes** (elles possèdent slug/token et la logique d'ajout). Mobile = bottom sheet,
  desktop = dialogue centré (~420px). Contenu :
  - **En-tête** : titre (« Ajouter un joueur » ou « Remplacer {Prénom N.} ») + **chip de
    destination colorée** « ÉQUIPE 2 · D » (fond `${teamColor}18`, texte foncé assorti) +
    bouton ✕ ;
  - **Champ de recherche** (autofocus, débounce comme `PartnerSearch`) ;
  - Rangée **« Mes amis »** (`FriendsQuickRow` redessinée, cf. brique 4), filtrée par la
    saisie, amis déjà dans la partie exclus ;
  - Liste **« Membres du club »** : rangées aérées (avatar, nom complet, LevelChip,
    bouton « + » teinté accent), état hover/active.
- Réutilise les **API existantes** (`api.listClubFriends`, `api.searchClubMembers`) ;
  **`PartnerSearch` n'est pas modifié** (il reste utilisé tel quel par les tournois :
  `MyRegistrationCard`, `/tournois/[id]`).
- Pendant que la feuille est ouverte, **la place visée reste en surbrillance** sur le
  terrain : prop additive présentationnelle de MatchTeams (ex. `activeTarget?: { team,
  slot }`), posée par la surface parente.
- Pour alimenter la chip « · G/D », `onAddToTeam` gagne un **2e paramètre optionnel**
  (libellé de la place tapée) — signature additive, compatible avec l'existant.

### 4. `FriendsQuickRow` redessinée (profite à toutes ses surfaces)

- Chips horizontales → **colonne d'avatars** : avatar 40px (couleur `colorForSeed`),
  **mini-chip de niveau accrochée sous l'avatar** (chevauchement), **prénom dessous**
  (ellipsis à ~52px). Tap = ajout (comportement `onPick` inchangé, `onMouseDown`
  preventDefault conservé).
- **Barre de défilement masquée** (`scrollbar-width:none` + `::-webkit-scrollbar`) avec
  **fondu sur le bord droit** (dégradé vers le fond) pour signaler le débordement.
- Le composant reste monté dans `PartnerSearch` (tournois) : il y bénéficie du même rendu.

## Branchement des surfaces

| Surface | Aujourd'hui | Après |
|---|---|---|
| `ReservationPlayersInline` (calendrier) | `PartnerSearch` inline sous le bloc (`addMode`) | `AddPlayerSheet` (add/replace, mode conservé) |
| `OpenMatchCard` (parties ouvertes) | `PartnerSearch` inline (l.166) | `AddPlayerSheet` |
| `BookingModal` (création) | `PartnerSearch` inline (l.542) | `AddPlayerSheet` (par-dessus la modale) |
| `DayPanel`, `MyAgendaListItem` (lecture) | `MatchTeams` lecture seule | terrain, zéro changement d'API |

**Props de `MatchTeams` inchangées** (ajouts optionnels seulement). **Aucun backend,
aucune migration** — la sémantique `team 1|2`, `applyTeams`, les routes et `effectiveTeams`
ne bougent pas.

## Hors périmètre

- Échange **G↔D au sein d'une même équipe** : la place G/D n'est pas persistée en base
  (présentation session via `posRef`) — inchangé, à traiter si un jour le slot est persisté.
- Drag & drop desktop, équipes tournois/events, sports non-padel (`PlayerPills` intact),
  `MatchResultModal` (garde sa propre UI), refonte de `PartnerSearch`.

## Tests

- `MatchTeams.test.tsx` : mise à jour (terrain rendu, tap joueur → feuille d'actions,
  actions filtrées par permissions, « Passer dans l'équipe » émet la même map `onSetTeams`
  qu'avant, tap « + » → `onAddToTeam(team, slot)`, badges G/D en double seulement).
- Nouveaux : `AddPlayerSheet.test.tsx` (recherche, rangée amis, pick → `onPick`,
  fermeture), rendu avatars dans `FriendsQuickRow` (via `PartnerSearch.friends.test.tsx`
  existant + cas dédiés).
- Non-régression des suites qui montent les surfaces : `BookingModal*`, `OpenMatchCard`,
  `OpenMatches`, calendrier (`MyAgendaListItem`/`DayPanel`) — ⚠️ celles qui trouvaient le
  `PartnerSearch` inline devront cibler la feuille ; les mocks `api.listClubFriends`
  restent nécessaires (cf. note CLAUDE.md).
- Garde de types : `tsc --noEmit` (jest ne type-vérifie pas).
