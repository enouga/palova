# Tournois padel — tableaux, TMC, scores & classement (v2 du module tournois) — Design

> Spec validée le 2026-07-07. Le module tournois (v1 : inscriptions, cf.
> `2026-06-03-tournois-padel-design.md`) gagne un **moteur de compétition** : composition
> des poules/tableaux à partir des inscrits, formats **TMC 12/16/24** (le format roi en
> club), **poules + tableau** et **élimination directe**, saisie des scores par le staff,
> progression automatique et classement final. **Padel uniquement.**

## 1. Objectif & périmètre

Un club fait vivre son tournoi de bout en bout dans Palova : inscriptions (existant) →
composition seedée par le **poids des paires** → matchs → scores → classement final visible
par tous sur la fiche tournoi.

**Dans le périmètre :**
- Formats : `TMC` (12, 16 ou 24 équipes — personne n'est éliminé, chaque équipe joue
  4 matchs, 5 en TMC 24), `POOLS_KNOCKOUT` (poules puis tableau), `KNOCKOUT` (tableau seul).
- Composition automatique proposée (têtes de série par poids de paire saisi par le staff,
  serpentin pour les poules) + **retouche manuelle** avant lancement.
- Saisie des scores par le **staff seul** (table de marque fait foi), corrections gardées.
- Progression automatique (vainqueur/perdant routés), classements de poule, classement final.
- Fiche joueur publique : poules, tableau, résultats, classement, podium (lecture seule).
- Page admin de composition + pilotage, pensée mobile.

**Hors périmètre (v3+) :**
- Planning/blocage de terrains (le `ReservationType.TOURNAMENT` reste réservé à ce futur).
- Impact sur le rating interne des joueurs.
- Saisie des scores par les joueurs, confirmation/litige.
- Consolante dédiée, double élimination (le moteur routé les permettra sans migration).
- Notifications « votre match approche », mode TV, export FFT.
- Sports autres que le padel.

## 2. Décisions clés (issues du brainstorming)

| Sujet | Décision |
|---|---|
| Sport | **Padel uniquement** (garde serveur + gating UI sur `clubSport.sport.key === 'padel'`) |
| Formats v1 | **TMC 12/16/24** + poules+tableau + tableau seul |
| Scores | **Staff seul** (OWNER/ADMIN/STAFF), pas de flux joueur |
| Planning terrains | **Hors v1** |
| Seeding | **Poids de la paire saisi par le staff** à la composition (`TournamentRegistration.seedWeight`), pas de champ FFT sur le profil ; sans poids → rating interne moyen puis ordre d'inscription |
| Composition | Proposée par le moteur, **retouchable** (poules, slots, poids) tant que non lancée |
| Rating interne | **Aucun impact** |
| Architecture | **Moteur générique routé** : un seul `TournamentMatch` avec routage `winnerTo`/`loserTo` + poules réutilisables (qualificatives ou triangulaires de classement) |
| Effectif TMC | **Strict** : 12, 16 ou 24 équipes confirmées, sinon refus avec message |

## 3. Modèle de données (Prisma — migration additive `add_tournament_draw`)

Aucune colonne existante modifiée. Appliquer en DEV via `prisma db execute` du SQL additif
(base dev en dérive — jamais `migrate dev`), en prod `prisma migrate deploy`.

### Nouveaux enums
```prisma
enum TournamentFormat { KNOCKOUT POOLS_KNOCKOUT TMC }
enum DrawStatus { NONE COMPOSING RUNNING COMPLETED }
enum TournamentMatchPhase { POOL MAIN }
enum PoolSourceOutcome { WINNER LOSER }
```

### `Tournament` (ajouts)
```prisma
format     TournamentFormat? // null = pas encore configuré
drawStatus DrawStatus        @default(NONE)
drawConfig Json?             // POOLS_KNOCKOUT: { poolSize: 3|4|5, qualifiedPerPool: 1|2 } ; autres: {}
```
`drawStatus` est **indépendant** du `status` d'inscription existant (DRAFT/PUBLISHED/CANCELLED).

### `TournamentRegistration` (ajout)
```prisma
seedWeight Int? @map("seed_weight") // poids de la paire (points FFT), saisi par le staff
```

