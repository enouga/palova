# Planning admin — pastilles-initiales de paiement + panneau au survol

**Date** : 2026-07-12
**Statut** : validé (maquettes comparées dans le companion visuel — option A « pastilles-initiales » + option D « panneau au survol » retenues parmi 4 pistes)
**Périmètre** : 100 % frontend, aucune migration, aucun changement backend.

## Problème

Sur `/admin/planning`, les blocs COURT payants portent `PaymentDots` : des points anonymes
(1 point plein par paiement enregistré, `slots` = capacité du terrain, tout vert + ✓ si soldé).
L'admin voit *combien* de paiements sont passés, mais jamais *qui* a payé — il doit ouvrir la
modale d'encaissement pour le savoir. Écrire les noms en clair sur la vignette serait illisible
(colonnes ~110 px).

La donnée est pourtant déjà dans le payload du planning : `ClubReservation.participants:
ParticipantBill[]` (prénom, nom, `share`, `paid`, `outstanding` par joueur).

## Décision

Deux briques combinées, **sur le planning uniquement** :

1. **Pastilles-initiales** sur la vignette (remplacent `PaymentDots` sur cette page) —
   l'identité sans texte long.
2. **Panneau détaillé au survol** (~400 ms) — nom complet et montants par joueur.

`PaymentDots` reste tel quel sur les autres surfaces (Paiements `/admin/reservations`,
Caisse `/admin/encaissement`, `QueueList`, `CashRegister`).

## UI — pastilles sur la vignette

- **Une pastille par place** du terrain (`playerCount(format)` : 4 en double, 2 en single).
- **Participant inscrit** : cercle Ø 15 px portant ses initiales (prénom[0] + nom[0],
  majuscules, ~7,5 px, graisse 800) :
  - **part réglée** (`toCents(outstanding) <= 0`) → fond `SETTLED_COLOR` (#34b888), initiales blanches ;
  - **doit encore** → fond `th.surface`, contour 1 px `th.line`, initiales `th.textMute`.
- **Place vide** (capacité > participants) : cercle pointillé transparent (`border dashed th.line`).
- **Résa soldée au global** (`toCents(paidAmount) >= due`, règle existante de `paymentDots`) →
  **toutes** les pastilles passent vertes + ✓ à droite, même si le détail par joueur n'est pas
  ventilé (paiement global « Tout solder », paiements sans `participantId`).
- **Défensif** : le nombre de pastilles est plafonné à `places` (capacité du terrain) ;
  contrairement aux paiements (qui peuvent être plus nombreux que les places), le nombre de
  participants ne peut structurellement pas dépasser la capacité (gardes existantes à
  l'ajout/join). Pas d'indicateur « +n » ici — cas impossible par construction, pas de code
  mort pour un scénario qui ne peut pas se produire.
- **Gating identique aux points actuels** : `type === 'COURT' && due > 0`, rangée complète
  seulement si `!small`.
- **Petit créneau** (`small`, hauteur < 46 px) : si soldé → ✓ seul (inchangé) ; sinon jusqu'à
  **2 mini-pastilles** Ø 12 px en bas-droite (les 2 premiers participants dans l'ordre) —
  c'est un aperçu, le survol garde tout le détail.

## UI — panneau au survol

- **Déclencheur** : survol du bloc, délai ~400 ms. Disparaît au `mouseleave`, au `mousedown`
  (début de drag potentiel) et pendant tout drag en cours (`drag !== null`). S'affiche aussi
  sur les blocs `small` (seul moyen d'y lire le détail).
- **Rendu** : div `position: fixed` rendue au niveau de la page (les blocs ont
  `overflow: hidden`, impossible de rendre dedans), `pointerEvents: 'none'` (ne bloque ni
  clics ni drags), `zIndex` au-dessus de la grille, sous les modales.
- **Position** : à droite du bloc (`rect.right + 8, rect.top`) ; si le panneau déborde du
  viewport à droite → bascule à gauche du bloc ; clamp vertical pour ne jamais sortir en bas.
- **Contenu** :
  - une ligne par participant : `✓` vert « Prénom Nom · 12,50 € » (part réglée) ou `○` rouge
    « Prénom Nom · reste 12,50 € » ;
  - résa soldée au global : toutes les lignes en `✓` (montant affiché seulement si > 0) ;
  - une ligne « ○ place libre » grise par place restante ;
  - **ligne de total** : « Payé X € / Y € · reste Z € » (reste en rouge) ou « ✓ Soldé » vert.
- **Tactile** : rien — pas de hover ; le tap ouvre déjà la modale d'encaissement (`CashRegister`).
- **Title natif du bloc** : la partie paiement (`· payé X / Y`) est retirée du `title` des blocs
  payants (le panneau la remplace, pas de doublon) ; le `title` garde `label · type · horaires`
  (utile quand le nom est tronqué). Blocs non payants inchangés.

## Architecture

- **Helper pur** dans `lib/caisse.ts` : `participantPastilles(rv, players, due)` →
  `PastillesModel | null`, construit par-dessus `deriveSlots` (même dérivation de place que la
  caisse — y compris le repli « holder » quand une résa n'a aucun participant détaillé, ex.
  créée depuis la modale Studio admin, auquel cas le titulaire seul occupe 1 place).
  - `null` si `type !== 'COURT' || due <= 0` (miroir de `paymentDots`) ;
  - `{ seats, settled, totalPaidCents, totalDueCents }` où `seats` = tableau de `places`
    entrées : `{ seed, initials, name, paid: boolean, paidCents, outstandingCents }` pour un
    participant, `null` pour une place vide ; `settled` = `toCents(paidAmount) >= due`.
- **Helper pur** `popoverPosition(anchor, viewportWidth, panelWidth?, gap?)` → `{ left, top }` :
  le calcul flip (bascule à gauche si le panneau déborderait à droite) vit ici, testable sans DOM.
- **Composant** `components/admin/PaymentInitials.tsx` : rendu des pastilles
  (props `model`, `compact?` pour la variante small 2-max). Thème-aware (`useTheme`).
- **Composant** `components/admin/planning/TilePaymentPopover.tsx` : présentation pure du
  panneau (props `model`, `anchor`), appelle `popoverPosition` pour se positionner.
- **Page planning** : remplace `<PaymentDots>` par `<PaymentInitials>` ; état hover local
  `{ id, anchor, model } | null` + timer 400 ms (`onMouseEnter`/`onMouseLeave` sur le bloc,
  annulé par `onMouseDown` — qui démarre un drag — et par `drag !== null` au rendu) ; popover
  rendu en fin de page.
- `PaymentDots`, `paymentDots` et `SETTLED_COLOR` **ne bougent pas** (toujours utilisés par
  `CashRegister`, `QueueList`, `/admin/reservations`, `/admin/encaissement`).

## Hors périmètre

- Les autres surfaces d'encaissement (Paiements, Caisse, Ventes & journée).
- Long-press tactile.
- Ventilation d'un paiement global en parts par joueur (le backend n'attribue pas).
- Photos d'avatar dans les pastilles (initiales seulement à cette taille).

## Tests

- `caisse.test.ts` : `participantPastilles` — gating COURT/dû, part réglée vs due, settled
  global force tout payé, places vides, repli holder (résa sans détail participant),
  `popoverPosition` (flip droite/gauche).
- `AdminPlanning.test.tsx` : pastilles rendues avec initiales ; panneau apparaît après le délai
  (fake timers) et liste noms + reste dû ; pas de panneau si `mousedown`/drag ; title sans la
  partie paiement.
- Vérification visuelle CDP (clair + sombre) : pastilles, panneau, flip dernière colonne,
  petit créneau.
