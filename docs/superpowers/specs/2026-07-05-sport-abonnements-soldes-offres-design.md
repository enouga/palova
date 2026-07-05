# Sport à côté des abonnements / soldes / offres

## Contexte

Un club peut être multi-sport (`ClubSport`). Les abonnements (`SubscriptionPlan`/`Subscription`)
portent déjà un champ `sportKeys: string[]` (validé contre le catalogue `Sport`), mais rien ne
l'affiche dans le menu profil, la page profil ou la vitrine d'offres du Club-house — l'info existe
en base et n'est simplement pas rendue. Les carnets/porte-monnaie (`PackageTemplate`/`MemberPackage`)
n'ont eux **aucune notion de sport** : une offre prépayée est aujourd'hui toujours club-wide.

Demande : afficher le sport à côté de chaque abonnement, solde et offre, là où c'est pertinent
(clubs multi-sport uniquement — un badge sur un club mono-sport comme `padel-arena-paris` serait
du bruit, cf. le helper existant `clubIsMultiSport`).

## Modèle de données

Migration additive `add_package_template_sport_keys` :

```prisma
model PackageTemplate {
  // ...
  sportKeys String[] @default([]) @map("sport_keys")
}
```

- **Optionnel**, contrairement à `SubscriptionPlan.sportKeys` (obligatoire) : un tableau vide
  signifie « tous sports » (comportement actuel, aucun chip affiché). Ça évite de forcer chaque
  club à retagger ses offres existantes après la migration.
- `MemberPackage` ne gagne **pas** de colonne : il joint déjà `template: { select: { name: true } }`
  dans `listMyPackagesBySlug` (seule méthode qui alimente les surfaces visées — ProfileMenu +
  WalletSection passent toutes les deux par `getMyClubPackages`) — on ajoute `sportKeys: true` à ce
  select. Lecture live depuis le template (pas un snapshot), comme le nom déjà aujourd'hui.
  `listMemberPackages` (fiche joueur admin) et `listActiveByClub` (caisse) ne sont **pas** touchés :
  ils alimentent des surfaces hors périmètre (cf. Hors périmètre).

## Backend

- `PackageService.createTemplate` / `updateTemplate` : acceptent `sportKeys?: string[]`, validés
  contre la table `Sport` (même contrôle que `subscription.service.ts` — existence de la clé
  uniquement, pas besoin que le club ait activé ce sport). Défaut `[]`.
- `PackageService.listMyPackagesBySlug` : `sportKeys: true` ajouté au select `template`.
- `OfferService.listPublicOffers` : `sportKeys: true` ajouté au select `packageTemplate` (vitrine
  Club-house).

Pas de changement de logique métier : `sportKeys` sur un carnet est **purement cosmétique** (pas
de gate fonctionnel comme sur les abonnements où `sportKeys` conditionne la couverture).

## Frontend — affichage

Nouveau helper dans `lib/sportBadge.ts` :

```ts
export function sportNames(club: { clubSports?: { sport: { key: string; name: string } }[] } | null | undefined, keys: string[]): string[]
```
Résout chaque clé via `club.clubSports`, repli sur la clé brute si non trouvée.

Toutes les surfaces ci-dessous gate l'affichage sur `clubIsMultiSport(club)` **et** `keys.length > 0` :

- **`ProfileMenu.tsx`** — ligne « Mes soldes » (`packageLabel(p)`) et « Mes abonnements »
  (`s.plan.name`) gagnent un suffixe `· {sportNames.join(', ')}`.
- **`WalletSection.tsx`** (`/me/profile`) — même traitement (le composant n'a pas encore
  `useClub()`, on l'ajoute).
- **`OffersShowcase.tsx`** (vitrine Club-house) — `planBenefits()`/`packageBenefits()` gagnent une
  ligne sport (actuellement absente même pour les abonnements alors que la donnée existe déjà) ;
  visible sur la carte et dans la modale de détail.

## Admin (`/admin/packages`)

- Le formulaire « Nouvelle offre » (carnet/porte-monnaie) gagne la même rangée de boutons
  multi-sélection que celle déjà utilisée pour les abonnements (`sportOptions.map`) — défaut :
  aucun sport coché (= générique/tous sports).
- Chaque ligne de la liste affiche `sportKeys.join(', ')` ou « Tous sports » si vide — même format
  que les lignes d'abonnement (`p.sportKeys.join(', ')`).
- **Hors périmètre** : éditer le sport d'une offre carnet/porte-monnaie déjà créée — cohérent avec
  nom/prix, non éditables non plus aujourd'hui (seuls description/image le sont via `OfferEditor`).

## Types (`lib/api.ts`)

- `PackageTemplate.sportKeys: string[]`
- `MemberPackage.template: { name: string; sportKeys: string[] }`
- `PublicPackageTemplate.sportKeys: string[]`
- `CreatePackageTemplateBody` gagne `sportKeys?: string[]`

## Tests

- Backend : `package.service.test.ts` (validation sportKeys création, select sportKeys sur les
  3 méthodes de lecture), `offer.service.test.ts` (sportKeys dans `listPublicOffers`).
- Frontend : `sportBadge.test.ts` (nouveau helper `sportNames`), assertions sport dans
  `ProfileMenu`/`OffersShowcase` existants (ou nouveaux tests ciblés), `AdminPackages` si suite
  existante.

## Hors périmètre

- Gate fonctionnel du sport sur les carnets (aucune restriction de consommation par sport —
  contrairement aux abonnements).
- Édition du sport sur une offre déjà créée.
- Affichage du sport dans l'admin caisse / encaissement (non demandé).