### `TournamentPool`
```prisma
model TournamentPool {
  id           String    @id @default(cuid())
  tournamentId String    @map("tournament_id")
  name         String                     // "Poule A", "Places 4-6"…
  position     Int                        // ordre d'affichage
  rankOffset   Int?      @map("rank_offset") // null = qualificative ; n = classement, décide les places n..n+taille-1
  closedAt     DateTime? @map("closed_at")   // qualificative clôturée (classement figé, tableau rempli)

  tournament Tournament           @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  teams      TournamentPoolTeam[]
  matches    TournamentMatch[]

  @@index([tournamentId, position])
  @@map("tournament_pools")
}
```

### `TournamentPoolTeam`
```prisma
model TournamentPoolTeam {
  id             String             @id @default(cuid())
  poolId         String             @map("pool_id")
  position       Int                               // 1..taille (sert d'ordre ET de référence aux matchs de poule)
  registrationId String?            @map("registration_id") // null tant que la source n'est pas résolue
  seed           Int?                              // tête de série globale (affichage)
  sourceMatchId  String?            @map("source_match_id") // triangulaire de classement : équipe issue d'un match
  sourceOutcome  PoolSourceOutcome? @map("source_outcome")

  pool         TournamentPool          @relation(fields: [poolId], references: [id], onDelete: Cascade)
  registration TournamentRegistration? @relation(fields: [registrationId], references: [id], onDelete: Restrict)

  @@unique([poolId, position])
  @@map("tournament_pool_teams")
}
```

### `TournamentMatch` — la table centrale
```prisma
model TournamentMatch {
  id           String               @id @default(cuid())
  tournamentId String               @map("tournament_id")
  phase        TournamentMatchPhase // POOL | MAIN
  poolId       String?              @map("pool_id")   // si match de poule
  round        Int                                    // 1..N (journée de poule ou tour)
  position     Int                                    // slot dans le tour
  label        String?                                // "R1", "Places 5-6", "Poule A – J2"…

  teamARegistrationId String? @map("team_a_registration_id")
  teamBRegistrationId String? @map("team_b_registration_id")
  slotSources         Json?   @map("slot_sources") // { a?: {poolId, rank}|{poolId, position}, b?: idem } — sources de poule ; les sources "match" sont implicites via le routage amont

  // routage (moteur générique) — pas de FK, résolu par le moteur sur l'ensemble des matchs du tournoi
  winnerToMatchId String? @map("winner_to_match_id")
  winnerToSlot    Int?    @map("winner_to_slot") // 1 = slot A, 2 = slot B
  loserToMatchId  String? @map("loser_to_match_id")
  loserToSlot     Int?    @map("loser_to_slot")

  // rangs terminaux (matchs de classement d'un tableau/TMC)
  winnerRank Int? @map("winner_rank") // finale : 1 ; "Places 5-6" : 5…
  loserRank  Int? @map("loser_rank")

  // résultat (saisi par le staff ; scoré ⇔ winner != null)
  sets        Json?     // [[6,3],[4,6],[10,7]] — 1 à 3 manches, entiers 0..99
  winner      Int?      // 1 | 2
  forfeitTeam Int?      @map("forfeit_team") // 1 | 2 — l'équipe forfait (winner = l'autre)
  playedAt    DateTime? @map("played_at")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tournament Tournament              @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  pool       TournamentPool?         @relation(fields: [poolId], references: [id], onDelete: Cascade)
  teamA      TournamentRegistration? @relation("MatchTeamA", fields: [teamARegistrationId], references: [id], onDelete: Restrict)
  teamB      TournamentRegistration? @relation("MatchTeamB", fields: [teamBRegistrationId], references: [id], onDelete: Restrict)

  @@index([tournamentId, phase, round, position])
  @@index([poolId])
  @@map("tournament_matches")
}
```

**Invariants** (garantis par le moteur, pas par le schéma) : un slot est rempli par
exactement une source (seeding initial, routage amont, ou `slotSources` poule) ; le graphe
de routage est acyclique ; `forfeitTeam != null ⇒ winner = l'autre équipe`.

