# Noms lisibles dans les équipes de match (MatchTeams) — abréviation en étroit

**Date :** 2026-07-02
**Statut :** validé (brainstorming)

## Problème

Dans les mini-cartes d'équipe padel (`frontend/components/match/MatchTeams.tsx`), les deux
équipes sont côte à côte **même sur mobile** (décision du spec équipes du 2026-07-01, pour
éviter le scroll horizontal). Chaque colonne est donc très étroite et les noms sont tronqués
par l'ellipsis : « Adam Ber… », « Karim Be… » — on ne reconnaît plus les joueurs.

## Décision

Quand le composant est **réellement étroit**, le nom affiché devient **« Prénom N. »**
(prénom complet + initiale du nom). Quand il y a la place, le nom complet reste affiché.
La détection se fait sur la **largeur réelle du conteneur** (pas le viewport) : une carte
étroite en desktop abrège aussi, un panneau large garde les noms complets.

Options écartées :
- *Nom sur 2 lignes* (wrap) — cartes plus hautes, choix utilisateur = compacité.
- *Équipes empilées sur mobile* — contredit la décision « côte à côte même sur mobile ».
- *Abréviation partout* — perd de l'information là où la place existe.
- *Détection par viewport (`useIsDesktop`)* — mauvais proxy de la largeur réelle de la
  colonne (une carte étroite en desktop resterait tronquée).

## Comportement

- **Large** (racine ≥ seuil) : « Adam Bernard » (inchangé).
- **Étroit** (racine < seuil) : « Adam B. ».
- **Tooltip** : `title` = nom complet sur le span du nom, dans les deux modes.
- **Ellipsis conservée** en tout dernier recours (prénom très long en colonne minuscule).
- **Désambiguïsation** : si deux joueurs du match partagent le même rendu abrégé
  (« Adam B. » pour Bernard et Bonnet), l'initiale s'allonge juste ce qu'il faut pour les
  distinguer : « Adam Be. » vs « Adam Bo. ». Si prénom + nom identiques → nom complet
  (rendu identique accepté). Seuls les joueurs en collision sont allongés.
- **Initiale = 1er caractère du nom saisi**, majusculé (« de la Fuente » → « D. »),
  cohérent avec les initiales d'`Avatar`. Pour l'allongement de collision, le préfixe est
  calculé sur le nom **débarrassé des espaces** (« de la Fuente » → « De. », « Del. »),
  première lettre majusculée.
- Nom vide → prénom seul.

## Mécanisme

### Helper pur — `frontend/lib/names.ts` (nouveau)

```ts
// Rendu abrégé « Prénom N. » pour un ensemble de joueurs, avec désambiguïsation.
shortNamesById(players: { id: string; firstName: string; lastName: string }[]): Record<string, string>
```

Pur, **sans dépendance à MatchTeams** (réutilisable plus tard par `PlayerPills`).
Algorithme : rendu de base « Prénom + initiale. » pour chacun ; tant que des rendus
entrent en collision, allonger d'un caractère le préfixe de nom des seuls joueurs en
collision ; nom épuisé → nom complet.

### Détection « étroit » — dans `MatchTeams.tsx`

- `ResizeObserver` posé sur le div racine du composant ; constante nommée
  `NARROW_WIDTH = 380` (px) : en dessous, `narrow = true`.
- **`setState` uniquement au franchissement du seuil** (pas à chaque pixel de resize).
- Rendu initial = `narrow = false` (noms complets), la mesure bascule dans un effet →
  **hydration-safe**, et les tests jsdom existants (stub `ResizeObserver` neutre de
  `jest.setup.ts`) continuent de voir les noms complets.

## Périmètre

- Touche uniquement `frontend/components/match/MatchTeams.tsx` + nouveau
  `frontend/lib/names.ts`.
- **Aucun backend, aucune migration.** Les 5 surfaces appelantes (OpenMatchCard,
  BookingModal, DayPanel, MyAgendaListItem, ReservationPlayersInline) profitent du fix
  sans changement.
- **Hors périmètre v1** : `PlayerPills` (pastilles plates — le helper est prêt pour une
  itération future), `MatchResultModal`, tout changement de disposition (empilement).

## Tests

- `frontend/__tests__/names.test.ts` : helper — cas nominal, nom vide, collision simple
  (« Adam Be. »/« Adam Bo. »), collision totale (nom complet), nom composé (préfixe sans
  espaces), non-collidants restés à 1 lettre.
- `frontend/__tests__/MatchTeams.test.tsx` : un cas qui surcharge `global.ResizeObserver`
  localement pour piloter la largeur → « Adam B. » en étroit, nom complet en large ;
  `title` = nom complet ; tests existants inchangés (stub neutre → noms complets).
