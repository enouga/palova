# Caisse en deux zones — nouvelle page d'encaissement (design)

**Date** : 2026-07-07
**Statut** : validé (maquette approuvée via compagnon visuel — `.superpowers/brainstorm/2279-1783439966/content/caisse-focus.html`)
**Périmètre** : 100 % frontend, aucune migration, aucun changement backend. La page actuelle `/admin/reservations` (« Encaissement ») **n'est pas touchée** — la nouvelle page vit à côté, le temps de la valider.

## Problème

La page Encaissement actuelle fusionne deux modes de travail incompatibles :

1. **Balayer** — « qui doit encore payer ? qui arrive à 17h ? » : demande une liste dense et calme.
2. **Encaisser** — un client est au comptoir, UNE réservation est en cours de règlement : demande une surface de paiement grande et focalisée.

Résultat : chaque réservation affiche en permanence ses ~15 boutons (3 moyens × 4 joueurs + « Tout solder »), la part de chaque joueur n'est affichée nulle part, et le modèle « rangée × moyen » ne sait pas encaisser le cas courant « on paie à deux en CB ».

Douleurs validées par le user : surcharge de boutons, montants peu lisibles, design brut, ergonomie du geste. Contexte : **desktop d'abord** (PC à l'accueil), le « 1 clic = encaissé » (optimiste) est **sacré**.

## Solution : une caisse en deux zones (modèle POS)

Le modèle d'interaction s'inverse : **on sélectionne QUI paie, puis on tape le MOYEN**.

```
┌─────────────────────────┬──────────────────────────────────────┐
│  ZONE 1 · La file       │  ZONE 2 · La caisse                  │
│  (balayer)              │  (encaisser la résa sélectionnée)    │
│                         │                                      │
│  À encaisser d'abord    │  17:00 — Padel int 1    ▓▓▓░░ reste  │
│  ┌───────────────────┐  │  Super Admin · 4 joueurs      26 €   │
│  │17:00 Super Admin  │◄─┤                                      │
│  │Padel int 1 ●●○○ 26€│  │  ┌─────────┐ ┌─────────┐            │
│  └───────────────────┘  │  │SA ✓ CB  │ │J2 ✓ Esp.│            │
│  17:00 Marie… ○○○○ 52€  │  ├─────────┤ ├─────────┤            │
│  18:30 Karim… ○○○○ 40€  │  │J3  13 € │✓│J4  13 € │  ← tuiles   │
│                         │  └─────────┘ └─────────┘   cochables │
│  Soldées                │  [ Tout le reste — 2 parts · 26 € ]  │
│  15:30 Léa…  ✓ Soldé    │                                      │
│                         │  1 joueur sélectionné       13,00 €  │
│                         │  [💳 CB] [€ Espèces] [🎫 Ticket CE]  │
│                         │  [Carnet · reste 3]                  │
│                         │                                      │
│                         │  Montant libre, reçu, historique ›   │
└─────────────────────────┴──────────────────────────────────────┘
```

### Le geste en 3 temps

1. **Sélectionner qui paie** — tap sur une ou plusieurs tuiles joueur, ou « Tout le reste ».
   Le montant à annoncer au client s'affiche en grand (« ça fera 26 € »). À l'ouverture
   d'une réservation, le **premier joueur non réglé est pré-sélectionné** → le cas simple
   reste à 1 tap.
2. **Taper le moyen** — gros boutons POS (moyens rapides du club, `quickPaymentMethods`),
   une seule fois à l'écran. Le bouton **Carnet / Porte-monnaie** n'apparaît que si le
   joueur sélectionné en a un d'utilisable (avec son solde affiché). Encaissement
   **optimiste** immédiat, comme aujourd'hui.
3. **Enchaîner** — les tuiles réglées passent en ✓ (+ moyen), le **joueur non réglé
   suivant se sélectionne automatiquement** (« CB, CB, CB » = 3 taps pour 3 parts).
   Un **toast d'annulation** (~6 s) permet de se rattraper : « ✓ 13 € CB — Joueur 3 ·
   Annuler ». Tout réglé → la réservation glisse dans le groupe « Soldées » de la file.

## Page, route, navigation

