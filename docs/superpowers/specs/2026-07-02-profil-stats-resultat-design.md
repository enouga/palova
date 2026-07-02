# Stats de résultat dans « Mon niveau » (`/me/profile`)

**Date :** 2026-07-02
**Statut :** Design validé

## Contexte

La page profil `/me/profile` (`frontend/app/me/profile/page.tsx`) a une section **« Mon niveau · Padel »**
(`<section id="niveau">`) qui affiche, quand le joueur a un niveau calibré : un `LevelBadge` +
une courbe de progression `LevelHistoryChart`. Ces deux briques sont **globales** (le niveau `PlayerRating`
est global tous clubs ; l'historique `GET /api/me/rating/history` filtre par sport + `CONFIRMED`, **pas** par club).

Le bilan victoires/défaites d'un joueur n'est **pas** affiché ici — il n'existe aujourd'hui que côté admin
(`memberStats.service.ts`, page fiche membre). On veut l'exposer au joueur sur son propre profil.

Le helper pur **`computeResultStats`** (bilan V/D + série signée, tri défensif par `playedAt`) existe déjà
(`backend/src/services/rating/resultStats.ts`), livré avec la feature « stats de résultat du classement ».

> **Dépendance de branche :** `computeResultStats` est dans la PR #29 (pas encore mergée dans `main`).
> Cette feature se construit **en continuité de la branche du classement** (`worktree-emails-personnalisables`),
> qui contient déjà le helper.

## Objectif

Sous le `LevelBadge`, afficher une rangée de stats de résultat **scopées au club courant** (padel) :

- **Matchs joués** (= V + D décidés)
- **Taux de victoire** (%)
- **Victoires / Défaites** (V-D)
- **Série en cours** (streak signé)

**Décisions de cadrage (validées) :**

- **Périmètre = club courant** (comme le classement), PAS global. Comme le niveau et l'historique de la même
  carte sont globaux, la rangée porte une **légende explicite « Résultats · {nom du club} »** pour lever
  l'ambiguïté de périmètre.
- **Affichage conditionnel** : rendue seulement si (a) on est sur un **hôte club** où le joueur est **membre actif**
  (sinon pas de club courant → pas de stats), ET (b) il y a au moins un match décidé (`wins + losses > 0`).
  Sur l'hôte plateforme ou pour un non-membre, la section niveau reste inchangée (badge + historique globaux),
  sans rangée de stats.
- Indépendant de l'opt-in classement : ce sont les stats privées du joueur (calculées quel que soit
  `showInLeaderboard`).

## Approche retenue (A)

**Endpoint dédié léger** + **helper backend partagé** + **composant frontend partagé**.

