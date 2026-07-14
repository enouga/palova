# Membres admin — maître-détail + fiche cockpit (design)

**Date** : 2026-07-14
**Statut** : validé par Eric (structure A « maître-détail » + anatomie « cockpit » choisies sur maquettes comparées dans le companion visuel ; heatmap conservée ; encaissement inline validé ; disparition de la page à onglets validée)

## Problème

La gestion des membres se fait aujourd'hui en trois temps que le gérant n'aime pas :

1. Clic sur un membre → **petit panneau latéral** (`MemberPanel`, 360 px) avec 4 champs éditables et les actions ;
2. « Voir la fiche complète → » → **page séparée** `/admin/members/[userId]` découpée en **5 onglets** (Activité / Finances / Niveau / Fidélité / Notes) ;
3. Les informations sont éclatées : impossible de « connaître le membre d'un coup d'œil », il faut naviguer.

Le cadrage a confirmé que le gérant ouvre une fiche pour **tous** les jobs à la fois (vérifier une info, l'argent, connaître le membre, agir sur son compte) — la fragmentation en onglets est le problème, pas la priorisation.

## Décision

Un **seul écran de travail** `/admin/members` en **maître-détail** (pattern boîte mail) :
liste compacte à gauche, **fiche 360° « cockpit »** à droite. Le panneau latéral et la
page à onglets **disparaissent**. Tout se lit et s'édite **sur place** — zéro navigation,
zéro onglet ; la profondeur passe par des **dépliants dans les cartes** du cockpit.

## 1 · L'écran maître-détail

### Colonne gauche (liste, ~360 px desktop)

- Recherche (débouncée, inchangée), pastilles segments (Tous / Abonnés / Staff / À surveiller / Bloqués), tri (Nom / Plus récents / Dernière activité).
- Liste **virtualisée** conservée (`computeVirtualRange`, pas fixe), lignes **compactes** : avatar, nom, chips essentielles (rôle staff, Abonné tronqué, Bloqué, 👁), `LevelChip`, liseré latéral accent pour les abonnés. La ligne n'a plus deux zones cliquables (nom vs ligne) : **un clic = sélection** (la fiche s'affiche à droite).
- Barre d'outils de colonne : bouton « + Ajouter » (accent) et « Exporter CSV » (l'export garde le périmètre = lignes visibles après filtres).
- Le **contexte Abonnés** conserve ses sous-filtres (forfait / expirent bientôt / sport) ; les actions Renouveler/Changer/Résilier **quittent la ligne** (elles vivent dans la carte Argent de la fiche).

### Panneau droit

- Membre sélectionné → **fiche cockpit** (cf. §2).
- **Aucun membre sélectionné** → **tableau de bord du fichier** : les 4 KPI (Membres / Abonnés / Actifs 30 j / Bloqués) en grand + rappels utiles (ex. « N à surveiller ») ; en contexte Abonnés, c'est le bandeau `SubscriberInsights` (KPIs revenu/mois, expirations, cartes par forfait cliquables = filtre) qui s'installe dans le panneau. L'écran n'est jamais vide. Le bandeau KPI compact du header de page actuel disparaît (redondant).

### Navigation & URL

- **URL synchronisée** : la sélection s'écrit dans `?m=<userId>` (`history.replaceState`, pattern des filtres `/events`) → deep-link partageable, back/forward navigateur cohérents, F5 restaure la sélection.
- L'ancienne route **`/admin/members/[userId]` redirige** vers `/admin/members?m=<userId>` (aucun lien entrant ne casse ; seul `onNavigate` de la liste l'utilisait).
- **Clavier** : ↑/↓ déplacent la sélection dans la liste visible (la fiche suit), Échap désélectionne. Focus géré pour ne pas voler la frappe du champ recherche.

### Mobile (< 900 px, `useIsDesktop`)

- Liste pleine largeur ; tap → **fiche plein écran** (même contenu cockpit, cartes empilées en 1 colonne) avec bouton retour. `?m=` fonctionne pareil.

## 2 · La fiche cockpit

Ordre vertical, pensé « réponse en 2 secondes » :

### Header identité

- Avatar (`colorForSeed`), **nom**, chips : rôle staff (Gérant/Admin/Staff), « Abonné · {formule} » (tronquée), « Carnet », « Bloqué », 👁 À surveiller.
- Ligne coordonnées : email · téléphone · n° adhérent · « membre depuis X · vu {relatif} ».

### Rangée d'actions

- **« 💶 Encaisser N € »** (coral) — rendu **seulement si reste dû > 0** ; scrolle/déplie la carte Argent sur les lignes d'impayés.
- **« 💬 Message »** — ouvre le DM existant (`openDm`).
- Menu **« ⋯ »** : Bloquer/Débloquer, Rôle staff… (popover `StaffRoleMenu`, gating viewer OWNER/ADMIN + jamais soi-même/le gérant, inchangé), À surveiller (toggle), Supprimer le membre (ConfirmDialog + garde `MEMBER_IS_STAFF` inchangée).

### Rangée KPI (5 tuiles compactes)

