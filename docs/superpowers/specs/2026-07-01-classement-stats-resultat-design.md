# Stats de résultat + classement en tête de l'onglet « Classement »

**Date :** 2026-07-01
**Statut :** Design validé

## Contexte

L'onglet **Classement** d'une partie ouverte (`frontend/components/openmatch/Leaderboard.tsx`) affiche déjà,
en tête, un bandeau « moi » sur fond accent qui résume le rang du joueur :
« Vous êtes 3ᵉ sur 12 · niveau 5.2 » (ou un message d'opt-in / « encore X matchs pour être classé »).

Le classement (rang + niveau) y est donc, mais **aucune stat de résultat** (victoires / défaites) n'est
montrée au joueur. Ces données existent (`Match` / `MatchPlayer`) et sont déjà calculées côté admin dans
`backend/src/services/memberStats.service.ts`, mais ne sont exposées nulle part côté joueur.

## Objectif

Transformer le bandeau « moi » en **carte joueur** montrant le rang **et** ses stats de résultat :

- **Victoires / Défaites** (bilan V-D)
- **Taux de victoire** (%)
- **Matchs joués**
- **Série en cours** (streak : N victoires ou N défaites d'affilée)

**Décisions de cadrage (validées) :**

- **Périmètre des V/D = ce club uniquement** (matchs `CONFIRMED` du sport sélectionné, joués dans ce club).
  Cohérent avec le contexte « classement du club » et avec la fiche membre admin.
- **Affichage dès qu'il y a des matchs** : la rangée de stats apparaît dès que `wins + losses > 0`,
  indépendamment de l'état classé / opt-in (les stats sont privées au joueur, distinctes de sa visibilité
  dans le classement).

## Approche retenue

**Enrichir l'endpoint existant** `GET /api/clubs/:slug/leaderboard` (et son service `club.service.clubLeaderboard`)
avec des champs additifs dans le payload `me`. Une seule requête `matchPlayer` supplémentaire, scopée à l'appelant.

Alternatives écartées :

- *Nouvel endpoint `/me/stats`* → plomberie + requête réseau en plus pour un gain nul (le classement est déjà chargé).
- *Réutiliser `memberStats.service`* → calcule quantité de choses inutiles (finances, heatmap, fidélité…).

**Aucune migration de base** : lecture des modèles `Match` / `MatchPlayer` existants.

## Backend

### Helper pur — `backend/src/services/rating/resultStats.ts` (nouveau)

```ts
export interface ResultStatRow { team: number; winningTeam: number | null; playedAt: Date }
export interface ResultStats { wins: number; losses: number; streak: number }

// rows triés par playedAt DÉCROISSANT (plus récent d'abord).
// streak : entier signé — +N = N victoires d'affilée en tête, -N = N défaites, 0 = aucune.
export function computeResultStats(rows: ResultStatRow[]): ResultStats { … }
```

Logique :

- `wins` / `losses` : pour chaque ligne à `winningTeam != null`, comparer `winningTeam === team`.
- `streak` : parcourir les matchs décidés du plus récent au plus ancien ; compter la suite consécutive de
  même résultat en tête ; signe + si victoires, − si défaites, `0` si aucun match décidé.

### `club.service.clubLeaderboard` (modifié)

Après le calcul actuel de `me`, ajouter une requête pour l'appelant :

```ts
const myMatches = await prisma.matchPlayer.findMany({
  where: { userId: callerUserId, match: { clubId: club.id, status: 'CONFIRMED', sport: { key: sportKey } } },
  orderBy: { match: { playedAt: 'desc' } },
  select: { team: true, match: { select: { winningTeam: true, playedAt: true } } },
});
const { wins, losses, streak } = computeResultStats(
  myMatches.map((mp) => ({ team: mp.team, winningTeam: mp.match.winningTeam, playedAt: mp.match.playedAt }))
);
```

Payload `me` enrichi (champs **additifs**) :

```ts
me = {
  optedIn, ranked, rank, level, matchesPlayed /* GLOBAL, inchangé */, matchesToGo,
  wins, losses, streak,   // ← nouveaux, club-scoped
}
```

> `matchesPlayed` reste le compteur **global** (`PlayerRating.matchesPlayed`) car il pilote le seuil
> « encore X matchs pour être classé » (`MIN_RANKED_MATCHES`). Le **« Matchs joués » affiché** côté front est
> `wins + losses` (matchs décidés de ce club), cohérent avec la ligne V/D.

## Frontend

### Types — `frontend/lib/api.ts`

`LeaderboardMe` gagne `wins: number`, `losses: number`, `streak: number` (champs requis dans le nouveau
payload ; les tests existants qui ne les fournissent pas les traitent comme `0` → pas de rangée de stats).

### `frontend/components/openmatch/Leaderboard.tsx`

Le bandeau accent « moi » devient une **carte** en deux zones :

1. **Ligne de tête (inchangée dans son contenu)** : selon l'état, la phrase de rang « Vous êtes Nᵉ sur M · niveau X »,
   ou « Encore X matchs pour être classé », ou le message + CTA « Apparaître dans le classement », ou l'état vide opté.
2. **Rangée de stats** — rendue **ssi `me.wins + me.losses > 0`**, séparée par un filet léger :
   - `{wins + losses} matchs`
   - `{winRate}% victoires` (winRate = `round(wins / (wins+losses) * 100)`, dérivé côté front)
   - `{wins} V · {losses} D`
   - **Série** : si `streak > 0` → « {streak} victoire(s) d'affilée » (couleur accent) ;
     si `streak < 0` → « {|streak|} défaite(s) d'affilée » (`ACCENTS.coral`) ; si `0` → masqué.

Maquette ASCII (indicative) :

```
┌────────────────────────────────────────────────┐
│  Vous êtes 3ᵉ sur 12  ·  niveau 5.2  Confirmé   │
│  ──────────────────────────────────────────────│
│  25 matchs    72% victoires    18 V · 7 D   3 V │
└────────────────────────────────────────────────┘
```

Style : cohérent avec l'existant (fond `th.accent` / `th.onAccent`, `th.fontUI`), pas d'emoji (on garde le
langage `Icon`/`ACCENTS`). La série colore son libellé (accent / coral) tout en restant lisible sur fond accent
— repli : afficher la série sur la ligne des stats en texte, éventuellement dans une petite pastille.

## Tests

**Backend :**

- `resultStats.test.ts` (nouveau) : série gagnante, série perdante, série mixte (streak s'arrête au 1er changement),
  aucun match décidé (`0/0/0`), matchs à `winningTeam null` ignorés, bilan V/D correct.
- `club.service.test.ts` : `clubLeaderboard` renvoie `me.wins/losses/streak` corrects (scopés club + sport),
  et le `matchesPlayed` global reste inchangé.

**Frontend :**

- `Leaderboard.test.tsx` : rangée de stats présente et correcte quand `wins+losses>0` (V/D, %, série) ;
  **absente** quand `wins+losses===0`. Les 7 tests existants (payloads sans `wins/losses`) doivent continuer à passer
  (rétro-compatibilité : champs absents → `0` → pas de rangée).

## Hors périmètre

- Stats de résultat des **autres** joueurs dans les lignes du classement (on n'enrichit que le bandeau « moi »).
- Périmètre global (multi-clubs) des V/D — explicitement club-scoped.
- Historique / courbe des résultats (déjà présent ailleurs : profil niveau, fiche membre admin).
- Toute migration ou nouveau modèle de données.

## Rétro-compatibilité

Champs strictement additifs (payload API + type front). Aucun changement de schéma DB. Le contrat de rendu
existant du bandeau (phrases de rang, CTA opt-in, état vide) est préservé mot pour mot.