Alternative écartée (B) : réutiliser `GET /api/clubs/:slug/leaderboard` et lire `me.wins/losses/streak`.
Rejetée car elle renvoie tout le classement (potentiellement des dizaines d'entrées) pour 3 chiffres, et couple
le profil au classement.

**Aucune migration DB** : lecture des `Match`/`MatchPlayer` existants.

## Backend

### Helper partagé — extraction depuis `clubLeaderboard`

Aujourd'hui `ClubService.clubLeaderboard` fait inline la requête `matchPlayer` + `computeResultStats`. On extrait
cette logique dans un helper réutilisable (même fichier `club.service.ts`, méthode privée, ou petit module) :

```ts
// Bilan V/D + série d'un joueur pour un club + sport donnés (matchs CONFIRMED).
async function computeClubMatchStats(clubId: string, userId: string, sportId: string): Promise<ResultStats> {
  const rows = await prisma.matchPlayer.findMany({
    where: { userId, match: { clubId, status: 'CONFIRMED', sportId } },
    orderBy: { match: { playedAt: 'desc' } },
    select: { team: true, match: { select: { winningTeam: true, playedAt: true } } },
  });
  return computeResultStats(rows.map((mp) => ({ team: mp.team, winningTeam: mp.match.winningTeam, playedAt: mp.match.playedAt })));
}
```

`clubLeaderboard` est refactoré pour appeler ce helper (au lieu de la requête inline) — supprime la future
duplication. La parallélisation existante (`Promise.all([meUser, …])`) est préservée.

### Nouvelle méthode service + route

- `ClubService.myClubMatchStats(slug, userId, sportKey = 'padel')` : résout le club (ACTIVE, sinon `CLUB_NOT_FOUND`),
  exige une adhésion **ACTIVE** (sinon `MEMBERSHIP_REQUIRED`), résout le sport par clé (sinon `SPORT_NOT_FOUND`),
  puis retourne `computeClubMatchStats(club.id, userId, sport.id)` → `{ wins, losses, streak }`.
- Route **`GET /api/clubs/:slug/me/match-stats?sport=padel`** (derrière `authMiddleware`), à côté des autres
  routes `/:slug/me/*` (membership, packages, payment-method…). `sport` optionnel, défaut `padel`.

## Frontend

### Composant présentation partagé `ResultStats`

Nouveau `frontend/components/player/ResultStats.tsx` (présentation pure) :

```ts
interface ResultStatsProps { wins: number; losses: number; streak: number; tone: 'onAccent' | 'onSurface'; }
```

Rend une rangée en flex-wrap : `{decided} match(s)` · `{rate}% de victoires` · `{wins} V · {losses} D` +
pastille de série (si `streak !== 0`) « {n} victoire(s)/défaite(s) d'affilée ». `rate` via le helper
`winRate` de `lib/memberStats`. La prop **`tone`** choisit les couleurs :

- `onAccent` (classement, sur fond `th.accent`) : texte `th.onAccent`, pastille victoire = fond `th.onAccent`/texte `th.accent`, défaite = fond `ACCENTS.coral`/texte `#fff`.
- `onSurface` (profil, sur carte normale) : texte `th.text`/`th.textMute`, pastille victoire = fond `th.accent`/texte `th.onAccent`, défaite = fond `ACCENTS.coral`/texte `#fff`.

Ne rend **rien** si `wins + losses === 0` (le parent peut aussi garder).

`Leaderboard.tsx` est refactoré pour utiliser `<ResultStats tone="onAccent" … />` à la place de sa rangée inline
(la logique de gating `decided > 0` reste dans le bandeau « moi »).

### API + page profil

- `api.getMyClubMatchStats(slug, token, sport?)` → `{ wins, losses, streak }` (type `ClubMatchStats`).
- Dans `page.tsx` : nouvel état `matchStats`. Effet de chargement gardé par `token` + `club?.slug` +
  `ratingSport` + section niveau visible ; si pas de `club.slug` (hôte plateforme) on ne fetch pas. Erreur
  (403 non-membre, etc.) → `matchStats = null` (best-effort, silencieux).
- Rendu dans `<section id="niveau">`, sous le `LevelBadge` (dans la branche `rating && rating.level != null`),
  au-dessus de l'historique : si `matchStats && matchStats.wins + matchStats.losses > 0`, afficher une petite
  légende « Résultats · {club.name} » puis `<ResultStats tone="onSurface" {...matchStats} />`.

## Tests

**Backend :**
- `club.service.test.ts` : `myClubMatchStats` — renvoie `{wins,losses,streak}` corrects (scopé club+sport+CONFIRMED),
  `MEMBERSHIP_REQUIRED` pour un non-membre, `CLUB_NOT_FOUND`/`SPORT_NOT_FOUND`. `clubLeaderboard` toujours vert
  après refactor (mêmes assertions).
- Route : `GET /:slug/me/match-stats` — 200 avec le payload, 401 sans token (mirror des tests `/me/*` existants).

**Frontend :**
- `ResultStats.test.tsx` : rendu V/D, `%`, pluriel matchs, série gagnante/perdante (texte + pastille), rien si 0.
- `MeProfile.test.tsx` : rangée présente quand `getMyClubMatchStats` renvoie des matchs sur un hôte club ;
  absente si 0 match ou pas de club courant (mock `useClub` slug null). ⚠️ toute suite montant ce composant doit
  mocker `api.getMyClubMatchStats`.
- `Leaderboard.test.tsx` : reste vert après passage à `<ResultStats>` (mêmes assertions de texte).

## Hors périmètre

- Périmètre global (multi-clubs) des V/D sur le profil — explicitement club-scoped.
- Stats par sport autre que padel (la section niveau est padel-only aujourd'hui).
- Stats de résultat sur les fiches d'autres joueurs.
- Toute migration ou nouveau modèle.

## Rétro-compatibilité

Champs/endpoint/composant strictement additifs. Le refactor de `clubLeaderboard` et de la rangée du classement
préserve le comportement observable (tests existants inchangés dans leurs assertions). Aucun changement de schéma DB.
