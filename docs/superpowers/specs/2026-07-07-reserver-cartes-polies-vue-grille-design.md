# Page Réserver — cartes polies + bascule vue grille (design)

**Date** : 2026-07-07
**Statut** : validé (brainstorm avec maquettes navigateur, options A/B/C comparées)

## Contexte et problème

La page Réserver (`frontend/components/ClubReserve.tsx`, vue « cartes par terrain ») est
fonctionnelle mais en retrait par rapport au reste de l'app redessinée :

1. **Duplication** : chaque terrain affiche une rangée d'horaires quasi identique — avec
   6-8 terrains la page devient longue et répétitive, et l'œil ne peut pas comparer.
2. **Signal heures creuses invisible** : le tarif creux (levier de lissage de la demande)
   est porté par un point orange de 5 px avec un tooltip `title`, inutilisable sur mobile.
3. **Pas d'alignement vertical** : les chips d'heures sont en `flex-wrap`, « 17h00 » n'est
   jamais au même endroit d'une carte à l'autre.
4. **Créneaux passés envahissants** : les heures barrées du matin ouvrent chaque rangée et
   poussent le contenu utile toute la journée.
5. **Aucun signal de rareté**, alors que le langage urgence (coral, jauges) existe partout
   ailleurs (club-house, events).

## Décision

**Vue « Cartes » polie par défaut + bascule vers une vue « Grille » (matrice terrains ×
heures)**, via un interrupteur ☰/⊞. Le choix est mémorisé par club. Les deux vues
consomment les mêmes données déjà chargées (`availBySport`) : la bascule est une pure
présentation client, **zéro fetch supplémentaire, zéro impact perf** (exigence user).

Périmètre : **100 % frontend** dans `ClubReserve.tsx` + nouveaux composants/helpers.
Aucune migration, aucune route, aucun changement backend.

## Design détaillé

### 1. Interrupteur de vue ☰/⊞

- Segmented compact 2 icônes (liste / grille), **aligné à droite sur la rangée du
  `SportPicker`** (« Padel +2 · changer   [☰|⊞] »). Club mono-sport (pas de rangée
  sport) : rangée dédiée alignée à droite au-dessus des sections.
- État `view: 'cards' | 'grid'`, **défaut `cards`**, persisté en localStorage
  **`palova:reserve-view:<clubId>`** (même pattern que `palova:reserve-sports:<clubId>`).
- Résolution **hydration-safe** : premier rendu = `cards`, la valeur stockée est lue dans
  un effet au montage (pas de `localStorage` dans l'initializer — le premier paint peut
  brièvement montrer les cartes chez un utilisateur « grille », accepté).
- L'interrupteur est **global à la page** : il s'applique à toutes les sections sport
  affichées. Les pills de durée par sport restent visibles et fonctionnelles dans les
  deux vues.

### 2. Vue Cartes (l'existant, poli — 5 finitions validées)

1. **Heures alignées en colonnes** : la rangée `flex-wrap` devient une grille CSS à
   colonnes de largeur fixe (`repeat(auto-fill, minmax(~78px, 1fr))`) — les cartes d'un
   même club partageant la même génération de créneaux, « 17h00 » tombe au même endroit
   sur toutes les cartes.
2. **Prix heures creuses sur le chip** : un créneau `offPeak` affiche « 14h00 · 20€ »
   (prix du slot) sur fond légèrement ambré. Le point orange de 5 px disparaît.
3. **Créneaux passés repliés** : les créneaux du jour déjà commencés sont remplacés par
   un unique chip discret « ‹ N passés » (contour fin, sans fond) ; un tap le déplie /
   replie (état local par carte, réinitialisé au changement de date). Les autres jours
   n'ont pas de passé → pas de chip.
