# Profil : région « Sport préféré » dédiée, niveau padel-only, menu de navigation

**Date :** 2026-06-23
**Périmètre :** frontend uniquement (`frontend/app/me/profile/page.tsx` + un composant de navigation)
**Statut :** validé en brainstorming, prêt pour plan d'implémentation

## Problème

Sur la page profil (`/me/profile`), trois irritants :

1. **« Sport préféré » est noyé** tout en bas de la carte « Préférences » (sous Langue / Thème / Apparaître dans les classements). On ne le trouve pas.
2. **Confusion avec le niveau par sport.** La section « Mon niveau » affiche un sélecteur PillTabs de **tous** les sports (Badminton, Squash, Tennis…), alors qu'**on ne gère le niveau que pour le padel**. Cette rangée de pastilles ressemble à « Sport préféré » → les deux se confondent.
3. **Pas de navigation intra-page.** La page est un long scroll de 6 cartes empilées, sans moyen d'aller vite à une région.

## Objectifs

- Faire de « Sport préféré » une **région dédiée**, remontée près du haut, visuellement distincte du niveau.
- Simplifier « Mon niveau » pour refléter qu'**en pratique seul le padel a un niveau**, sans fermer la porte au multi-sport.
- Ajouter un **menu collant** en haut de page pour sauter d'une région à l'autre — **sans barre de défilement horizontale en mobile**.

## Décisions de conception (validées)

### 1. Ordre des régions

Nouvel ordre des cartes (`<section>`) :

```
Identité  →  Sport préféré  →  Mon niveau · Padel  →  Informations  →  Préférences  →  Mot de passe  →  (Licence)
```

- « Sport préféré » **sort** de la carte « Préférences » et devient **sa propre carte**, placée juste après « Identité » et avant « Mon niveau ».
- « Licence » reste conditionnelle (membre actif sur un sous-domaine club).

### 2. Carte « Sport préféré » (dédiée)

- Carte autonome avec titre `cardTitle` = **« Sport préféré »**.
- Réutilise le `PillTabs` existant **inchangé** : `options = [{ value:'', label:'Aucun' }, ...sports]`, `value = profile.preferredSport?.id ?? ''`, `onChange = handlePreferredSport`, `size="sm"`.
- Une ligne d'aide courte sous les pastilles, ex. *« Met en avant ce sport dans l'app. »* (texte `textFaint`, cohérent avec les autres notes de la page).
- Aucun changement de logique métier ni d'API : `handlePreferredSport` envoie déjà `preferredSportId`.

### 3. Carte « Mon niveau » — sélecteur adaptatif (choix B)

Comportement **aujourd'hui** (mono-sport) :

- **Plus de sélecteur de sport.** La rangée `PillTabs` « Sport du niveau » est masquée.
- Le sport du niveau est **fixé au padel** (`ratingSport = 'padel'`).
- Titre dynamique : **« Mon niveau · Padel »** (capitalisation du nom du sport courant).
- Le reste est inchangé : `LevelBadge`, bouton « Réévaluer », `LevelHistoryChart` si `rating.calibrated`, `LevelSourceNote`, `LevelCalibration` si pas encore de rating.
- La section reste masquée si `club?.levelSystemEnabled === false` (comportement existant conservé).

Comportement **futur** (multi-sport), sans dette :

- Le sélecteur `PillTabs` « Sport du niveau » **réapparaît automatiquement** dès qu'il y a **plus d'un sport noté** pour l'utilisateur.
- Condition d'affichage isolée dans une variable booléenne (`showLevelSportPicker`) pour qu'il suffise de la brancher sur un futur signal « ratings multi-sport » (ex. un `GET /api/me/ratings`). **Tant que ce signal n'existe pas, la condition vaut `false`** → rendu mono-sport ci-dessus. Aucun changement backend dans ce lot.
- Conséquence : on retire l'initialisation de `ratingSport` sur `preferredSport.key` (le sport du niveau n'est plus piloté par le sport préféré — ce sont deux notions distinctes, c'est tout l'enjeu). `ratingSport` reste `'padel'` par défaut.

### 4. Menu de navigation collant (choix C : icônes + libellé court)

Un composant de navigation intra-page, rendu **sous le titre « Mon profil »**.