Résas 30 j · **Reste dû** (coral si > 0) · Niveau · Fiabilité (= 100 − taux d'annulation, badge « à risque » si `loyalty.atRisk`) · Dépensé sur 12 mois (Σ `finance.revenueByMonth`).

### Grille de cartes (2 colonnes desktop, 1 en mobile)

Chaque carte montre **l'essentiel toujours visible** + un dépliant **sur place** (accordéon dans la carte, jamais de navigation) :

1. **💶 Argent**
   - Visible : **impayés ligne par ligne** (réservation, date, montant dû, bouton **Encaisser** inline → moyens rapides du club, cf. §3) ; soldes carnet/porte-monnaie (+ bouton Recharger → `PackageBalanceDialog` existant) ; abonnement géré avec échéance (chip « Expire dans N j » si < 30) + boutons Renouveler / Changer / Résilier (→ `SubscriptionActions` existant).
   - Déplié : CA par mois (`MonthlyRevenueChart`), donut moyens de paiement (`PaymentMethodChart`), consommation prépayé.
2. **📅 Vie au club**
   - Visible : 3-4 dernières activités (résa / tournoi / event / achat, statut en chip) ; **heatmap jour×heure compacte** (`DayHourHeatmap`, toujours visible — demande explicite) ; habitudes (jour favori, terrain favori, sport favori si multi-sport).
   - Déplié : historique complet + filtre « annulations tardives seulement » + compteurs (annulées, tardives, no-show « estimation »).
3. **🎾 Jeu** *(masquée si `levelSystemEnabled === false`)*
   - Visible : niveau + tier (+ « provisoire »), V–D, partenaires fréquents (3 max).
   - Déplié : courbe `LevelHistoryChart` + correction admin `LevelOverrideForm` + fiabilité détaillée (`ReliabilityMeter`).
4. **📝 Notes & infos**
   - Visible : téléphone, n° adhérent, note courte et case « Abonné (fenêtre de réservation élargie) » **éditables inline** (l'édition de l'ex-`MemberPanel` migre ici, bouton Enregistrer local à la carte) ; fil des **notes staff** horodatées (auteur + date, ajout, suppression confirmée).

## 3 · Encaissement inline — compatibilité Caisse

L'« Encaisser » de la fiche est une **4ᵉ porte d'entrée vers le même registre** (comme la
modale du planning) : il passe par **`adminAddPayment` existant** (mêmes gardes
`PAYMENT_EXCEEDS_DUE`, même `receiptNo`, respect de `payAtClubOnly` → bouton unique
« Encaissé · {montant} » méthode `CLUB`, sinon **moyens rapides du club**
`quickPaymentMethods`). Un paiement posé depuis la fiche apparaît donc **identiquement**
dans Caisse, Ventes & journée et Paiements. Montant par ligne = la **part du membre**
(sa `share` de participant, ou son dû de titulaire), plafonnée au reste dû global de la
résa — mêmes règles que les surfaces existantes.

## 4 · Backend (additif, aucune migration)

- Réutilise `adminGetMemberHistory` + `adminGetMemberNotes` + `adminGetMemberLevel` + `Member.subscription` (déjà exposé par `listMembers`).
- **Un seul ajout** : `MemberHistory.finance.unpaid[]` = réservations COURT/COACHING CONFIRMED du membre avec reste dû > 0 → `{ reservationId, participantId | null, startTime, resourceName, dueAmount }` (même règle de dû que `listClubReservations` : `totalPrice` ou tarif terrain via `slotPriceCents`, net des paiements non remboursés). Sert les lignes « Encaisser » et le montant du bouton header.
- L'encaissement appelle `adminAddPayment` (existant) puis recharge l'history.

## 5 · Composants & fichiers

- `app/admin/members/page.tsx` : réécrit en maître-détail (garde virtualisation, filtres, contexte abonnés, `AddMemberDialog`, CSV).
- **Nouveaux** `components/admin/members/` : `MemberCockpit.tsx` (orchestrateur fiche), `CockpitHeader.tsx`, `MoneyCard.tsx`, `LifeCard.tsx`, `GameCard.tsx`, `NotesCard.tsx`, `FileDashboard.tsx` (état vide / insights).
- **Supprimés** : `MemberPanel.tsx` ; la page `[userId]/page.tsx` réduite à une **redirection**.
- Réutilisés tels quels : `SubscriptionActions`, `PackageBalanceDialog`, `StaffRoleMenu`, `AddMemberDialog`, `ConfirmDialog`, `MonthlyRevenueChart`, `DayHourHeatmap`, `PaymentMethodChart`, `LevelHistoryChart`, `LevelOverrideForm`, `ReliabilityMeter`, `SubscriberInsights`, helpers `lib/members.ts` / `lib/memberStats.ts` / `lib/subscriptionAdmin.ts`.
- `MemberRow` simplifiée (une seule zone cliquable, mode compact) ; ses actions abonnés retirées.

## 6 · Tests

- Backend : `memberStats.service.test.ts` — bloc `finance.unpaid` (dû par résa, net des paiements, part participant, résa soldée absente).
- Frontend : `AdminMembers*.test.tsx` adaptés (sélection → cockpit dans la page, `?m=` deep-link, redirect `[userId]`, clavier ↑↓/Échap) ; nouvelles suites `MemberCockpit` (KPIs, cartes, dépliants, encaissement inline optimiste + `payAtClubOnly`, gating carte Jeu, édition Notes & infos) ; `MemberHistory.test.tsx` remplacé.
- Vérification visuelle CDP clair + sombre, desktop 1280 + mobile 390 (aucun débordement horizontal).

## Hors périmètre (v1)

- Relances / envoi d'email depuis la fiche ; import CSV ; fusion de doublons ; timeline infinie paginée serveur ; export PDF de fiche ; remboursement depuis la fiche (reste sur Paiements).