- Nouvelle page **`/admin/encaissement`** (`frontend/app/admin/encaissement/page.tsx`),
  titre « Caisse express » (cohérent avec l'entrée de nav), même garde staff que les
  autres pages admin (layout existant).
- Entrée de sidebar **« Caisse express »** ajoutée sous l'entrée « Encaissement »
  existante (les deux coexistent pendant la validation ; à terme la nouvelle pourra
  remplacer `/admin/reservations`, hors périmètre de cette spec).
- La page actuelle `/admin/reservations` et ses composants (`ReservationCollect`,
  `PaymentDots`…) ne sont **pas modifiés**.

## Zone 1 — la file

- **Plus de groupement par terrain** : liste chronologique, en deux groupes :
  - **« À encaisser d'abord »** : réservations avec reste dû, triées par `startTime` asc ;
  - **« Soldées »** : réglées (ou dues nulles), estompées, triées par `startTime` asc.
  - Les annulées restent masquées (comme aujourd'hui).
- Chaque ligne : heure (mono), titulaire (ou `title`/« Événement »), sous-titre
  `terrain · N joueurs`, pastilles de progression (`paymentDots` réutilisé), reste dû
  en coral (ou « ✓ Soldé » en vert).
- Clic sur une ligne → la réservation s'ouvre dans la zone caisse (surlignage accent
  de la ligne sélectionnée).
- **Filtres et KPI conservés tels quels** : le bandeau KPI compact (Encaissé / Reste /
  Total) et `ReservationFilters` (jour, recherche, sports, période, « À encaisser »)
  sont réutilisés sans modification — ils filtrent la file.
- À l'arrivée sur la page : la **première réservation « à encaisser »** est
  sélectionnée d'office (rien si la file est vide → zone caisse en état vide
  « Sélectionnez une réservation »).

## Zone 2 — la caisse

### En-tête
Heure + terrain en grand, sous-titre `titulaire · N joueurs · prix du créneau`,
barre de progression et `encaissé X € / reste Y €` (coral).

