# Mon profil — onglets + enregistrement différé (alignement sur Réglages du club)

**Date :** 2026-07-17
**Statut :** spec validée, plan non écrit
**Périmètre :** 100 % frontend, sauf une ligne backend (`manageUrl`). Aucune migration, aucun endpoint nouveau.

## Problème

`/me/profile` empile 11 sections sous une `ProfileSectionNav` collante (scroll-spy), et mélange
**trois régimes d'enregistrement** :

| Régime | Champs concernés |
|---|---|
| Bouton par section | Infos (tél / naissance / sexe), Licence |
| Sauvegarde optimiste immédiate | Langue, Sport préféré, Classements, Propositions de parties, Demandes d'ami, Messages privés |
| Action dédiée | Avatar, Mot de passe, Suppression de compte, Retrait de carte, Réévaluation du niveau |
| Local à l'appareil, rien à enregistrer | Thème (`ThemeProvider` + localStorage) — pourtant présenté comme un champ, dans la même carte que « Langue » |

Le pire n'est pas la variété des régimes : c'est que **« Téléphone » et « Langue » se ressemblent trait
pour trait et obéissent à des règles opposées**. L'utilisateur ne peut pas deviner laquelle s'applique —
il doit tester chaque champ.

Conséquence concrète : on peut éditer tél/naissance/sexe, quitter la page sans cliquer « Enregistrer »,
et **tout perdre sans le moindre avertissement**.

`/admin/settings` a résolu exactement ce problème (spec `2026-07-15-admin-reglages-onglets`, puis
`2026-07-16-reglages-sports-enregistrement-differe` pour la seconde ressource). Cette spec porte la
même architecture sur le profil joueur.

## Objectif

Une page à **5 onglets** (`PillTabs` + `?tab=`) et **une seule barre d'enregistrement sticky** — mêmes
composants, même sémantique, mêmes pièges déjà documentés.

## Règle

> **Tout ce qui est un champ passe par la barre. Ce qui n'est pas un champ, non.**

C'est la règle que `/admin/settings` applique déjà, et elle n'admet **aucune exception**. Elle répond
directement au diagnostic ci-dessus : deux éléments qui se ressemblent ne peuvent plus obéir à des
règles opposées, puisqu'il n'y a plus qu'une règle pour les champs.

Corollaire, appliqué en §2 : **un contrôle qui ne passe pas par la barre n'a pas le droit d'être habillé
en champ de formulaire**, sinon on recrée l'incohérence qu'on prétend supprimer.

## 1. Mécanique d'enregistrement

### Double état

`server` (baseline chargée) + `draft` (édité). `set(k, v)` mute le brouillon.

**`buildProfileBody(draft)` est l'UNIQUE source de vérité** des champs enregistrés, et sert aussi au
calcul `isDirty` :

```ts
isDirty(server, draft) === (JSON.stringify(buildProfileBody(server)) !== JSON.stringify(buildProfileBody(draft)))
```

> ⚠️ **Invariant** : tout champ éditable d'un onglet DOIT figurer dans `buildProfileBody`. Sinon il est
> silencieusement non-dirty et non-sauvé. C'est le piège déjà documenté côté Réglages (où l'ancien
> `save()` oubliait `showOtherClubsReservations`).

Les 9 champs, tous couverts par le `PATCH /api/me` existant :

`phone`, `birthDate`, `sex`, `preferredSportId`, `locale`, `showInLeaderboard`, `autoMatchProposals`,
`acceptsFriendRequests`, `acceptsDirectMessages`.

Deux normalisations dans `buildProfileBody`, parce que la forme de lecture diffère de la forme d'écriture :

- `MyProfile.preferredSport: { id, key, name } | null` → body `preferredSportId: preferredSport?.id ?? null`.
  Le brouillon stocke l'objet (c'est ce dont `PillTabs` a besoin) ; le body en dérive l'id.
- `MyProfile.birthDate` est un ISO complet, le formulaire manipule `YYYY-MM-DD` → body
  `birthDate?.slice(0, 10) ?? null`. Comme `isDirty` passe par `buildProfileBody`, les deux côtés sont
  normalisés de la même façon : un retour serveur en ISO complet ne rend jamais la page dirty par accident.

### Deux ressources, une seule barre

La **licence** a son propre modèle et son propre endpoint (`updateMyClubMembership`) — exactement la
situation Club / ClubSport côté Réglages. Elle obtient donc sa propre paire baseline/brouillon
(`membershipServer` / `membershipDraft`, une string) et son propre `licenceDirty`.

```
dirty = isDirty(server, draft) || licenceDirty(membershipServer, membershipDraft)
```

