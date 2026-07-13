# Page admin « Offres » — vitrine miroir + studio de création (design)

**Date** : 2026-07-13
**Statut** : validé par Eric (direction A « Vitrine miroir » choisie sur maquettes comparées dans le companion visuel, parmi A éditorial-miroir / B studio-catalogue / C boutique-bento ; formulaire « essentiel d'abord » retenu)

## Problème

La page `/admin/packages` (« Offres prépayées » + « Abonnements ») cumule quatre douleurs, toutes confirmées par Eric :

1. **Formulaire envahissant** — le gros formulaire de création est toujours ouvert en haut, avant même de voir les offres existantes.
2. **Pas de preview joueur** — on ne voit jamais à quoi ressemble l'offre côté Club-house pendant qu'on la crée/édite.
3. **Listes plates illisibles** — les offres sont des lignes de texte grises (prix, validité, sports concaténés au `·`).
4. **Manque d'infos business** — aucun chiffre (abonnés par formule, carnets vendus…).

Contrainte de positionnement (décidée avec Eric) : **pas de doublon** avec le bandeau abonnés de `/admin/members`. La répartition des rôles est : `/admin/members` = les *gens* (cycle de vie, renouvellements), `/admin/packages` = le *catalogue* (concevoir, tarifer, publier). Ici, seulement un **pouls** par carte, cliquable vers Membres.

## Vue d'ensemble

La page devient une **vitrine miroir** : les offres sont affichées comme les joueurs les voient sur le Club-house (`OffersShowcase` — accents cyclés, prix en vedette), enrichies du pouls business et des actions admin. La création/édition passe par une **modale studio** avec aperçu joueur en direct. Renommage : entrée de nav et `<h1>` deviennent **« Offres »** (icône `card` conservée).

## 1. La page

- **Header** : `<h1>` « Offres » + CTA **« ＋ Créer une offre »** (pill pleine `th.accent`, ombre portée teintée). Bannière d'erreur **coral thémée** (pattern des listes admin Tournois/Events, jamais de `#3a1d1d`).
- **Deux sections** à kicker uppercase + filet (`::after` hairline) : **« Abonnements »** puis **« Carnets & Porte-monnaie »**. Section vide → non rendue ; les deux vides → **état vide** unique (carte centrale avec invite « Créez votre première offre » + CTA).
- Chaque section est une **grille** `repeat(auto-fill, minmax(230px, 1fr))`, gap 12. Actives d'abord (ordre `createdAt` existant), **retirées de la vente en fin de section** : `opacity .55`, liseré gris, statut « Retirée de la vente », action « Remettre en vente ».
- « Chargement… » simple (pas de skeleton).

## 2. La carte-miroir (anatomie)

Chaque offre = carte blanche `th.surface`, radius 16, `th.shadow`, **accent cyclé** sur la palette `ACCENTS` par index d'affichage (même esprit que les cartes `.of-card` du Club-house) :

- **Liseré latéral 4 px** de l'accent (inset) + **lavis dégradé en tête** (`${accent}~16%` → transparent, hauteur ~52 px) portant la **chip de type** (« Abonnement » / « Carnet » / « Porte-monnaie », fond accent translucide, encre foncée assortie) et, si `imageUrl`, une **vignette d'affiche** arrondie (~40 px) à droite du lavis.
- **Nom** (fontUI 15 · 800), **prix en display** (fontDisplay ~24, `-1px`) avec suffixe muté (« /mois · 12 mois » pour une formule, « · 10 entrées » pour un carnet, « · 200 € crédités » pour un porte-monnaie).
- **Ligne de caractéristiques** mutée : sports (ou « Tous sports »), créneaux (« Toutes heures » / « Heures creuses »), avantage (« inclus » / « −50 % »), validité (« valable 180 j » / « sans expiration »), plafonds si posés.
- **Pouls business** (une ligne, fontUI 11.5 · 700, couleur accent) :
  - Formule : « 👥 12 abonnés actifs · 588 €/mois → » — **cliquable** → `/admin/members?plan=<planId>` (pré-filtré).
  - Carnet : « 🎟 8 en circulation · 23 vendus » — non cliquable en v1 (la page Membres n'a pas de filtre carnet).
  - Porte-monnaie : « 💰 1 240 € en circulation · 9 vendus » — non cliquable.
  - Zéro vente → ligne mutée « Aucune vente pour l'instant ».
- **Pied de carte** (filet haut) : point de statut (emerald « En vente » / gris « Retirée de la vente ») + actions à droite : **« Modifier »** (ouvre le studio pré-rempli) et **« Retirer de la vente » / « Remettre en vente »** (toggle direct, pas de menu ⋯ en v1).

La **description n'apparaît pas** sur la carte admin (elle vit dans le studio et côté joueur) — la carte reste scannable.

## 3. Le studio (création ET édition, même modale)

Modale plein écran mobile / centrée desktop, **2 colonnes dès ~700 px** (bascule CSS pure, classes globales — pattern `.pl-create-grid` de la modale planning, pas de `useIsDesktop`) :

- **En-tête** : titre « Nouvelle offre » / « Modifier l'offre » + **chips de type** (⚡ Abonnement / 🎟 Carnet / 💰 Porte-monnaie). En création, changer de chip adapte le formulaire (les champs communs — nom, description, affiche, sports — sont conservés). En édition, le type est **verrouillé** (chips des autres types masquées).
- **Colonne formulaire — « essentiel d'abord »** :
  - Commun : **Nom**, **Sports** (pills multi, catalogue du club), **Description** (textarea), **Affiche** (picker image, aperçu local ; en création l'upload part après l'obtention de l'id — pattern `PendingImagePicker` existant, échec non bloquant).
  - Formule : **Prix / mois**, **Engagement (mois)**, segmenté **Toutes heures / Heures creuses**, segmenté **Inclus / Remise %** (le champ % apparaît inline quand « Remise % » est sélectionné).
  - Carnet : **Prix de vente**, **Entrées**.
  - Porte-monnaie : **Prix de vente**, **Montant crédité**.
  - **« Réglages avancés ▾ »** (replié par défaut) : plafonds /jour et /semaine (formules) ; validité en jours (carnets & porte-monnaie).
  - CTA : **« Mettre en vente »** (création) / **« Enregistrer »** (édition) + « Annuler ». Garde `busy` anti double-submit. Erreurs mappées inline dans la modale.
- **Colonne aperçu** : fond **brume bleue** (`HERO_GRADIENT` + `HERO_INK`), kicker « Ce que verront vos joueurs », **carte joueur en direct** (chip type, nom, prix display, caractéristiques, description, faux CTA « Souscrire · X € ») **mise à jour à chaque frappe**, avec l'affiche si choisie. Accent de l'aperçu = accent que la carte prendra à sa position (fin de section) ; repli `th.accent`.
- **Mobile** : colonnes empilées, l'aperçu replié derrière une vignette dépliable « Voir l'aperçu ✨ » (pattern onboarding `LivePhonePreview`).

L'édition couvre **enfin tous les champs** que le backend accepte déjà (nom, prix, validité, plafonds, créneaux, avantage, engagement, sports pour les formules) — plus seulement description/image.

## 4. Backend (micro, additif — aucune migration, aucune nouvelle route)

- **`PackageService.listTemplates`** enrichi : chaque template gagne `stats = { soldCount, activeCount, outstandingAmount }` calculés par agrégat sur `MemberPackage` (groupBy `templateId`) :
  - `soldCount` = nombre total de `MemberPackage` du template ;
  - `activeCount` = encore utilisables (ENTRIES : `creditsRemaining > 0` ; WALLET : `amountRemaining > 0` ; non expirés `expiresAt null ou > now`) ;
  - `outstandingAmount` (WALLET) = somme des `amountRemaining` utilisables, sérialisée comme les autres Decimal (string).
- **`PackageService.updateTemplate`** élargi : accepte aussi `sportKeys`, `entriesCount`, `walletAmount` (validations identiques à `createTemplate`, cohérence avec le `kind` existant ; `kind` reste non éditable). Sans risque : les soldes vendus sont snapshotés sur `MemberPackage`, seul le futur est affecté.
- **Formules : zéro changement backend.** La page charge en parallèle `adminGetSubscriptionOverview` (existant) : `plans[].activeCount` pour le compteur, et le revenu par formule se calcule **côté client** en sommant `monthlyPriceSnapshot` des `subscribers` actifs du plan.

## 5. Raccord page Membres

`/admin/members` apprend à lire **`?plan=<planId>`** dans l'URL au montage (elle possède déjà `planFilter` en état local) : pose `planFilter` + bascule le segment sur « Abonnés ». Lecture one-shot (pattern `window.location.search` déjà utilisé par `/login`), pas de synchronisation continue de l'URL.

## 6. Découpage front

- **Helpers purs testés `frontend/lib/adminOffers.ts`** : cycle d'accent (`offerAccent(index)`), libellés de pouls (`packagePulse(stats, kind)`, `planPulse(activeCount, revenueCents)`), calcul du revenu par plan depuis l'overview, tri actives/retirées, mapping brouillon studio → props de la carte d'aperçu.
- **Composants `frontend/components/admin/offers/`** : `OfferCard.tsx` (carte-miroir + pouls + pied d'actions), `OfferStudio.tsx` (modale 2 colonnes, état contrôlé, émet un brouillon au submit — les appels API restent dans la page), `OfferPreviewCard.tsx` (carte joueur pure, partagée entre l'aperçu du studio et… rien d'autre en v1, mais extraite pour rester pure).
- **Page `app/admin/packages/page.tsx`** réécrite : orchestration (load parallèle templates + plans + overview, création/édition/toggle via les `api.admin*` existants, upload d'affiche différé), plus aucun formulaire inline.
- `OfferEditor`/`PendingImagePicker` actuels disparaissent (absorbés par le studio).

## 7. Hors périmètre (v1)

- Dashboard de stats sur cette page (le bandeau de `/admin/members` et Ventes & journée couvrent le besoin).
- Filtre carnet sur la page Membres (le pouls carnet reste non cliquable).
- Duplication d'offre, réordonnancement manuel, archivage/suppression définitive, vente directe depuis cette page.
- Toute évolution du côté joueur (`OffersShowcase` inchangé).

## 8. Tests & vérification

- **Backend** : `package.service.test.ts` — agrégat `stats` (vendus/actifs/outstanding, expiration), `updateTemplate` élargi (sportKeys/entriesCount/walletAmount, validations, kind immuable).
- **Front** : `adminOffers.test.ts` (helpers purs) ; `AdminPackages.test.tsx` réécrit (sections + ordre actives/retirées, pouls formules cliquable, studio : ouverture pré-remplie, création carnet/formule, remise % inline, réglages avancés repliés, toggle vente) ; `AdminMembersFilters` étendu (`?plan=` pose le filtre).
- **Visuel** : vérif CDP clair + sombre, desktop 1280 + mobile 390 (grille, studio 2 colonnes ↔ empilé, scrollWidth ≤ viewport).
