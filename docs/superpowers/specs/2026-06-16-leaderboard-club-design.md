# Leaderboard club (classement des joueurs par niveau) — Design

**Date :** 2026-06-16
**Statut :** approuvé (brainstorm)
**Lot :** Lot 4 de la feature « niveau de joueur (Glicko-2) » — sous-feature 1/3

## Contexte

La feature niveau (Glicko-2, style Playtomic) est en place : modèle `PlayerRating`
(rating global par sport, `displayLevel` 0–8 dénormalisé, index `@@index([sportId, displayLevel])`
déjà prévu pour le tri), `RatingService`, matchs confirmés qui mettent à jour les niveaux,
niveau affiché partout (annuaire, events, Mes réservations) et matchmaking des parties ouvertes.

Il manque un **classement du club** : permettre aux membres de se situer les uns par
rapport aux autres. C'est la sous-feature la plus visible et la plus autonome du Lot 4.

## Décisions produit (validées)

1. **Visibilité** : tout membre **connecté** du club **voit** le classement. Un joueur
   n'y **figure** que s'il a activé l'opt-in (« apparaître dans les classements »).
   Voir ≠ être listé.
2. **Éligibilité à être classé** : opt-in activé **ET** au moins **5 matchs joués**
   (`PlayerRating.matchesPlayed >= 5`) dans le sport. En deçà, le joueur voit
   « encore X matchs pour être classé ».
3. **Emplacement** : page `/parties`, via une bascule segmentée **`Parties | Classement`**
   en tête de page. Regroupe « jouer » et « se situer ».
4. **Sport** : padel uniquement en v1 (cohérent avec le reste de l'app où `sport`
   vaut `'padel'` par défaut). Sélecteur multi-sport = évolution ultérieure (YAGNI).
5. **Opt-in désactivé par défaut** : un joueur n'apparaît jamais sans l'avoir choisi.

## Modèle de données

Un seul champ additif :

```prisma
model User {
  // …
  showInLeaderboard Boolean @default(false) @map("show_in_leaderboard")
}
```

Migration additive `add_show_in_leaderboard` (défaut `false` — rétrocompat : personne
n'apparaît tant qu'il n'a pas opté). L'opt-in est **global** (une préférence joueur,
pas par club), cohérent avec le rating global par sport : pas de flag par club à maintenir.

## Backend

### Endpoint

`GET /api/clubs/:slug/leaderboard?sport=padel` — `authMiddleware` (membre connecté requis).
Le sport défaut `'padel'` comme partout.

### Service

`RatingService.clubLeaderboard(clubId, sportKey, viewerUserId)` :

- Résout `sportId` depuis `sportKey` (helper existant).
- Récupère les `ClubMembership` du club au statut **ACTIVE** (BLOCKED/autres exclus),
  jointes au `PlayerRating` du sport.
- Classés : `showInLeaderboard = true AND matchesPlayed >= MIN_RANKED_MATCHES` (= 5),
  triés `displayLevel desc, rating desc` (départage déterministe), rang 1..N.
- Calcule `me` (situation du viewer) indépendamment de sa présence dans la liste.

### Forme de la réponse

```ts
{
  sport: 'padel',
  entries: Array<{
    rank: number;
    userId: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    level: number;          // displayLevel 0–8
    tier: string;           // palier nommé
    matchesPlayed: number;
  }>;
  me: {
    optedIn: boolean;       // User.showInLeaderboard
    ranked: boolean;        // figure dans entries
    rank: number | null;    // si ranked
    level: number | null;   // si a un rating
    matchesPlayed: number;  // 0 si pas de rating
    matchesToGo: number;    // max(0, 5 - matchesPlayed), 0 si déjà classable
  };
}
```

### Opt-in

`PATCH /api/me` accepte `showInLeaderboard: boolean` (réutilise la route profil
existante ; pattern identique à `locale`). Renvoyé dans `GET /api/me/profile`.

## Frontend

### Page `/parties`

Bascule segmentée `Parties | Classement` (composant `Segmented` existant). `OpenMatches`
reste inchangé sous l'onglet « Parties » ; nouvel onglet « Classement » rend
`components/openmatch/Leaderboard.tsx`.

### `Leaderboard.tsx`

- **Panneau « moi »** en tête, 3 états :
  - classé → « Vous êtes Ne sur N » + niveau ;
  - opt-in activé mais `matchesToGo > 0` → « Encore X matchs pour être classé » ;
  - pas opt-in → CTA **« Apparaître dans le classement »** qui bascule le flag en 1 tap
    via `api.updateMe({ showInLeaderboard: true })` puis recharge (sans quitter la page).
- **Lignes** : rang, avatar (`Avatar` — photo ou initiales teintées via `colorForSeed(userId)`),
  nom, `LevelBadge` + palier, nb de matchs. La ligne du viewer est **surlignée** (accent du club).
- **État vide** (aucun joueur éligible) : message invitant à activer l'affichage et jouer
  des matchs.

### `/me/profile`

Ajout d'un toggle « Apparaître dans les classements » à côté de langue / thème
(même `Segmented`/switch que l'existant), branché sur `showInLeaderboard`.

### API client

- `api.getClubLeaderboard(slug, token, sport?)` → typage `ClubLeaderboard`.
- `showInLeaderboard` ajouté au payload `updateMe` et au type profil.

## Tests

- **Back** `rating.service.test.ts` (bloc « leaderboard ») : tri par niveau décroissant,
  seuil 5 matchs (4 matchs exclu, 5 inclus), filtre opt-in (non opté absent), membre
  BLOCKED exclu, calcul de `me` dans ses 3 états (classé avec bon rang / `matchesToGo` /
  `optedIn=false`), départage `rating desc` à niveau égal.
- **Front** `Leaderboard.test.tsx` : rendu et ordre des lignes, surlignage du viewer,
  panneau « moi » dans ses 3 états (le CTA opt-in appelle `updateMe`), état vide.
- Helpers purs extraits si la logique d'affichage le justifie (sinon testés via le composant).

## Hors périmètre (v1)

- Sélecteur multi-sport (le club n'expose qu'un classement padel).
- Classement inter-clubs / plateforme.
- Évolution dans le temps du classement, historique de rang, badges de progression.
- Filtres (genre, tranche de niveau) sur le classement.
- Les deux autres sous-features du Lot 4 (reco « parties pour toi », corrections niveau staff)
  — specs séparées.