4. **Signal de rareté** : quand il reste **1 à 3 créneaux réservables** sur la carte
   (libres, non passés, dans la fenêtre de réservation), une ligne coral
   (`ACCENTS.coral`) s'affiche sous les créneaux : « Plus que N créneaux aujourd'hui »
   (jour J) / « Plus que N créneaux ce jour-là » (autre date). Zéro créneau → rien
   (l'état vide existant suffit).
5. **Vue mémorisée par club** : cf. §1.

Inchangé : en-tête de carte (nom, chips couverture/éclairage/Single, surface, prix +
prix creux), état « Aucun créneau ce jour », opacité pendant le rechargement.

### 3. Vue Grille (matrice)

- **Par section sport** (comme les cartes) : une table par sport sélectionné, précédée
  des mêmes pills de durée.
- **Lignes** = terrains du sport (ordre actuel). **Colonnes** = union triée des
  `startTime` des slots de la section, **heures passées exclues** (pas de repli : on ne
  les affiche pas du tout).
- **Colonne 1 sticky** (nom du terrain + prix, prix creux en dessous en ambre) ; la table
  défile horizontalement dans un conteneur `.sp-scroll-x` (pattern existant), en-tête
  d'heures en mono.
- **Cellules** (~44 px min, tap target) :
  - libre → fond accent clair, cliquable → `onSlot(...)` (même `BookingModal`, mêmes
    params que le chip équivalent) ;
  - libre en heures creuses → fond ambré clair ;
  - pris / hors fenêtre → fond neutre, non cliquable ;
- **Légende** sous la table : libre · heures creuses · pris.
- Terrain sans slot à une heure donnée (durées/horaires différents) → cellule vide
  neutre non cliquable.

### 4. Ce qui ne change pas

`DateSelector`, `SportPicker`, `BookingModal` et tout son flux, le lien profond
`?resource=&start=` (ouvre la confirmation quelle que soit la vue), la rangée de quotas,
l'onglet « Terrains », les appels API (`getClubAvailability` et co), le backend.

## Architecture front

- **Helpers purs** dans un nouveau **`frontend/lib/reserveView.ts`** (testés en jest) :
  - `splitPastSlots(slots, nowMs)` → `{ past, bookable, taken }` (partition présentée) ;
  - `scarcityLabel(bookableCount, isToday)` → `string | null` (seuil ≤ 3) ;
  - `gridColumns(items, nowMs)` → union triée des `startTime` futurs d'une section ;
  - `RESERVE_VIEW_KEY(clubId)` + type `ReserveView = 'cards' | 'grid'`.
- **Composants** :
  - `components/reserve/ViewToggle.tsx` (segmented ☰/⊞, aria-pressed) ;
  - `components/reserve/SportGrid.tsx` (la table matricielle d'une section sport) ;
  - la carte terrain reste dans `ClubReserve.tsx` (ou extraite si le fichier devient
    trop gros — au choix du plan).
- `ClubReserve.tsx` : état `view` + branchement cartes/grille par section.

## Tests

- `__tests__/reserveView.test.ts` : partition passé/réservable, seuil de rareté (0, 1,
  3, 4), union des colonnes, clé localStorage.
- Tests composants : bascule ☰/⊞ (rendu grille, persistance localStorage, restauration
  au montage), chip creuse avec prix, repli/dépli des passés, ligne de rareté ≤ 3,
  cellule de grille libre → ouvre la confirmation (mock `onSlot`), cellule prise inerte.
- ⚠️ Les suites existantes `ClubReserve.{deeplink,persport,pastslots}` montent le vrai
  `ClubNav` : ne pas ajouter d'appel `api.*` non mocké ; `pastslots` devra être adaptée
  au repli (les créneaux passés ne sont plus rendus dépliés par défaut).

## Performance

Aucune requête ajoutée. Dérivations (`gridColumns`, partitions) mémoïsées via `useMemo`
sur `availBySport`. La bascule de vue ne déclenche aucun rechargement.

## Hors périmètre (plus tard si besoin)

- Rail « Quand ? » (filtre Matin / Après-midi / Soir) — combinable avec cette base.
- Refonte visuelle globale de la page (hero, éditorial) — la structure actuelle reste.
- Vue grille côté admin (le planning admin existe déjà) ; onglet « Terrains ».
- Préférence de vue côté serveur (localStorage suffit).
