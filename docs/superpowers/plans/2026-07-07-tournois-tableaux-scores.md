# Plan — Tournois padel : tableaux, TMC, scores & classement

> ⚠️ Chantier **mis de côté le 2026-07-07** à la demande du user — spec associée :
> `docs/superpowers/specs/2026-07-07-tournois-tableaux-scores-design.md` (non committée).
> Pour reprendre : committer la spec, puis exécuter ce plan lot par lot.

## Context

Le module tournois de Palova s'arrête aujourd'hui aux inscriptions (binômes, liste
d'attente, paiement en ligne) : le club gère le tournoi réel — composition, matchs, scores —
sur papier. Cette fonctionnalité ajoute le **moteur de compétition** : composition seedée
par le poids des paires (points FFT saisis par le staff), formats **TMC 12/16/24** (format
dominant en club : personne n'est éliminé, 4 matchs/équipe, 5 en TMC 24),
**poules + tableau** et **élimination directe**, saisie des scores par le staff,
progression automatique et classement final public sur la fiche `/tournois/[id]`.

Décisions clés : padel uniquement (`sportHasLevels` de `rating/level.ts`) · staff seul
(routes admin STAFF) · pas de planning terrain, pas d'impact rating, pas de notifs ·
moteur générique routé (`winnerTo`/`loserTo` + poules qualificatives OU triangulaires de
classement `rankOffset`) · cycle `NONE → COMPOSING → RUNNING → COMPLETED` (+ reset) ·
transactions Serializable + `FOR UPDATE` ligne tournoi (pattern `register`,
`tournament.service.ts:50-62`) · erreurs `throw new Error('CODE')` + dictionnaires
`ERROR_STATUS`.

## Architecture du moteur (résumé exécutoire)

- **Générateurs 100 % programmatiques** (pas de tables constantes) ; les câblages attendus
  vivent dans les **fixtures de test** (tables ci-dessous). Un seul `buildTmcRounds` couvre
  12/16/24 : à chaque tour un groupe se scinde V/D ; taille 2 → match terminal
  (`winnerRank`/`loserRank`), taille 3 → triangulaire (`rankOffset`).
- **Convention d'appariement TMC** : dans un groupe de 2m équipes ordonnées (seed au R1,
  index de match amont ensuite), le match k oppose `t_k` à `t_{2m+1−k}`. Triangulaires :
  J1 pos2v3, J2 pos1v3, J3 pos1v2.
- **KO** : expansion standard des seeds (`[1]→[1,2]→[1,4,3,2]→…`), byes = les matchs de R1
  concernés **ne sont pas créés**, l'équipe est écrite directement dans le slot aval à la
  génération. `loserRank` posé sur chaque match sans `loserTo` (finale 2, demies 3 ex aequo,
  quarts 5…), `winnerRank 1` sur la finale.
- **Poules→tableau** : qualifiés ordonnés [1ers dans l'ordre des poules ; 2es en ordre
  inverse] avant placement (évite 1erA v 2eA au 1er tour), slots sourcés `{poolId, rank}`.
- **Ids symboliques → réels** : `materializeDrawPlan(plan, tournamentId, genId?)` — passe 1 :
  Map symbolique→`randomUUID()` (node:crypto) ; passe 2 : traduction des références ;
  persistance `createMany` dans l'ordre FK pools → matches → poolTeams.
- **Propagation à un seul saut** (`propagateResult`) : slots routés + `TournamentPoolTeam`
  sourcés ; poule devenue complète → remplit ses matchs (`slotSources {poolId, position}`) ;
  triangulaire dont le dernier match est scoré → `closedAt` auto. Garde
  **`findScoredDownstream`** (cibles winnerTo/loserTo + matchs des poules alimentées) :
  non vide → 409 `DOWNSTREAM_SCORED` ⇒ jamais de récursion ni d'ordre topologique global.
  `resetDownstream` = inverse exact (l'aval est garanti non scoré). Correction = reset →
  écrire → repropager. Poule **qualificative** close → 409 `POOL_CLOSED` ; triangulaire
  close → réouverture auto au `clearScore`.
- **Forfait** : `forfeitTeam` ⇒ `winner` = l'autre (sinon `VALIDATION_ERROR`) ; compte
  **6-0 6-0** dans les classements de poule. En TMC l'équipe forfait continue (personne
  n'est éliminé).
- **Classements de poule** : victoires → confrontation directe (2 ex aequo) → diff manches
  → diff jeux → position initiale.

### Câblage TMC 16 (fixture de référence — 32 matchs)

R1 (seeds) : M1 1v16, M2 2v15, M3 3v14, M4 4v13, M5 5v12, M6 6v11, M7 7v10, M8 8v9.
Routage R1 : V(Mk)→{M9s1,M10s1,M11s1,M12s1,M12s2,M11s2,M10s2,M9s2} pour k=1..8 ;
P(Mk)→ même motif vers M13..M16.
R2 : M9 V(M1)vV(M8), M10 V(M2)vV(M7), M11 V(M3)vV(M6), M12 V(M4)vV(M5) ;
M13..M16 idem avec les perdants. Routage R2 : V(M9)→M17s1, V(M12)→M17s2, V(M10)→M18s1,
V(M11)→M18s2 ; P(M9)→M19s1, P(M12)→M19s2, P(M10)→M20s1, P(M11)→M20s2 ; miroir M13..M16
→ M21/M22 (V) et M23/M24 (P).
R3 : M17 VV-haut, M18 VV-bas, M19 VD, M20 VD, M21 DV, M22 DV, M23 DD, M24 DD.
Routage R3 : V(M17)/V(M18)→M25 ; P(M17)/P(M18)→M26 ; V(M19)/V(M20)→M27 ; P→M28 ;
V(M21)/V(M22)→M29 ; P→M30 ; V(M23)/V(M24)→M31 ; P→M32.
R4 terminaux : M25 « Finale » ranks 1/2 · M26 3/4 · M27 5/6 · M28 7/8 · M29 9/10 ·
M30 11/12 · M31 13/14 · M32 15/16.

### TMC 12 & 24 (même convention)

- **TMC 12** (24 matchs) : R1 M1..M6 (k v 13−k) ; R2 V : M7 V(M1)vV(M6), M8 V(M2)vV(M5),
  M9 V(M3)vV(M4) ; R2 P : M10..M12 idem perdants. 4 triangulaires (teams via
  `sourceMatchId`/`sourceOutcome`, position = index du match source) : P1 « Places 1-3 »
  offset 1 ← V(M7..M9) ; P2 offset 4 ← P(M7..M9) ; P3 offset 7 ← V(M10..M12) ;
  P4 offset 10 ← P(M10..M12).
- **TMC 24** (60 matchs) : R1 M1..M12 (k v 25−k) ; R2 V M13..M18 / P M19..M24 (miroir) ;
  R3 : VV M25 V(M13)vV(M18), M26 V(M14)vV(M17), M27 V(M15)vV(M16) ; VD M28..M30 ;
  DV M31..M33 ; DD M34..M36. 8 triangulaires offsets 1,4,7,10,13,16,19,22 :
  P1←V(M25..M27), P2←P(M25..M27), P3←V(M28..M30), P4←P(M28..M30), P5←V(M31..M33),
  P6←P(M31..M33), P7←V(M34..M36), P8←P(M34..M36).

Invariants testés : totaux 24/32/60 ; matchs/équipe 4/4/5 ; rangs (terminaux + offsets)
couvrent 1..N sans trou ni doublon ; graphe acyclique ; chaque slot a exactement une source.

## Lots (chaque lot finit vert : tests du lot + suite existante + tsc)

### Lot 0 — Traçabilité
Committer la spec + ce plan.
⚠️ Repo édité en parallèle par l'utilisateur : vérifier `git status`/branche avant chaque commit, n'ajouter que ses fichiers.

### Lot 1 — Schéma Prisma + migration
- `backend/prisma/schema.prisma` : enums `TournamentFormat/DrawStatus/TournamentMatchPhase/PoolSourceOutcome`,
  `Tournament.format/drawStatus/drawConfig`, `TournamentRegistration.seedWeight`, modèles
  `TournamentPool`/`TournamentPoolTeam`/`TournamentMatch` (blocs spec §3, + `@db.Timestamptz`
  sur `closedAt`/`playedAt`), relations inverses (`Tournament.pools/matches`,
  `TournamentRegistration.poolTeams/matchesAsTeamA/matchesAsTeamB`).
- `backend/prisma/migrations/20260707140000_add_tournament_draw/migration.sql` : SQL
  idempotent complet (§SQL ci-dessous).
- Vérif (depuis backend/) : `npx prisma db execute --file prisma/migrations/20260707140000_add_tournament_draw/migration.sql --schema prisma/schema.prisma`
  (×2 pour prouver l'idempotence — JAMAIS `migrate dev`, base dev en dérive) ;
  `npx prisma generate` ; `npx tsc --noEmit` ; `npx jest`.

### Lot 2 — Moteur pur + tests exhaustifs
- Créer `backend/src/services/tournamentDraw/` (modèle du sous-dossier `rating/`) :
  `types.ts` (DrawPlan/PlannedMatch/PlannedPool avec ids symboliques ; DrawState/MatchState/
  PoolState/PropagationDelta/PoolStandingRow/FinalRankingRow), `seeding.ts` (`seedTeams` :
  seedWeight desc NULLS LAST → avgLevel desc → createdAt asc), `pools.ts` (`composePools`
  serpentin, `generatePoolMatches` Berger/méthode du cercle, `poolStandings`),
  `knockout.ts` (`generateKnockout`, `generateBracketFromPools`), `tmc.ts` (`generateTMC`
  dispatch 12/16/24 sinon `TMC_SIZE_INVALID`), `propagation.ts` (`propagateResult`,
  `resetDownstream`, `findScoredDownstream`, `resolveQualifyingPoolSlots`,
  `fillBracketFromPoolRanks`), `ranking.ts` (`finalRanking`, `isDrawComplete`),
  `materialize.ts` (`materializeDrawPlan`), `index.ts`.
- Tests `backend/src/services/tournamentDraw/__tests__/` : `seeding` · `pools` (serpentin
  10→4-3-3, Berger 3/4/5, tie-breaks, forfait 6-0 6-0) · `knockout` (N=4,5,8,9,12,16,32 :
  placement, byes sans matchs fantômes, rangs) · `tmc` (**fixtures = tables ci-dessus**,
  invariants génériques, tailles invalides) · `propagation` (TMC 16 simulé bout en bout →
  classement 1-16, triangulaires TMC 12 + clôture auto, forfait, correction, aval scoré,
  clearScore = deep-equal de l'état antérieur, byes KO) · `ranking` · `materialize`
  (aucun id symbolique résiduel, `genId` injecté).
- Vérif : `npx jest src/services/tournamentDraw` ; `npx tsc --noEmit`.

### Lot 3 — `TournamentDrawService` + gardes inscriptions
- Créer `backend/src/services/tournament-draw.service.ts` : `configureDraw / composeDraw /
  updateComposition({weights?, swapPoolTeams?, swapSlots?}) / startDraw / enterScore /
  clearScore / closePools / resetDraw / getDraw (+compositionStale) / getPublicDraw`.
  Toute mutation : transaction Serializable + `SELECT id FROM tournaments WHERE id = ${id}
  FOR UPDATE` ; gardes padel (`NOT_PADEL_TOURNAMENT`), CANCELLED (`TOURNAMENT_CANCELLED`),
  effectifs (TMC∈{12,16,24} `TMC_SIZE_INVALID` ; PK≥6, KO≥4 `VALIDATION_ERROR`) ;
  fallback seeding `new RatingService().getLevelsForUsers(userIds,'padel')` (moyenne
  binôme) ; compose = deleteMany matchs→poules puis 3 createMany ; startDraw vérifie tous
  les slots pourvus (team | slotSources | routage entrant) puis `resolveQualifyingPoolSlots` ;
  enterScore/clearScore : `RUNNING|COMPLETED`, `MATCH_NOT_READY`, sets 1-3 manches entiers
  0..99 (requis sauf forfait), gardes `DOWNSTREAM_SCORED`/`POOL_CLOSED`, complétion→
  COMPLETED / effacement→RUNNING ; closePools (qualificatives toutes scorées) ; resetDraw →
  COMPOSING (slots propagés vidés, closedAt null) ; getPublicDraw : PUBLISHED +
  RUNNING|COMPLETED sinon `DRAW_NOT_AVAILABLE`, projection sans PII (imiter
  `listParticipants` :339-367), sources des slots vides pour libellés front, standings,
  finalRanking si COMPLETED.
- Modifier `backend/src/services/tournament.service.ts` : `changePartner` (l.120),
  `adminPromoteRegistration` (l.497), `adminRemoveRegistration` (l.520) → 409
  `DRAW_RUNNING` si `drawStatus ∈ {RUNNING, COMPLETED}`.
- Tests `tournament-draw.service.test.ts` (pattern `import '../../__mocks__/prisma'`,
  `$transaction.mockImplementation(cb => cb(prismaMock))`, `$queryRaw.mockResolvedValue([])`)
  + extension `tournament.service.test.ts` (gardes DRAW_RUNNING).
- Vérif : `npx jest src/services/__tests__/tournament-draw.service.test.ts src/services/__tests__/tournament.service.test.ts` ; tsc.

### Lot 4 — Routes
- `backend/src/routes/admin.ts` : 9 handlers 1-ligne sous `/tournaments/:id/draw` (section
  l.736-755, scope `req.membership!.clubId`, STAFF hérité) ; ERROR_STATUS (l.65-123) +=
  `NOT_PADEL_TOURNAMENT` 400, `TMC_SIZE_INVALID` 400, `DRAW_NOT_COMPOSING` 409,
  `DRAW_RUNNING` 409, `MATCH_NOT_READY` 409, `DOWNSTREAM_SCORED` 409, `POOL_CLOSED` 409,
  `TOURNAMENT_CANCELLED` 409.
- `backend/src/routes/tournaments.ts` : `GET /:id/draw` public (placé comme
  `/:id/participants`, après `/national`) ; ERROR_STATUS += `DRAW_NOT_AVAILABLE` 404 ;
  += `DRAW_RUNNING` 409 (changePartner passe par ce routeur).
- Tests : `admin.tournament-draw.routes.test.ts` (supertest + JWT signé + spyOn prototype +
  `prismaMock.clubMember.findUnique` ; staff vs joueur 403 ; mapping code→statut) ;
  extension `tournaments.routes.test.ts` (public 200 RUNNING / 404 COMPOSING / sans auth ;
  `/national` non capturé).
- Vérif : `npx jest src/routes/__tests__/...` ; tsc.

### Lot 5 — lib/api + helpers front purs
- `frontend/lib/api.ts` : types `TournamentFormat/DrawStatus/TournamentDraw/
  AdminTournamentDraw/DrawPool/DrawPoolTeam/DrawMatch/DrawTeam/DrawSlotSource/DrawStanding/
  FinalRankingRow/DrawConfig` (près du bloc tournois l.1925-2208) ; ajouter
  `format?: TournamentFormat | null` et `drawStatus?: DrawStatus` au type `Tournament`
  existant (les colonnes remontent automatiquement via les findMany/include backend —
  la liste admin s'en sert pour l'état du bouton « Tableau ») + méthodes
  `getTournamentDraw(id)` publique et `adminGetDraw/adminConfigureDraw/adminComposeDraw/
  adminUpdateComposition/adminStartDraw/adminEnterScore/adminClearScore/adminClosePools/
  adminResetDraw` (conventions `request<T>`, `/api/clubs/${clubId}/admin/…`).
- Créer `frontend/lib/tournamentDraw.ts` (purs, zéro I/O) : `groupMatchesByRound`,
  `roundLabel`, `formatSets` (« 6-3 4-6 [10-7] »), `slotSourceLabel` (« 1er Poule A »,
  « Vainqueur M3 »), `matchProgress`, `viewerRegistrationId`.
- Tests `frontend/__tests__/tournamentDraw.test.ts`.
- Vérif : `npm test -- tournamentDraw` ; `node node_modules/typescript/bin/tsc --noEmit`
  (shims .bin frontend cassés — toujours cette forme ; ceux du backend sont OK).

### Lot 6 — Admin : composition
- Créer `frontend/app/admin/tournaments/[id]/draw/page.tsx` (squelette
  `app/admin/members/[userId]/page.tsx` : useParams+normalisation, garde staff héritée du
  layout, BackButton « Tournois » ; bascule Composition/Pilotage selon drawStatus).
- Créer `frontend/components/admin/draw/DrawCompositionPanel.tsx` : format +
  poolSize/qualifiedPerPool, inscrits avec saisie inline des poids (re-tri live),
  « Composer » (avertit : retouches perdues), aperçu poules/tableau, drag natif + ↑↓
  (copier `components/admin/ClubHouseSectionsCard.tsx`), bandeau `compositionStale` →
  Recomposer, « Lancer le tournoi » (ConfirmDialog).
- Modifier `frontend/app/admin/tournaments/page.tsx` : bouton ghost « Tableau » (l.176-180)
  → `/admin/tournaments/${t.id}/draw`.
- Tests : `AdminDrawComposition.test.tsx` (mocks ClubNav/Screen/Icon, mock lib/api **avec
  `assetUrl`**, ThemeProvider, Suspense + act(async)) + cas bouton dans
  `AdminTournaments.test.tsx`.

### Lot 7 — Admin : pilotage + saisie score
- Créer `frontend/components/admin/draw/DrawPilotPanel.tsx` (matchs groupés par tour via
  `groupMatchesByRound`, jouables en tête, avancement x/32, « Clôturer les poules » si PK,
  classement final, « Réinitialiser » ConfirmDialog) et
  `frontend/components/admin/draw/ScoreSheet.tsx` (sur `components/ui/SheetShell.tsx` :
  steppers par manche, Forfait éq.1/2, corriger/effacer, erreurs 409 affichées).
- Tests : `ScoreSheet.test.tsx`, `AdminDrawPilot.test.tsx`.

### Lot 8 — Fiche publique
- Créer `frontend/components/tournament/DrawSection.tsx` (fetch `getTournamentDraw`,
  silencieux si 404 ; onglets `Segmented` (atoms.tsx:217) Poules/Tableau/Classement selon
  format ; **polling `setInterval(load, 15_000)`** si RUNNING + cleanup),
  `DrawBracketView.tsx` (colonnes par tour `.sp-scroll-x` + scroll-snap façon
  OpenMatchesShowcase ; cartes match : avatars `colorForSeed(registrationId)`, `formatSets`,
  chip Forfait, `slotSourceLabel` pour slots vides ; surlignage viewer façon TeamsGrid
  `${th.accent}12` + inset ring + Chip ; prop `onMatchClick` réutilisée par le pilotage),
  `DrawPoolsView.tsx`, `DrawRankingView.tsx` (podium copié de
  `components/clubhouse/TopOfMonth.tsx` + liste 1→N).
- Modifier `frontend/app/tournois/[id]/page.tsx` : `<DrawSection>` près de la section
  « Inscrits » (l.264-269), réutiliser l'horloge `now` hydration-safe existante (l.66-80).
- Tests : `DrawSection.test.tsx` (404→rien, onglets, votre équipe, podium, polling),
  `DrawBracketView.test.tsx`.

### Lot 9 — Seed démo + gates finales + doc
- Créer `backend/prisma/seed-tournament-draw.ts` (tournoi padel PUBLISHED + 16 inscriptions
  + compose + start + scores via le service — e2e réel sur la base dev) + script
  `db:seed:draw` dans `backend/package.json`.
- Mettre à jour **CLAUDE.md** (nouvelle section « Tournois — tableaux/TMC/scores »).
- Gates : `cd backend && npx jest && npx tsc --noEmit` ;
  `cd frontend && npm test && node node_modules/typescript/bin/tsc --noEmit`
  (⚠️ flake BookingModal connu en full-suite → re-lancer les suites concernées isolément) ;
  `npm run db:seed:draw` puis contrôle visuel `/tournois/[id]` + `/admin/tournaments/[id]/draw`
  (skill `verify`, mobile + desktop).

## SQL de migration (`20260707140000_add_tournament_draw/migration.sql`)

```sql
-- add_tournament_draw : moteur de compétition tournois. 100 % additif.
DO $$ BEGIN CREATE TYPE "TournamentFormat" AS ENUM ('KNOCKOUT','POOLS_KNOCKOUT','TMC');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "DrawStatus" AS ENUM ('NONE','COMPOSING','RUNNING','COMPLETED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TournamentMatchPhase" AS ENUM ('POOL','MAIN');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PoolSourceOutcome" AS ENUM ('WINNER','LOSER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "format" "TournamentFormat";
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "draw_status" "DrawStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "draw_config" JSONB;
ALTER TABLE "tournament_registrations" ADD COLUMN IF NOT EXISTS "seed_weight" INTEGER;

CREATE TABLE IF NOT EXISTS "tournament_pools" (
  "id" TEXT NOT NULL, "tournament_id" TEXT NOT NULL, "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL, "rank_offset" INTEGER, "closed_at" TIMESTAMPTZ,
  CONSTRAINT "tournament_pools_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "tournament_pools_tournament_id_position_idx"
  ON "tournament_pools"("tournament_id","position");

CREATE TABLE IF NOT EXISTS "tournament_pool_teams" (
  "id" TEXT NOT NULL, "pool_id" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "registration_id" TEXT, "seed" INTEGER, "source_match_id" TEXT,
  "source_outcome" "PoolSourceOutcome",
  CONSTRAINT "tournament_pool_teams_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX IF NOT EXISTS "tournament_pool_teams_pool_id_position_key"
  ON "tournament_pool_teams"("pool_id","position");
CREATE INDEX IF NOT EXISTS "tournament_pool_teams_registration_id_idx"
  ON "tournament_pool_teams"("registration_id");

CREATE TABLE IF NOT EXISTS "tournament_matches" (
  "id" TEXT NOT NULL, "tournament_id" TEXT NOT NULL,
  "phase" "TournamentMatchPhase" NOT NULL, "pool_id" TEXT,
  "round" INTEGER NOT NULL, "position" INTEGER NOT NULL, "label" TEXT,
  "team_a_registration_id" TEXT, "team_b_registration_id" TEXT, "slot_sources" JSONB,
  "winner_to_match_id" TEXT, "winner_to_slot" INTEGER,
  "loser_to_match_id" TEXT, "loser_to_slot" INTEGER,
  "winner_rank" INTEGER, "loser_rank" INTEGER,
  "sets" JSONB, "winner" INTEGER, "forfeit_team" INTEGER, "played_at" TIMESTAMPTZ,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tournament_matches_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "tournament_matches_tournament_id_phase_round_position_idx"
  ON "tournament_matches"("tournament_id","phase","round","position");
CREATE INDEX IF NOT EXISTS "tournament_matches_pool_id_idx" ON "tournament_matches"("pool_id");
CREATE INDEX IF NOT EXISTS "tournament_matches_team_a_registration_id_idx"
  ON "tournament_matches"("team_a_registration_id");
CREATE INDEX IF NOT EXISTS "tournament_matches_team_b_registration_id_idx"
  ON "tournament_matches"("team_b_registration_id");

DO $$ BEGIN ALTER TABLE "tournament_pools" ADD CONSTRAINT "tournament_pools_tournament_id_fkey"
  FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "tournament_pool_teams" ADD CONSTRAINT "tournament_pool_teams_pool_id_fkey"
  FOREIGN KEY ("pool_id") REFERENCES "tournament_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "tournament_pool_teams" ADD CONSTRAINT "tournament_pool_teams_registration_id_fkey"
  FOREIGN KEY ("registration_id") REFERENCES "tournament_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_tournament_id_fkey"
  FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_pool_id_fkey"
  FOREIGN KEY ("pool_id") REFERENCES "tournament_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_team_a_registration_id_fkey"
  FOREIGN KEY ("team_a_registration_id") REFERENCES "tournament_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_team_b_registration_id_fkey"
  FOREIGN KEY ("team_b_registration_id") REFERENCES "tournament_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

(Pas de FK sur `winner_to_match_id`/`loser_to_match_id`/`source_match_id` — routage résolu
par le moteur, conforme spec.)

## Risques & edge cases à tester explicitement

1. Byes KO (N=5, N=9) : aucun match à slot définitivement vide, complétion correcte.
2. Forfaits : en TMC l'équipe continue ; triangulaire 6-0 6-0 ; deux forfaits même poule.
3. Corrections : terminal corrigé en COMPLETED (statut inchangé, classement recalculé) ;
   clearScore en COMPLETED → RUNNING ; triangulaire close → réouverture auto ;
   qualificative close → `POOL_CLOSED`.
4. `DOWNSTREAM_SCORED` via routage ET via triangulaire alimentée.
5. Reset exact : enterScore puis clearScore = deep-equal état antérieur.
6. Tournoi CANCELLED pendant RUNNING : mutations 409, lecture admin OK, public 404.
7. Concurrence : deux enterScore sérialisés par FOR UPDATE (pas de retry P2034 en v1,
   comme les inscriptions).
8. Inscriptions : COMPOSING → `compositionStale` ; RUNNING → `DRAW_RUNNING` (bloqué AVANT
   la contrainte FK Restrict).
9. Poids tous null (fallback rating→date), égalités (ordre stable), poids modifiés sans
   recomposer (pas de re-seed auto — comportement spec).
10. POOLS_KNOCKOUT : closePools avec poule incomplète (refus) ; effectif non multiple
    (poules inégales) ; qualifiés non puissance de 2 (byes tableau).
11. FK Restrict : `adminRemoveRegistration` bloqué par `DRAW_RUNNING` avant la contrainte ;
    `resetDraw`/`composeDraw` libèrent les références.
12. Capture de route : `GET /:id/draw` n'intercepte pas `/national`.

## Vérification end-to-end

1. Backend : `npx prisma db execute` (×2, idempotence) + `npx prisma generate` +
   `npx jest` + `npx tsc --noEmit`.
2. Frontend : `npm test` + `node node_modules/typescript/bin/tsc --noEmit`
   (flake BookingModal full-suite connu → suites en isolation si besoin).
3. `npm run db:seed:draw` → démarrer la pile (`start.ps1`) → vérifier visuellement
   (skill `verify`) : `/admin/tournaments/[id]/draw` (composition, lancement, saisie de
   scores, correction refusée si aval scoré) et `/tournois/[id]` (poules/tableau/classement,
   « Votre équipe », podium) en mobile + desktop, thèmes clair + sombre.
