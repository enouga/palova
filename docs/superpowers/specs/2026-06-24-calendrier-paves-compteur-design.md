# Calendrier « Mes réservations » — pavés-compteur (lisibilité de la grille)

**Date :** 2026-06-24
**Statut :** design validé (version A)
**Périmètre :** `frontend/components/calendar/MonthCalendar.tsx` (présentation uniquement). Aucun
changement de données ni de logique : `lib/calendar.ts`, `DayPanel.tsx`, les endpoints et la page
`/me/reservations` restent inchangés.

## Problème

Sur la grille mensuelle, les marqueurs d'activité sont illisibles :

- les **réservations** sont rendues en pointillés de **5 px** entassés en bas-gauche ;
- le **compteur ne passe pas à l'échelle** : un jour à 16 réservations affiche les mêmes 3 dots
  qu'un jour à 3, plus un `+16` ténu — le nombre, l'info utile, est l'élément le moins visible ;
- les **bandeaux multi-jours** tournoi/event font **5 px** de haut, faible contraste, noyés dans la
  cellule.

## Direction retenue (A — pavés-compteur)

Le **nombre** et le **type** deviennent les signaux lisibles.

### Anatomie d'une cellule-jour (de haut en bas)

1. **Numéro du jour** en haut-gauche. Marqueur « aujourd'hui » = **pastille d'accent** discrète en
   haut-droite (remplace l'anneau `inset 0 0 0 1.5px accent` jugé lourd) ; le numéro garde la couleur
   d'accent + graisse 700 le jour même.
2. **Pavé-compteur réservations** : **un seul** pavé arrondi plein **bleu** (`ACCENTS.blue`) portant
   le nombre de réservations du jour (`3`, `16`…). Texte en `inkOn(couleur)` pour rester lisible.
   Hauteur ~16 px, `border-radius` ~7 px, padding horizontal qui laisse respirer 1 ou 2 chiffres.
   Remplace les 3 dots + `+N`. Porte `data-marker="reservation"` (contrat de test conservé).
3. **Bandeaux multi-jours tournoi/event** : conservés comme **rubans continus** (ils s'étendent sur
   plusieurs jours), mais **épaissis 5 → 7 px**, arrondis aux extrémités du séjour, empilés (tournoi
   puis event) en bas de la cellule. Sur le **jour de début**, une **petite icône** posée sur le ruban
   (`trophy` pour tournoi, `bolt` pour event) identifie le type sans dépendre que de la couleur.
   Rubans inchangés côté logique de débordement (`left/right` sur le gap, arrondis aux bouts).
   Conservent `data-marker="tournament"` / `data-marker="event"`.

### Pourquoi réservation = pavé, tournoi/event = ruban

Dans « Mes réservations », les réservations sont l'essentiel et **ponctuelles** → un compteur. Les
tournois/events sont rares et **s'étalent** sur plusieurs jours → un **ruban connecté** lit bien mieux
qu'un chiffre répété sur chaque jour. La légende explique les deux représentations.

### États

- **Sélectionné** (cellule encre `th.ink`) : le pavé garde sa couleur pleine (le bleu ressort très
  bien sur l'encre), nombre en `inkOn`. Rubans inchangés.
- **Passé** : `opacity: 0.4` sur pavé + rubans (comportement actuel conservé).
- **Hors-mois** : transparent / atténué (inchangé).

### Légende (en haut)

Mise à jour pour refléter le nouveau langage : `▣ Réservation` (petit pavé bleu) · `▬ Tournoi`
(ruban épais abricot) · `▬ Event` (ruban épais émeraude).

### Empilement vertical dans la cellule

L'ordre bas-de-cellule est conservé : rubans collés au bord bas (tournoi à 5, event à 11 quand les
deux sont présents), **pavé-compteur posé au-dessus** des rubans (offset dérivé du nombre de rubans,
comme l'actuel `dotsBottom`).

## Contraintes

- **Largeur mobile** : un seul pavé réservation par cellule → aucun débordement même à ~42 px de
  large. Rubans pleine largeur.
- **Pas de `new Date()` au rendu** (déjà respecté : la page passe `now`/`todayKey`).
- **Couleurs** via `agendaKindMeta(...)` (source de vérité, pas `th.accent` surchargeable par le club).

## Tests

`frontend/__tests__/MonthCalendar.test.tsx` : les assertions existantes sur `data-marker` restent
vraies (le pavé porte `data-marker="reservation"`, les rubans `tournament`/`event`). Ajouter un test
vérifiant que le **nombre de réservations** s'affiche sur le jour concerné (ex. texte `1` dans la
cellule du 12) et qu'un jour multi-réservations affiche bien le total.

## Hors-périmètre

- Aucun changement au `DayPanel` (cartes du jour déjà satisfaisantes).
- Pas de nouvelle donnée, endpoint, ni migration.