### Tuiles joueurs
- Une tuile par **place** (capacité du terrain : 2 single / 4 double — `deriveSlots`
  réutilisé) : avatar (initiales colorées `colorForSeed` / numéro neutre pour une place
  générique), nom (ou « Joueur N »), part en gros (`13 €`), lien **« associer un
  membre »** sur les places génériques (ouvre le `PlayerPicker` dans la tuile, comme
  aujourd'hui dans la rangée).
- États : **non réglée** (cochable), **sélectionnée** (anneau accent + coche),
  **réglée** (✓ vert + moyen, estompée, non cochable ; clic → propose « annuler ce
  règlement » — remboursement optimiste comme aujourd'hui).
- Tuile pleine largeur **« Tout le reste — N parts · X € »** : sélectionne toutes les
  places non réglées (remplace « Tout solder »).
- **Événements / résas sans places** (`type !== 'COURT'`) : pas de tuiles, une seule
  « part » = le reste dû, boutons de moyens directs (équivalent du « Encaisser »
  actuel).
- **Résa sans prix** (`due <= 0`) : bouton « Encaisser un montant… » → ouvre la modale
  Détails (comportement actuel conservé).

### Sélection & montant
- Sélection = ensemble de places non réglées. Ligne récap : « N joueur(s)
  sélectionné(s) » + **montant total en grand** (30 px, tabular-nums) — le chiffre
  qu'on annonce au client.
- Un paiement multi-places = **un appel `adminAddPayment` par place** (avec
  `participantId` pour une place nommée, anonyme sinon) — sémantique API strictement
  identique à aujourd'hui, l'attribution par joueur est préservée. Les appels
  s'enchaînent dans une **file sérialisée** avec réconciliation unique en fin de file
  (pattern `enqueue` de `ReservationCollect`, repris).

### Boutons de paiement
- Les moyens rapides du club (`quickPaymentMethods`, repli `DEFAULT_QUICK_METHODS`),
  en gros boutons (hauteur ~52 px) ; le premier est rempli accent, les autres ghost.
- **Carnet / Porte-monnaie** : bouton contextuel affiché seulement si la sélection est
  **une seule place nommée** dont le joueur a un package utilisable
  (`pickPackageFor` : WALLET d'abord, sinon ENTRIES) — libellé « Carnet · reste N » /
  « Porte-monnaie · X € ». Masqué en multi-sélection.
- Ticket CE via bouton rapide : **sans référence** (complétable ensuite dans la
  modale Détails), comme aujourd'hui.

### Après paiement
- Optimiste : tuiles → ✓ immédiatement (`applyOptimisticPayment` réutilisé), montant
  et barre mis à jour, **place non réglée suivante auto-sélectionnée**.
- **Toast d'annulation** (nouveau, local à la page) : « ✓ 13 € CB — Joueur 3 ·
  Annuler », ~6 s, un seul à la fois (le dernier gagne). « Annuler » rembourse les
  paiements du toast (`refundPayment` + `applyOptimisticRefund`, ids optimistes
  ignorés comme aujourd'hui).
- Tout réglé → bandeau « ✓ Soldé » dans la caisse + la ligne bascule dans « Soldées » ;
  sur **desktop**, la sélection saute à la **réservation à encaisser suivante** de la
  file (sur mobile, on reste sur l'état « Soldé » — retour manuel à la file).

### Pied de caisse
- « Montant libre, reçu, historique › » → ouvre la **modale Détails existante**
  (`CollectPanel` + historique des paiements + `Receipt`), inchangée.
- « Annuler la réservation » → `ConfirmDialog` existant.

## Desktop / mobile

- **Desktop (≥ 900 px, `useIsDesktop`)** : split — file ~340 px à gauche (scrollable),
  caisse sticky à droite.
- **Mobile** : la file en pleine largeur ; tap sur une ligne → la caisse s'ouvre en
  **feuille plein écran** (pattern bottom-sheet existant) avec bouton retour. Pas de
  pré-sélection automatique de réservation sur mobile (on reste sur la file).

## Architecture technique

Réutilisation maximale — **aucun changement** à `lib/api.ts`, au backend, ni aux
composants de la page actuelle :

- `frontend/app/admin/encaissement/page.tsx` — état, chargement (mêmes 5 appels que
  la page actuelle), filtres, optimisme, sélection de résa. Repart du squelette de
  `app/admin/reservations/page.tsx` (load/reloadReservations/patchReservation/
  applyPaymentLocally/applyRefundLocally repris tels quels).
- `frontend/components/admin/caisse/QueueList.tsx` — zone 1 (présentation pure).
- `frontend/components/admin/caisse/CashRegister.tsx` — zone 2 (tuiles, sélection,
  boutons, toast) ; s'appuie sur la file sérialisée `enqueue` (pattern repris de
  `ReservationCollect`).
- **`frontend/lib/caisseRegister.ts`** — helpers **purs et testés** :
  - `slotStatuses(reservation, players, due)` : extrait la logique de statut par place
    aujourd'hui enfouie dans `ReservationCollect` (parts égales `due ÷ capacité`,
    places nommées suivies par leurs paiements `participantId`, places génériques
    couvertes par les paiements anonymes de haut en bas, paiement associé pour le
    remboursement ciblé) → `[{ slot, paidCents, remainingCents, payments, method }]`.
  - `nextSelectable(statuses, after?)` : place à auto-sélectionner.
  - `selectionTotal(statuses, selected)` : montant à afficher.
  - `queueGroups(reservations, dueOf)` : tri/groupes de la file (à encaisser / soldées).
- Helpers existants réutilisés : `dueCents`, `toCents`, `fmtEuros`, `deriveSlots`,
  `applyOptimisticPayment`, `applyOptimisticRefund`, `paymentDots`, `playerCount`,
  `pickPackageFor`, `packageLabel`, `indexPackagesByUser`, `matchesQuery`,
  `isUpcoming`, `nextSlotWindow`, `isNextSlot`, `colorForSeed`, `inkOn`.

## Hors périmètre (v1)

- Remplacement / suppression de `/admin/reservations` (décision après validation terrain).
- Raccourcis clavier (1-4 = joueurs, C = CB…), écran client, tiroir-caisse.
- Paiement fractionné d'une même part entre deux moyens (reste possible via la modale
  Détails, montant libre).
- Sélection multi-réservations (encaisser deux résas d'un coup).
- Réordonnancement manuel de la file.

## Tests

- `frontend/__tests__/caisseRegister.test.ts` — helpers purs : parts égales,
  attribution nommée vs anonyme, couverture de haut en bas, auto-sélection suivante,
  totaux de sélection, groupes de file (à encaisser trié par heure, soldées, annulées
  exclues).
- `frontend/__tests__/CashRegister.test.tsx` — pré-sélection de la 1re place non
  réglée ; multi-sélection → montant cumulé ; tap CB → un `adminAddPayment` par place
  sélectionnée avec le bon `participantId` ; auto-avance après paiement ; bouton
  carnet visible seulement mono-sélection avec package ; toast → remboursement ;
  tuile réglée → annuler ; état événement (pas de tuiles).
- `frontend/__tests__/AdminEncaissement.test.tsx` — page : file groupée/triée,
  sélection au clic, filtres appliqués, état vide, résa soldée bascule de groupe
  (optimiste).
- ⚠️ mocks `lib/api` : exposer `assetUrl` et les méthodes admin utilisées (pattern
  des suites existantes).