## 4. Le moteur — fonctions pures `backend/src/services/tournamentDraw/`

Tout l'algorithmique est **pur et sans DB** (entrées/sorties = structures en mémoire),
testable exhaustivement. Le service (§5) ne fait que persister et transactionner.

- **`seedTeams(registrations)`** → liste ordonnée : `seedWeight` décroissant, puis rating
  interne moyen du binôme décroissant, puis `createdAt` d'inscription.
- **`composePools(teams, poolCount)`** → répartition **serpentin** (1→A,2→B,3→C,3bis→C,…).
- **`generatePoolMatches(pool)`** → round-robin (**tables de Berger** : les journées
  s'entrelacent) ; matchs `phase POOL`, slots sourcés par `{poolId, position}`.
- **`generateKnockout(teams)`** → taille de tableau = puissance de 2 supérieure, placement
  standard des têtes de série (1 vs plus faible, 2 à l'opposé…), **byes** automatiques
  (slot vide → l'équipe passe, propagée à la génération), routage `winnerTo` intégral,
  finale `winnerRank 1 / loserRank 2`, demi-finalistes perdants = 3 ex aequo, etc.
  (pas de petite finale en v1).
- **`generateBracketFromPools(pools, qualifiedPerPool)`** → tableau `MAIN` dont les slots
  sont sourcés `{poolId, rank}` (affichage « 1er Poule A vs 2e Poule B » avant clôture),
  croisement standard (1er A vs 2e B…).
- **`generateTMC(teams)`** → grilles par taille, chaque match terminal porte ses rangs :
  - **TMC 16** (routage pur, 4 matchs/équipe, 32 matchs) : R1 = 8 matchs seedés ;
    vainqueurs et perdants routés tour après tour (arbres W/L croisés) ; R4 = 8 matchs de
    classement (places 1-2, 3-4, …, 15-16).
  - **TMC 12** (4 matchs/équipe, 24 matchs) : R1 = 6 matchs seedés ; R2 = 6 matchs
    (vainqueurs entre eux, perdants entre eux) ; puis **4 triangulaires de classement**
    (poules de 3 à `rankOffset` 1, 4, 7, 10) alimentées par `sourceMatchId/sourceOutcome`
    depuis les matchs de R2.
  - **TMC 24** (5 matchs/équipe, 60 matchs) : R1 = 12 matchs ; R2 = 12 (moitiés W/L) ;
    R3 = 12 (quarts de 6) ; puis **8 triangulaires** (`rankOffset` 1, 4, 7, …, 22).
- **`propagateResult(matches, pools, matchId)`** → remplit les slots routés
  (`winnerTo`/`loserTo`) et les `TournamentPoolTeam` sourcés ; si une triangulaire de
  classement devient complète, ses matchs de poule reçoivent leurs équipes.
- **`resetDownstream(matches, pools, matchId)`** → vide tout ce que ce résultat avait
  propagé (inverse exact de `propagateResult`).
- **`poolStandings(pool, matches)`** → classement de poule : 1) victoires,
  2) confrontation directe (2 ex aequo), 3) différence de manches, 4) différence de jeux,
  5) position initiale. **Forfait = victoire 6-0 6-0** pour tous les décomptes.
- **`finalRanking(tournament)`** → classement 1→N : rangs terminaux (`winnerRank`/
  `loserRank`), classements des triangulaires (`rankOffset`), et pour POOLS_KNOCKOUT les
  non-qualifiés groupés par rang de poule après les joueurs du tableau.

**Validation d'effectif à la composition** (équipes `CONFIRMED` uniquement) :
`TMC` ∈ {12, 16, 24} (`TMC_SIZE_INVALID`) · `POOLS_KNOCKOUT` ≥ 6 · `KNOCKOUT` ≥ 4.

## 5. Cycle de vie & service `TournamentDrawService`

```
NONE ──configure/compose──▶ COMPOSING ──start──▶ RUNNING ──dernier score──▶ COMPLETED
                              ▲     │ retouches                │
                              └─────┘ recompose                └──reset (confirmation)──▶ COMPOSING
```

Toutes les mutations en **transaction Serializable + `SELECT … FOR UPDATE` sur la ligne
tournoi** (pattern des inscriptions).

