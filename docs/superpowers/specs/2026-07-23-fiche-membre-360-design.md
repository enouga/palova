# Fiche membre 360° — profil éditable + cockpit (design)

**Date** : 2026-07-23 · **Statut** : validé par Eric (brainstorming avec maquettes comparées dans le companion visuel)

## Contexte

Aujourd'hui, la partie membre de l'admin a trois défauts :

1. **Des infos manquent** : l'adresse et la ville n'existent nulle part en base (ni `User`, ni `ClubMembership`).
2. **L'édition est éclatée et limitée** : l'admin ne peut éditer que téléphone / n° adhérent / note / abonné, dans le panneau latéral de la liste (`MemberPanel.tsx`). La fiche `/admin/members/[userId]` est en lecture seule, découpée en 5 onglets (Activité, Finances, Niveau, Fidélité, Notes) jugés trop longs à parcourir.
3. **Rien d'important n'est visible d'un coup** : pas de vue synthétique du joueur (abonnement, dernières parties, paiements, à venir).

## Décisions de cadrage (validées)

- **L'adresse vit sur le compte joueur** (`User`), comme le téléphone : une seule vérité, le joueur la voit et l'édite dans son profil, l'admin peut la saisir/corriger. Champs : `address`, `city`, `postalCode`.
- **L'admin édite tout sauf l'email** : prénom, nom, téléphone, adresse, CP, ville, date de naissance, sexe, n° de licence. L'email reste l'identifiant de connexion, modifiable par le joueur seul. Légal (RGPD) : le club est responsable de traitement de son fichier d'adhérents, l'exactitude des données est une obligation ; le membre garde le droit de regard/rectification via son profil.
- **La fiche `/admin/members/[userId]` devient un cockpit 360°** (maquette « v2 » validée) : tout l'important visible d'un coup, les gros tableaux/graphiques deviennent « du plus ».
- **Le panneau latéral `MemberPanel` disparaît** : cliquer un membre dans la liste navigue directement vers la fiche. Toutes ses fonctions migrent dans le cockpit.
- **Carte Niveau retirée** du cockpit (chip « Niv. x,x » dans le hero suffit ; la correction de niveau part dans le « plus »). À la place, une **grande carte « Dernières réservations »** détaillée, **annulations comprises**.

## Données (migration additive `add_user_address`)

```prisma
model User {
  address     String? // rue (texte libre)
  postalCode  String? @map("postal_code")
  city        String?
}
```

Aucun backfill. DEV : `prisma db execute` du SQL additif (jamais `db push` — dérive de base connue) ; prod : `migrate deploy`.

**Confidentialité** : le tableau finalités × données de la politique de confidentialité (`frontend/lib/platformContent.ts`) mentionne l'adresse postale ; bump mineur de `PRIVACY` dans `LEGAL_VERSIONS` (front + miroir back) → bandeau non bloquant « J'ai compris » existant.

## Backend

### 1. Édition admin élargie — `ClubService.updateMembership` (route PATCH existante)

Params additifs : `firstName`, `lastName`, `birthDate` (`YYYY-MM-DD` ou null), `sex` (`M`/`F`/null), `address`, `postalCode`, `city` — écrits sur `User` (même mouvement que `phone`, déjà écrit là). Trim, chaîne vide → null, `birthDate` invalide → `VALIDATION_ERROR` 400. `email` jamais accepté. `firstName`/`lastName` : refusés vides si fournis (un compte doit garder un nom).

**Traçabilité** : quand un appel staff modifie au moins un champ du compte joueur (identité/coordonnées), une `MemberNote` automatique est créée (best-effort, jamais bloquante) : « ✎ Profil modifié : téléphone, adresse » avec `authorId` = staff appelant. Le journal de notes existant sert d'audit, aucun nouveau modèle.

### 2. Le joueur édite aussi ses nouveaux champs

`PATCH /api/me` + `PROFILE_SELECT` acceptent/exposent `address`, `postalCode`, `city`. Front : onglet Identité de `/me/profile` (3 champs dans `buildProfileBody` — ⚠️ invariant existant : tout champ éditable DOIT y figurer sinon silencieusement non-sauvé).

### 3. `MemberStatsService.getMemberHistory` enrichi (additif)