`save()` lance les deux PATCH **en parallèle**, comme deux ressources indépendantes : chacune réussit
ou échoue séparément, `saveError` agrège les échecs, et le flash « Enregistré ✓ » n'apparaît que si
tout ce qui a été tenté a réussi. Tradeoff assumé et identique aux Réglages : **pas d'atomicité
inter-ressources**.

> ⚠️ **Au succès, ne JAMAIS reposer le brouillon** — seul `server` est mis à jour. Reposer `draft`
> depuis la réponse écraserait une édition faite pendant que la requête était en vol, et la perdrait
> silencieusement. C'est la régression corrigée en revue sur les Sports.

`cancel()` réinitialise les deux brouillons **sans aucun appel réseau**. Rien n'est jamais persisté
avant le clic sur Enregistrer.

### Garde de sortie

`beforeunload` tant que `dirty`. C'est ce qui corrige la perte silencieuse décrite en tête de spec.

### Deux canaux d'erreur distincts

| Canal | Source | Rendu |
|---|---|---|
| `error` | Chargement, upload d'avatar | Bandeau haut |
| `saveError` | Échec d'enregistrement | Dans la `SaveBar`, effacé dès qu'on ré-édite |

### Ce qui reste hors du brouillon

Rien de ce qui suit n'est un champ — la règle est donc respectée.

| Quoi | Pourquoi |
|---|---|
| **Avatar** | C'est un sélecteur de fichier : on choisit une photo, elle part. Personne n'attend un « Enregistrer » après un `<input type=file>`, et le logo du club marche déjà exactement comme ça. Uploadé = déjà persisté : `syncProfile(patch)` met à jour baseline **et** brouillon → ne rend jamais dirty. Miroir exact de `syncImage` (logo / couverture) côté Réglages. |
| **Actions** | Mot de passe, suppression de compte, retrait de carte, réévaluation du niveau. Ce sont des actions, pas des champs — on ne met pas « supprimer mon compte » derrière une barre d'enregistrement. Elles gardent leur bouton et leur feedback propres. |

Le **thème** est traité en §2 : il n'a aucun état serveur, il ne peut donc pas passer par la barre — et
par le corollaire de la règle, il ne peut pas rester habillé en champ. Il quitte la page.

## 2. Les 5 onglets