**Contenu & ordre** (miroir de l'ordre des régions, items conditionnels alignés sur les sections réellement rendues) :

| Région | id ancre | Icône (`Icon name`) | Libellé court |
|---|---|---|---|
| Identité | `identite` | `user` | Identité |
| Sport préféré | `sport` | *(voir note icône)* | Sport |
| Mon niveau | `niveau` | `chart` | Niveau |
| Informations | `infos` | `info` | Infos |
| Préférences | `preferences` | `settings` | Préf. |
| Mot de passe | `securite` | `lock` | Sécu. |
| Licence *(cond.)* | `licence` | `ticket` | Licence |

- **Item conditionnel** : « Niveau » n'apparaît que si la section niveau est rendue (`levelSystemEnabled !== false`) ; « Licence » que si la carte licence est rendue. Le menu est construit à partir de la **même condition** que les sections, pour éviter toute ancre morte.
- **Icône « Sport »** : aucune icône sport n'existe dans `Icon.tsx`. Ajout d'une **petite icône additive** (ex. `ball`, ballon/cercle stylisé) au set existant, dans le même style trait (24×24, stroke). À défaut, repli sur `trophy`.

**Anti-scroll horizontal (contrainte forte) :**

- Conteneur en `display:flex` **sans** `overflow-x` et **sans** `flex-wrap` : une seule ligne.
- Chaque item `flex:1 1 0; min-width:0;` → les items se partagent la largeur et rétrécissent ensemble.
- Libellé en `text-overflow` / masquable : sous un seuil étroit (≈ ≤ 360px ou via `min-width` atteint), **le libellé s'efface et seule l'icône reste** (icône centrée). Garantit l'absence de barre horizontale quel que soit le nombre d'items.
- Disposition **verticale** (icône au-dessus, libellé court en dessous), conforme au choix retenu. Icône `size≈16`, libellé `font-size≈10–11`.

**Comportement collant & ancrage :**

- `position: sticky; top: 0; z-index: 40` (sous le `ClubNav` qui est à `z-index:50`), `background: th.surface` (pas de transparence), coins arrondis cohérents avec les cartes.
- **Offset sous le `ClubNav`** : sur un sous-domaine club, `ClubNav` est lui-même `sticky top:0`. Le menu profil doit se caler **dessous**. On mesure la hauteur du header courant (ref + `ResizeObserver`, repli 0 hors club) et on l'applique au `top` du menu **et** au `scroll-margin-top` des sections. Sur l'hôte plateforme (pas de `ClubNav`), offset = 0.
- **Défilement doux au clic** : `element.scrollIntoView({ behavior: 'smooth', block: 'start' })`, l'offset étant absorbé par `scroll-margin-top` sur chaque `<section>`.
- **Scroll-spy** : `IntersectionObserver` surligne l'item de la région actuellement visible (état actif = fond `accent`, texte `onAccent` ; inactif = `surface2` / `textMute`). Un seul item actif à la fois.

## Architecture / découpage

- **Nouveau composant** `frontend/components/profile/ProfileSectionNav.tsx` :
  - Props : `items: { id: string; icon: IconName; label: string }[]` et un `headerOffsetRef`/`offset` pour le calage sous le `ClubNav`.
  - Encapsule : rendu de la barre, scroll-spy (`IntersectionObserver` sur les `id`), clic → scroll, gestion de l'offset. Testable isolément (jsdom : `IntersectionObserver` à stubber dans `jest.setup.ts` si absent).
- **`page.tsx`** : ajoute les `id` + `scroll-margin-top` sur chaque `<section>`, déplace le bloc « Sport préféré » dans sa propre carte, retire le sélecteur de sport de « Mon niveau » et rend son titre dynamique, construit la liste `items` du nav à partir des sections réellement rendues.
- **`Icon.tsx`** : ajout d'une icône `ball` (additif, non cassant).

## Hors périmètre

- Aucun changement backend (pas de nouvel endpoint ratings multi-sport ; le sélecteur multi-sport reste désactivé tant que le signal n'existe pas).
- Pas de refonte visuelle des autres cartes (Identité, Informations, Préférences, Mot de passe, Licence) au-delà de l'ajout d'`id`/`scroll-margin-top`.
- Pas de changement de l'API « Sport préféré » ni de la logique de calibration du niveau.

## Tests

- **`ProfileSectionNav`** : rend les bons items ; clic appelle le scroll vers le bon `id` ; l'item correspondant à la section intersectée passe actif (mock `IntersectionObserver`).
- **`MeProfile`** (test existant `frontend/__tests__/MeProfile.test.tsx`, à étendre) :
  - « Sport préféré » est rendu dans **sa propre section** (`aria-label="Sport préféré"`), pas dans « Préférences ».
  - La section « Mon niveau » **n'affiche pas** le sélecteur « Sport du niveau » en mono-sport, et son titre contient « Padel ».
  - Le menu de navigation liste les régions attendues (et omet « Niveau »/« Licence » quand elles ne sont pas rendues).
  - ⚠️ Le mock de `lib/api` doit continuer d'exposer `assetUrl` (cf. note CLAUDE.md).

## Critères d'acceptation

1. « Sport préféré » est une carte dédiée, juste après Identité, hors de « Préférences ».
2. « Mon niveau » s'intitule « Mon niveau · Padel » et n'affiche aucun sélecteur de sport en mono-sport.
3. Un menu collant en haut permet de sauter à chaque région, surligne la région visible, et **n'affiche jamais de barre de défilement horizontale**, même à 320px de large et avec la Licence présente.
4. Sur un sous-domaine club, le menu se cale sous le `ClubNav` sans le chevaucher.
5. Aucune régression des enregistrements existants (sport préféré, calibration, classements, etc.).