- **`member`** : + `membershipId` (id d'adhésion — les routes d'édition existantes le prennent en paramètre), `phone`, `birthDate`, `sex`, `address`, `postalCode`, `city`, `staffRole`, `isCoach`, `isReferee`, `note` (le cockpit édite tout depuis cette seule réponse — plus besoin de `listMembers` pour la fiche).
- **`reservations`** : chaque ligne gagne `participants` avec **noms** (`firstName lastName` — le select actuel n'a que les ids), le **résultat de match** s'il existe (`match: { status, winnerTeam, sets, competitive } | null` via la relation Match↔Reservation, matchs non annulés seulement) et le **type** déjà présent (COURT/COACHING/TOURNAMENT/EVENT). Les états dérivés (payé/reste dû/annulée tardive) existent déjà.
- **Nouveau bloc `upcoming`** : prochaines échéances du membre au club — réservations futures (déjà dans `reservations`, mais listées à part triées ascendant), inscriptions **tournois** et **events** à venir non annulées (nom, date, statut confirmé/attente), **cours** à venir. Cap ~5 entrées, tri chronologique.
- **Nouveau bloc `subscription`** : abo actif complet (miroir du select `Member.subscription` de `listMembers` : plan, échéance, prix snapshot) — pour la carte Abonnement avec ses actions.

## Frontend

### 4. Liste `/admin/members` : clic = navigation

`MemberRow.onOpen` navigue vers `/admin/members/[userId]` (plus d'état `selectedUserId`). **`MemberPanel.tsx` est supprimé** (avec sa suite de tests) ; la page perd les callbacks d'édition (save/setRole/…) qui migrent dans la fiche. L'ajout de membre (`addOpen`), l'export CSV, les segments/filtres/recherche, le contexte abonnés (`SubscriberInsights`) restent inchangés.

### 5. Fiche cockpit `/admin/members/[userId]` (refonte)

Layout **2 colonnes** dès ~900 px (classes CSS pures `.mb-*` dans `globals.css`, pas de `useIsDesktop` — pas de flash), une colonne empilée en mobile. De haut en bas :

- **Hero identité** : avatar, nom, chips (Actif/Bloqué, Abonné, Niv. x,x si système actif, 👁 À surveiller), email cliquable `mailto:` + téléphone cliquable `tel:`, « membre depuis {date} ».
- **Bandeau d'alertes** (dérivé client, masqué si vide) : reste dû > 0, carnet presque vide (≤ 2 entrées), abonnement expire < 30 j.
- **Colonne gauche** : **Profil — éditable** (prénom, nom, tél, adresse, CP+ville sur une ligne, naissance, sexe, n° licence ; brouillon local + bouton Enregistrer → PATCH admin ; l'email affiché non modifiable) · **Rôle & accès** (Segmented Membre/Staff/Admin, cases Coach & Juge-arbitre, case Abonné résa élargie, Bloquer/Débloquer, Supprimer — mêmes contrôles, gardes et confirmations que l'actuel `MemberPanel` : `canManageStaff`, jamais sur soi ni sur le gérant) · **Contact** (email/tél cliquables ; le bouton « ✉ Envoyer un message » arrive avec la spec messages ciblés — placeholder absent d'ici là) · **Notes du staff** (fil + ajout + suppression, repris de l'onglet Notes).
- **Colonne droite** : **À venir** (bloc `upcoming`) · **Abonnement & soldes** (abo + échéance + actions Renouveler/Changer/Résilier via `SubscriptionActions` existant ; soldes carnets/porte-monnaie + Recharger via `PackageBalanceDialog` existant) · **Dernières réservations** (grande carte, ~5 lignes riches : date + créneau + terrain + tag type, participants en prénoms, paiement — Payé ✓ vert / Reste dû coral / Carnet −1 —, résultat V/D + score si match saisi, **annulées estompées** avec mention « tardive » ; lien « Tout l'historique → ») · **Paiements** (reste dû en gros display coral, total dépensé, lien « Encaisser → » vers `/admin/reservations?q={nom}`) · **Fidélité & habitudes** (fréquence/mois, dernière visite, taux d'annulation + tardives, terrain/jour favoris).
- **Le « plus »** : rangée d'onglets en bas de page — Activité & historique complet (tableau + filtre tardives), Finances (graphes 12 mois + méthodes), Heatmap présence, Niveau & correction (`LevelOverrideForm`/courbe, gate ADMIN inchangé), — contenus repris tels quels de la page actuelle.

Helpers purs testés dans `frontend/lib/memberStats.ts` (alertes, libellés de lignes de résa, format upcoming). Aucun `new Date()` au rendu (horloge posée en effet — hydration).

## Tests

- Backend : `club.service` (updateMembership élargi : écriture User, validations, note automatique, email refusé), `memberStats.service` (participants nommés, match, upcoming, subscription), `me.routes` (address/city/postalCode).
- Frontend : `memberStats` (helpers alertes/lignes), fiche réécrite (`MemberHistory.test.tsx` : cockpit, édition profil, rôle & accès migré, alertes, dernières résas avec annulations), `AdminMembersFilters`/liste (navigation au clic, panneau disparu), `MeProfile` (3 nouveaux champs).
- Vérification visuelle CDP clair + sombre, desktop 1280 + mobile 390 (aucun débordement horizontal).

## Hors périmètre

Édition de l'email · export de la fiche · amis/social du joueur sur la fiche (données privées entre joueurs) · messages ciblés (spec dédiée `2026-07-23-messages-cibles-membres-design.md`) · SMS · historique des modifications au-delà de la note automatique.