| Onglet | Contenu | Rendu si |
|---|---|---|
| **Identité** | Photo, nom/prénom/email (lecture seule), téléphone, date de naissance, sexe, sport préféré, licence du club | toujours (licence : membre d'un club) |
| **Niveau** | Badge, courbe, bilan V/D, réévaluer | `club?.levelSystemEnabled !== false` |
| **Préférences** | Langue, classements, propositions de parties, demandes d'ami, messages privés | toujours |
| **Portefeuille** | Soldes carnets/abos, carte enregistrée, historique des paiements | `slug && club && membership` |
| **Sécurité** | Mot de passe, supprimer mon compte | toujours |

`PROFILE_TABS` + `parseProfileTab(search)` en miroir de `SETTINGS_TABS` / `parseTab` : `PillTabs` dans
un `.sp-scroll-x`, onglet actif reflété dans l'URL via `history.replaceState`, défaut `identite`,
valeur inconnue → `identite`.

Les onglets sont **dynamiques**, exactement comme l'est déjà `navItems` aujourd'hui — pas d'onglet mort.

### Le thème quitte la carte Préférences

La ligne « Thème » (label + `Segmented` Clair/Sombre) est **retirée**. Elle violait le corollaire de la
règle : contrôle immédiat, mais habillé en champ et posé juste sous « Langue » qui, elle, devient
différée. Deux voisins identiques, deux règles — exactement l'incohérence que ce chantier supprime.

Le différer n'était pas une option : le thème n'a **aucun état serveur** (`ThemeProvider` + localStorage).
Le mettre dans la barre obligerait soit à afficher « non enregistré » sur un thème déjà visible (mensonge),
soit à ne pas l'appliquer avant le clic — et on perdrait l'aperçu instantané, qui est tout l'intérêt du
sélecteur.

**Aucune fonctionnalité n'est perdue : la ligne est un doublon.** Le `ThemeToggle` est déjà présent dans
l'en-tête de chaque page du profil, sur les deux types d'hôte :

- hôte club → `ClubNav.tsx:206`, en-tête collant rendu par la page ;
- hôte plateforme → en-tête propre de la page (`app/me/profile/page.tsx`, aujourd'hui ligne 324).

Le thème reste donc réglable exactement là où il l'est sur toutes les autres pages de l'app — et la
carte Préférences ne contient plus que des champs de compte, tous derrière la barre.

## 3. Fichiers

| Quoi | Où |
|---|---|
| Helpers purs (aucune horloge, aucun fetch, aucun JSX) | `frontend/lib/meProfile.ts` — `ProfileTabKey`, `PROFILE_TABS`, `parseProfileTab`, `buildProfileBody`, `isDirty`, `licenceDirty` |
| Onglets — composants **contrôlés purs** (props `profile` / `set`, zéro `useAuth`, zéro fetch interne) | `frontend/components/profile/tabs/Profile{Identity,Level,Preferences,Wallet,Security}.tsx` |
| Page orchestratrice (fetch, brouillons, save/cancel) | `frontend/app/me/profile/page.tsx` |
| `SaveBar` **déplacée** | `components/admin/settings/SaveBar.tsx` → `components/ui/SaveBar.tsx` |

Le déplacement de `SaveBar` est délibéré : une page joueur ne doit pas importer un composant d'admin.
Un seul import à mettre à jour (`app/admin/settings/page.tsx`), **aucun changement de comportement**.

`WalletSection`, `PaymentMethodSection`, `PaymentsHistory` et `DeleteAccountSection` sont déjà
autonomes — ils sont réutilisés tels quels dans leurs onglets respectifs.

## 4. Suppressions

`components/profile/ProfileSectionNav.tsx` et `__tests__/ProfileSectionNav.test.tsx` deviennent du
code mort (la page est leur seul consommateur) → supprimés. Avec eux disparaissent :

- la variable CSS `--profile-anchor` et le `scrollMarginTop` de chaque section ;
- la mesure `ResizeObserver` de la hauteur du `ClubNav` (`headerRef` / `headerH`) ;
- le scroll-spy `IntersectionObserver`.

Les stubs jsdom de `IntersectionObserver` / `ResizeObserver` dans `jest.setup.ts` **restent** — ils
servent ailleurs.

Le retrait de la ligne « Thème » (§2) libère aussi, dans la page :

- `mode` / `setMode` de `useTheme()` — seul `th` reste utilisé ;
- l'import du type `ThemeMode`.

En revanche `Segmented` **reste** (les bascules oui/non de Préférences s'en servent) et `ThemeToggle`
**reste** (en-tête de l'hôte plateforme).

## 5. La seule ligne de backend

`backend/src/email/registry.ts:86` :

```diff
- manageUrl: club.slug ? clubAppUrl(club.slug, '/me/profile') : null,
+ manageUrl: club.slug ? clubAppUrl(club.slug, '/me/profile?tab=preferences') : null,
```

Sans ça, le lien **« Gérer mes notifications »** du pied de **tous** les emails atterrirait sur l'onglet
Identité alors qu'il vise les préférences de notification. Le test existant
(`expect(b.manageUrl).toContain('/me/profile')`) reste vert.

## 6. Tests

**Helpers purs — `frontend/__tests__/meProfile.test.ts`**
- `parseProfileTab` : défaut, valeur connue, valeur inconnue → `identite`.
- `buildProfileBody` : les 9 champs présents ; `preferredSport` objet → `preferredSportId` ; `birthDate`
  ISO complet → `YYYY-MM-DD` ; null propagés.
- `isDirty` : faux à l'identique, vrai sur chaque champ enregistré, **insensible à un retour serveur en
  ISO complet** (régression de normalisation).
- `licenceDirty`.

**Page — `frontend/__tests__/MeProfile.test.tsx` (étendu)**
- Onglets rendus, navigation, `?tab=` lu au montage et reflété au changement.
- Édition d'un champ → `SaveBar` apparaît ; `Annuler` restaure sans appel réseau.
- `save()` : PATCH profil + PATCH licence en parallèle ; échec d'une seule ressource → `saveError`, pas
  de flash de succès.
- **Régression** : une édition faite pendant que l'enregistrement est en vol n'est pas écrasée au succès.
- Avatar : upload → baseline et brouillon synchronisés, ne rend jamais dirty.
- **Règle** : l'onglet Préférences ne rend **aucun** sélecteur de thème (la ligne a quitté la carte) —
  le `ThemeToggle` de l'en-tête reste, lui, couvert par les suites existantes.

**Filets**
- `tsc --noEmit` en gate séparé (jest + ts-jest `isolatedModules` ne type-check pas).
- Vérification CDP clair + sombre, desktop 1280 + mobile 390 (onglets qui passent à la ligne, barre
  sticky lisible, aucun débordement horizontal).

## Hors périmètre

- Refonte visuelle des sections elles-mêmes (on porte la mécanique et la navigation, pas le contenu).
- Atomicité inter-ressources entre le PATCH profil et le PATCH licence.
- Persistance serveur du thème.
- Traduction de l'UI (la préférence `locale` reste stockée sans effet, comme aujourd'hui).
