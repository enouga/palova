# Cartes de match enrichies — « Mes réservations › Matchs »

**Date :** 2026-06-22
**Statut :** Design validé

## Problème

Dans `/me/reservations`, onglet **Matchs**, chaque carte n'affiche que le score
(`6-3 / 6-4`), le statut (`Victoire`, `En attente de confirmation`…) et la date.
Impossible de se rappeler **de quel match il s'agit** : ni les joueurs, ni le
club, ni le terrain, ni l'heure.

## Objectif

Enrichir chaque carte avec toutes les infos qui permettent d'identifier la
partie : **partenaire et adversaires**, **date + heure**, **club**, **terrain +
sport**. Conserver le résultat (Victoire/Défaite/…) et les actions
Confirmer/Contester.

## Périmètre

- **Aucune migration.** Toutes les données existent déjà en base (relations
  `Match.players` / `club` / `sport` / `reservation.resource`). Le seul manque
  est qu'elles ne sont pas exposées par l'endpoint ni rendues par le composant.
- Pas de nouvelle navigation : la carte reste **statique** (pas de lien vers un
  détail).

## Conception

### 1. Backend — `GET /api/me/matches` (`backend/src/routes/me.ts`)

Élargir le `select` de `matchPlayer.findMany` pour charger, par match :

- `match.players` → `{ userId, team, user: { firstName, lastName } }` (les 4 joueurs)
- `match.club` → `{ name }`
- `match.sport` → `{ name }`
- `match.reservation.resource` → `{ name }` (la réservation est optionnelle ⇒
  `resource` peut être `null`)

`playedAt` est déjà un `DateTime` complet : l'heure est donc déjà transmise, rien
à ajouter pour la date/heure.

Le mapper de réponse ajoute les champs :

```ts
players: r.match.players.map((p) => ({
  userId: p.userId,
  team: p.team,
  firstName: p.user.firstName,
  lastName: p.user.lastName,
})),
club: { name: r.match.club.name },
sport: { name: r.match.sport.name },
resource: r.match.reservation?.resource
  ? { name: r.match.reservation.resource.name }
  : null,
```

La forme existante des champs (`matchId`, `status`, `sets`, …) est **inchangée**
(ajout additif uniquement).

### 2. Type `MyMatch` (`frontend/lib/api.ts`)

Ajouter :

```ts
players: { userId: string; team: number; firstName: string; lastName: string }[];
club: { name: string };
sport: { name: string };
resource: { name: string } | null;
```

### 3. Composant `MyMatchesList` (`frontend/components/match/MyMatchesList.tsx`)

Refonte de la carte. À partir de `m.players` et `m.myTeam` :

- **Mon équipe** = joueurs de `team === myTeam`, **moi exclu** → le **partenaire**.
  - « moi » est repéré comme le joueur dont l'identité correspond à l'utilisateur
    connecté. Le payload n'expose pas explicitement « moi » ; on identifie le
    partenaire comme l'autre joueur de `myTeam`. (Padel = 2v2 ⇒ 1 partenaire.)
- **Équipe adverse** = joueurs de `team !== myTeam` → les **adversaires**.

Rendu :

- **Ligne 1** : score (`scoreLine(m.sets)`) à gauche, **badge résultat** à droite
  — `Victoire` (accent positif) / `Défaite` (sobre) / `En attente de confirmation`
  / `En litige` / `Annulé`. Logique W/L existante (`won = winningTeam === myTeam`).
- **Partenaire** : « Avec » + pastille colorée du joueur.
- **Adversaires** : « Contre » + pastilles colorées des adversaires.
- **Méta** : `playedAt` formaté **date + heure** en `fr-FR` (ex.
  `20/06/2026 à 18:30`) · sport. Puis club · terrain (terrain omis si `null`).
- **Actions** : boutons Confirmer / Contester si `needsMyConfirmation`
  (inchangés).

**Pastilles colorées** : réutiliser `Avatar` (`components/ui/Avatar.tsx`, prop
`color`) + `colorForSeed(userId)` de `lib/playerColors.ts`, comme `OpenMatches`.
Cohérent avec le reste de l'app, déterministe par joueur.

### Gestion des cas limites

- `resource === null` (match sans réservation liée) : on n'affiche pas le terrain,
  seulement le club.
- Équipe incomplète (données partielles) : on rend ce qu'on a sans planter
  (`partner` peut être absent, `opponents` une liste).

## Tests

- **Frontend** `frontend/__tests__/MyMatchesList.test.tsx` : la carte affiche le
  partenaire, les adversaires, le club, le terrain, l'heure ; badge Victoire vs
  Défaite ; boutons présents seulement si `needsMyConfirmation`.
- **Backend** `backend/src/routes/__tests__/me.routes.test.ts` (ou bloc existant
  des matchs) : la réponse de `/api/me/matches` contient `players`, `club`,
  `sport`, `resource`.

## Hors périmètre

- Lien/clic vers une fiche de partie ou de réservation.
- Filtres ou tri supplémentaires de l'onglet Matchs.
- Toute modification de base de données.
