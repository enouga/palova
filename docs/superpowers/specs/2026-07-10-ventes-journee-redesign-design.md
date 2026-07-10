# Ventes & journée — refonte « journal vivant + panneau de vente »

**Date : 2026-07-10**

## Problème

La page `/admin/caisse` (« Ventes & journée » depuis la réorganisation *un job par surface*
du 2026-07-09) est restée brute : récap du jour réduit à deux chiffres et une liste plate,
deux cartes de vente quasi identiques (« Vendre une offre » / « Vendre un abonnement »)
qui **partagent le même état acheteur/moyen** — choisir un membre dans l'une remplit
l'autre —, date affichée en ISO (`2026-07-10`), aucune notion d'heure ni de tendance.
Le user la juge « moche et pas fonctionnelle » ; le récap du jour est le manque principal,
l'esthétique le second.

## Usages cibles du récap (validés)

1. **Compter la caisse le soir** — totaux par moyen clairs (espèces/tiroir, carte/TPE, CE).
2. **Voir le détail des ventes** — chaque encaissement horodaté : qui, quoi, moyen, reçu.
3. **Piloter la journée en cours** — encaissé vs reste dû, nombre d'encaissements.
4. **Comparer / tendance** — sparkline 7 jours + delta vs même jour de la semaine passée.

## Décision — layout B « journal vivant + panneau de vente »

Choisi parmi 3 maquettes (A « compteur d'abord », B, C « dashboard synthèse »)
présentées au visual companion. **100 % frontend : aucune migration, aucune route
nouvelle** — toutes les données existent (`Payment.createdAt`,
`adminAccountingSummary.byDay` net/jour au fuseau club, `totalsByMethod`,
`adminGetReservations(date).summary.outstanding`).

### Structure

- **En-tête** : titre + navigation de date `‹ jeudi 10 juillet ›` (boutons jour
  précédent/suivant autour du `DateField` existant, libellé français, plus d'ISO brut).
- **Bandeau KPI** pleine largeur, puis grille desktop 2 colonnes : journal (2/3) à
  gauche, Vendre + Tickets CE (1/3) à droite.
- **Mobile (empilement)** : KPI → Vendre → Journal → Compter la caisse → Tickets CE
  (au comptoir sur téléphone, vendre vite prime sur consulter).

### Bandeau KPI + tendance

Carte horizontale : **Encaissé** (gros chiffre accent, somme des `MONEY_METHODS`),
**Reste dû (jour)**, **Nb d'encaissements**, et à droite une **sparkline 7 jours**
(net encaissé/jour, jours absents de `byDay` comblés à 0, fenêtre se terminant à la
date sélectionnée) avec delta **« vs <jour> dernier »** = comparaison au même jour de
semaine S-1 (l'activité d'un club est hebdomadaire). Données : 1 à 2 appels
`adminAccountingSummary` (2 si la fenêtre 7 jours + J-7 chevauche deux mois).
Horloge posée en effet — jamais de `new Date()` au rendu (hydration-safe).

### Journal du jour

Une ligne par encaissement : **heure** (`createdAt` au fuseau du club), **qui + quoi**
(`paymentLabel` existant), **chip moyen colorée** (carte = bleu, ticket CE = ambré,
espèces = neutre…), chip « remboursé X € » si remboursement partiel, **montant**,
actions **Reçu** / **Rembourser** (logique et modales actuelles conservées : reçu
imprimable pattern visibility, remboursement partiel avec garde
`validatePaymentAmount`). Filtres en tête : **Tout / Ventes / Résas** — une « vente »
= paiement **sans réservation liée** (carnet, abo, recharge : robuste avec la forme
actuelle de `CaissePayment`). État vide propre.

Sous le journal, carte compacte **« Compter la caisse »** : un chip par moyen
d'argent présent (`MONEY_METHODS`), les consommations prépayées
(`PACK_CREDIT`/`WALLET`/`MEMBER`) affichées à part (ce n'est pas de l'argent qui
rentre).

### Panneau « Vendre » unifié

**Une seule carte** remplace les deux cartes redondantes. Parcours : `PlayerPicker`
(création de joueur à la volée conservée) → soldes actuels du membre
(`packageLabel`) → **offres en lignes cliquables groupées** « Carnets & cartes »
(`PackageTemplate` actifs) / « Abonnements » (`SubscriptionPlan` actifs), sélection
type radio (nom + prix) → **chips de moyen** (`SALE_METHODS` : Espèces, Carte,
Virement, Ticket CE, Autre ; CE déplie référence + émetteur, référence requise) →
CTA **« Encaisser {prix} »**. Après vente : reset du panneau + reload du journal (la
vente apparaît en haut = feedback). Gardes actuelles conservées (busy anti
double-clic, erreurs mappées).

### Tickets CE en attente

Comportement actuel conservé (liste `PENDING_REIMBURSEMENT`, bouton « Remboursé »),
restylée au langage de la page, sous le panneau Vendre.

## Architecture front

- La page (~440 lignes) est découpée : `components/admin/ventes/{TrendKpis,DayJournal,SellPanel}.tsx`
  — la page garde l'orchestration (fetchs, état date/buyer, modales reçu/remboursement).
- Helpers **purs** ajoutés à `lib/caisse.ts` : construction série 7 jours + delta
  (`trendSeries`), partition ventes/résas (`isSalePayment`), format heure au fuseau club.
- Langage visuel : cartes `th.surface` + ombre douce (pattern `cardStyle`), labels mono
  uppercase, chips, accents `ACCENTS`, lisible clair + sombre.

## Hors périmètre

Session de caisse espèces (fond/clôture/Z), article libre, relance d'impayés,
export CSV (couvert par `/admin/comptabilite`), nouveau backend de stats.

## Tests & vérification

- Nouvelle suite `frontend/__tests__/AdminCaisse.test.tsx` : KPI affichés, filtres du
  journal, vente unifiée (carnet ET abo depuis le même panneau), champ CE requis,
  tickets CE, remboursement.
- Cas helpers dans `frontend/__tests__/caisse.test.ts` (`trendSeries` : comblement à 0,
  chevauchement de mois, delta même-jour-S-1 ; `isSalePayment`).
- `tsc --noEmit` (jest ne type-checke pas) ; vérification visuelle clair + sombre,
  desktop + mobile 390 (skill verify).