- **`configureDraw`** (`NONE`/`COMPOSING`) : format + config. Garde padel
  (`NOT_PADEL_TOURNAMENT`).
- **`composeDraw`** : (re)génère la proposition — supprime pools/matchs existants et
  recrée (idempotent). Les retouches précédentes sont perdues (l'UI prévient).
- **`updateComposition`** (`COMPOSING`) : `weights` (liste `{registrationId, seedWeight}`
  — persistés sur l'inscription), `swapPoolTeams` (échange deux équipes de poules),
  `swapSlots` (échange deux slots du tableau/R1). Les échanges ne re-seedent pas.
- **`startDraw`** : vérifie que chaque slot/poule attendu est rempli → `RUNNING`.
  Dès lors : `adminPromoteRegistration`/`adminRemoveRegistration`/`changePartner` refusés
  **409 `DRAW_RUNNING`** (pendant `COMPOSING`, autorisés mais la réponse du GET draw
  signale `compositionStale: true` → bandeau « recomposer »).
- **`enterScore(matchId, { sets?, winner, forfeitTeam? })`** : équipes présentes requises
  (`MATCH_NOT_READY`), 1-3 manches d'entiers 0..99, `winner` ∈ {1,2}. Correction d'un
  score déjà propagé : autorisée **ssi aucun match aval touché n'est déjà scoré**, sinon
  **409 `DOWNSTREAM_SCORED`** (il faut effacer l'aval d'abord — jamais de corruption
  silencieuse) ; idem pour une poule qualificative déjà clôturée (**409 `POOL_CLOSED`**).
  Repropagation automatique après correction. Dernier match scoré → `COMPLETED`.
- **`clearScore(matchId)`** : mêmes gardes, efface + `resetDownstream`.
- **`closePools`** (`POOLS_KNOCKOUT`) : tous les matchs de poules qualificatives scorés →
  fige les classements (`closedAt`) et remplit les slots du tableau. Les triangulaires de
  classement (TMC) se clôturent **automatiquement** à leur dernier score.
- **`resetDraw`** (`RUNNING`/`COMPLETED`) : efface scores et propagation, retour
  `COMPOSING` (soupape de secours ; l'UI exige une confirmation forte).
- **`getDraw`** (admin) / **`getPublicDraw`** : projection complète — config, poules +
  classements calculés, matchs (équipes résolues avec noms + libellés de source pour les
  slots vides), classement final si `COMPLETED`.
- Tournoi annulé (`status CANCELLED`) pendant `RUNNING` : draw **gelé en lecture** (toute
  mutation → 409 `TOURNAMENT_CANCELLED`).

## 6. API

**Admin** (`admin.ts`, sous `/api/clubs/:clubId/admin/tournaments/:id/draw`, staff existant) :
- `GET /draw` — état complet (+ `compositionStale`)
- `POST /draw/configure` `{ format, config? }`
- `POST /draw/compose`
- `PATCH /draw/composition` `{ weights?, swapPoolTeams?, swapSlots? }`
- `POST /draw/start` · `POST /draw/close-pools` · `POST /draw/reset`
- `PUT /draw/matches/:matchId/score` `{ sets?, winner, forfeitTeam? }`
- `DELETE /draw/matches/:matchId/score`

**Public** (`tournaments.ts`) :
- `GET /api/tournaments/:id/draw` — **sans auth**, seulement si tournoi `PUBLISHED` **et**
  `drawStatus` ∈ {`RUNNING`, `COMPLETED`} (la composition en cours n'est jamais visible),
  sinon 404 `DRAW_NOT_AVAILABLE`. Noms des joueurs uniquement (jamais tél/licence/e-mail).

Codes d'erreur ajoutés aux tables `ERROR_STATUS` : `NOT_PADEL_TOURNAMENT`,
`TMC_SIZE_INVALID`, `DRAW_NOT_COMPOSING`, `DRAW_RUNNING`, `DRAW_NOT_AVAILABLE`,
`MATCH_NOT_READY`, `DOWNSTREAM_SCORED`, `POOL_CLOSED`, `TOURNAMENT_CANCELLED`,
`VALIDATION_ERROR`.

## 7. Frontend

**Types & client** (`lib/api.ts`) : `TournamentDraw`, `DrawPool`, `DrawMatch`,
`DrawStanding`, `FinalRanking` + méthodes `getTournamentDraw` (public),
`adminGetDraw`/`adminConfigureDraw`/`adminComposeDraw`/`adminUpdateComposition`/
`adminStartDraw`/`adminClosePools`/`adminResetDraw`/`adminEnterScore`/`adminClearScore`.
Helpers purs présentation dans `lib/tournamentDraw.ts` (libellés de tours, groupement par
tour, résumé de sets, source d'un slot vide « 1er Poule A »/« Vainqueur match 3 »).

**Fiche joueur `/tournois/[id]`** : section « Tableau & résultats » rendue si le draw
public existe — onglets selon format (Poules / Tableau / Classement) ; tableau = colonnes
par tour dans `.sp-scroll-x`, cartes match (binômes avec avatars `colorForSeed`, score par
manches, chip Forfait) ; « Votre équipe » surlignée (pattern `TeamsGrid`) ; **polling
~15 s** quand `RUNNING` (pas de SSE en v1, horloge `now` hydration-safe) ; podium 🥇🥈🥉
(pattern `TopOfMonth`) + classement 1→N quand `COMPLETED`.

**Admin `/admin/tournaments/[id]/draw`** (lien « Tableau » sur chaque ligne de
`/admin/tournaments`), deux modes selon `drawStatus` :
- **Composition** (`NONE`/`COMPOSING`) : choix du format (+ taille de poule/qualifiés),
  liste des inscrits avec **saisie inline des poids** (re-tri live), bouton « Composer »,
  aperçu poules/tableau, retouches par **drag natif** (pattern `/admin/courts`) + boutons
  ↑↓ mobile, bandeau « recomposer » si `compositionStale`, « Lancer le tournoi ».
- **Pilotage** (`RUNNING`/`COMPLETED`) : matchs groupés par tour (jouables en tête),
  **saisie score en bottom-sheet** pensée mobile (manches en steppers, boutons Forfait,
  correction/effacement), avancement « x/32 matchs », clôture des poules, classement
  final, « Réinitialiser le tableau » (ConfirmDialog).

## 8. Tests

- **Moteur pur** (`tournamentDraw/__tests__/`) — le gros de l'effort :
  - générateurs : TMC 12/16/24 câblage complet (comptes de matchs 24/32/60, chaque équipe
    joue 4/4/5 matchs, rangs terminaux couvrant 1→N sans trou ni doublon), KO 4→32 avec
    byes, serpentin, Berger, croisements poules→tableau ;
  - propagation : chaîne complète d'un TMC 16 simulé, forfaits, byes ;
  - corrections : correction sans aval scoré (repropagation), `DOWNSTREAM_SCORED`,
    `clearScore` + `resetDownstream` = état exact d'avant ;
  - classements : tie-breaks dans l'ordre, forfait 6-0 6-0, `finalRanking` par format.
- **Service** (`tournament-draw.service.test.ts`) : transitions d'état, gardes (padel,
  effectifs, `DRAW_RUNNING` sur les mutations d'inscriptions), `closePools`, reset.
- **Routes** : permissions (staff vs joueur), codes d'erreur, visibilité publique
  (COMPOSING → 404).
- **Front** : composition (saisie poids, compose, swap), saisie de score (sheet),
  rendu tableau/poules/classement, fiche joueur (onglets, votre équipe, podium).

## 9. Découpage de mise en œuvre (pressenti)

1. Schéma Prisma + SQL additif (`prisma db execute` en dev) + `prisma generate`.
2. Moteur pur (types, générateurs, propagation, classements) + tests exhaustifs.
3. `TournamentDrawService` + gardes inscriptions dans `TournamentService` + tests.
4. Routes admin + publique + tests.
5. `lib/api.ts` + helpers `lib/tournamentDraw.ts` + tests.
6. Admin : page composition puis pilotage + tests.
7. Fiche joueur : section « Tableau & résultats » + tests.
8. Vérification e2e (seed d'un TMC 16 de démo) + `tsc` + suites.
