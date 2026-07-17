# Table de marque du J/A — pointage, remplacements, banc & appariements — Design

> Spec validée le 2026-07-17 (brainstorming + maquettes comparées dans le companion visuel :
> 3 directions A/B/C, **B « La table de marque » retenue**, puis maquette détaillée validée).
> Prolonge la spec `2026-07-17-juge-arbitre-tournoi-design.md` (J/A = facette + mission,
> livrée) : le J/A gagne la **gestion vivante de ses inscrits le jour J**. Padel/tournois
> uniquement.

## 1. Objectif & périmètre

Aujourd'hui, après la clôture des inscriptions, **personne** ne peut modifier la composition
d'un binôme : `changePartner` est réservé au capitaine et verrouillé à
`registrationDeadline` (`REGISTRATION_LOCKED`), et les seules armes du staff/J/A sont
promouvoir ou retirer un binôme entier. Or c'est précisément après la clôture que le J/A
travaille : un joueur ne se présente pas, un remplaçant est là, deux orphelins veulent
jouer ensemble, un binôme arrive en retard. La seule issue actuelle — retirer et
réinscrire — perd la place et le paiement.

**La table de marque** est un mode plein écran, ouvert depuis la carte d'un tournoi, qui
donne au J/A (et au staff) les gestes du jour J :

- **Pointage par joueur** (présent / absent / pas vu), persisté.
- **Forfait d'un joueur** → son coéquipier descend au **banc**.
- **Remplacement** d'un joueur par quelqu'un du banc (le geste : toucher le joueur du banc,
  toucher la place).
- **Appariement** de deux joueurs du banc → nouveau binôme.
- **Binôme tardif** (inscription après clôture par le J/A).
- **Promotion de la liste d'attente** (existant, re-exposé ici).
- **Journal** de chaque intervention (qui, quoi, quand).

**Hors périmètre (v2+) :** synchro temps réel multi-appareils (SSE), pointage par le joueur
lui-même (QR code), invités sans compte Palova, override des règles de composition,
remboursement automatique du joueur remplacé, mode TV, et le **moteur de tableaux**
(spec parkée `2026-07-07-tournois-tableaux-scores-design.md`, déjà amendée « staff + J/A ») —
mais la table est pensée pour l'alimenter plus tard : le pointage nourrira la composition
des poules.

## 2. Décisions (issues du brainstorming — toutes actées par Eric)

| Sujet | Décision |
|---|---|
| Forme | **B · Table de marque** : mode plein écran, grille de binômes + banc, header brume bleue (`HERO_GRADIENT`/`HERO_INK`) — pas une liste à menus (A), pas un studio bureau (C, dont on garde le **journal**) |
| Pointage | **Par joueur, persisté**. ○ pas vu → ✅ présent → ✕ absent. Un absent n'est PAS un forfait (il peut être en retard) — le forfait est un acte explicite |
| Remplaçant / tardif | **Membre du club uniquement** (annuaire `searchMembers`) — pas d'adhésion à la volée. Téléphone/licence manquants → chips coral, le J/A juge |
| Paiement du tardif / de l'appariement | **En ligne, même tardif** : l'inscription naît `CONFIRMED + DUE + holdDeadline` (mécanique existante, 15 min) ; le capitaine paie depuis sa fiche tournoi comme une inscription normale ; non payé → le cleanup libère (existant) |
| Remplacement et paiement | Le paiement reste **attaché à l'inscription** (l'équipe a payé) : remplacer un joueur — capitaine payeur compris — ne déclenche ni charge ni remboursement. Recrédit éventuel = geste caisse manuel, hors app |
| Composition | **Stricte, comme l'inscription** : Dames = 2 femmes, Mixte = 1H+1F, `openToWomen` honoré. Revalidée serveur à chaque remplacement/appariement/tardif, refus motivé. Pas d'override |
| Capacité | Mêmes règles que l'inscription (`occupiesSpotWhere`) : un appariement/tardif prend une place libre, sinon naît `WAITLISTED` |
| Clôture | Le J/A (et le staff) **outrepassent `registrationDeadline`** — c'est la raison d'être de la surface. Les joueurs, eux, restent verrouillés (rien ne change côté `register`/`changePartner`) |
| Journal | **Oui**, persisté et visible dans la table (une ligne repliable). Chaque acte : auteur, action, horodatage |
| Accès | **J/A du tournoi ET staff** (le J/A est ajouté, jamais substitué — principe de la spec J/A). Même composant, deux portes |

### Les gestes (conflit résolu en maquette)

Trois gestes qui ne se marchent jamais dessus :

1. **Pointer = toucher un joueur dans la grille**, sans intermédiaire (l'acte le plus
   fréquent). Cycle ○ → ✅ → ✕.
2. **Remplacer part TOUJOURS du banc**, jamais de la grille : toucher un joueur du banc
   (halo bleu) → les places remplaçables s'illuminent en pointillés → toucher une place.
   Même langage que le tap-pour-permuter de `MatchTeams`.
3. **Actions rares via ⋮** sur la tuile : déclarer le forfait d'un joueur, appeler,
   promouvoir un binôme d'attente. **Apparier** = toucher deux joueurs du banc l'un après
   l'autre → bouton « Apparier ✓ ».

Détail acté : un joueur installé depuis le banc arrive **pointé présent** (il est
physiquement à la table).

## 3. Modèle de données — migration additive `add_tournament_mark_table`

**Aucune colonne existante modifiée.** Trois briques :

```prisma
enum TournamentPresence { UNSEEN PRESENT ABSENT }

model TournamentRegistration {
  // …existant…
  captainPresence TournamentPresence @default(UNSEEN) @map("captain_presence")
  partnerPresence TournamentPresence @default(UNSEEN) @map("partner_presence")
}

/// Le banc : joueurs seuls en attente d'une place (forfait du coéquipier, ou retardataire).
model TournamentBenchEntry {
  id        String   @id @default(cuid())
  tournamentId String @map("tournament_id")
  userId    String   @map("user_id")
  source    BenchSource            // FORFEIT | WALK_IN
  addedById String?  @map("added_by_id")   // l'auteur (J/A ou staff), SetNull
  createdAt DateTime @default(now()) @map("created_at")
  tournament Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([tournamentId, userId])
  @@map("tournament_bench_entries")
}

enum BenchSource { FORFEIT WALK_IN }

/// Journal des interventions à la table de marque.
model TournamentLogEntry {
  id           String   @id @default(cuid())
  tournamentId String   @map("tournament_id")
  actorUserId  String?  @map("actor_user_id")   // SetNull (RGPD)
  kind         String                            // CHECK_IN | FORFEIT | REPLACE | PAIR | ADD_LATE | PROMOTE | REMOVE
  data         Json                              // libellés dénormalisés (noms au moment de l'acte)
  createdAt    DateTime @default(now()) @map("created_at")
  tournament Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  @@index([tournamentId, createdAt])
  @@map("tournament_log_entries")
}
```

Choix assumés : la présence vit **sur l'inscription** (2 colonnes enum, pas de table de
jointure — il y a exactement 2 joueurs par inscription, par construction) ; `kind` du
journal en `String` (pas d'enum Prisma : ajouter un genre d'acte ne doit pas exiger de
migration) ; `data` porte les **noms dénormalisés** au moment de l'acte (le journal reste
lisible même si un compte est supprimé). Un remplacement **réinitialise la présence** du
côté remplacé (à `PRESENT`, cf. §2). DEV : `prisma db execute` (dérive connue — ni
`db push` ni `migrate dev`) ; prod : `migrate deploy`.

## 4. Sémantique des actes (service)

Toutes les méthodes prennent un **`actorUserId`** (pour le journal) et écrivent leur entrée
de journal **dans la même transaction** que l'acte. Deux portes, un seul cœur :
les routes J/A passent par `resolveReferee` + `assertRefereeOwnsTournament` (gates
existants), les routes staff par `requireClubMember('STAFF')` — puis **délégation aux mêmes
méthodes** (pattern de la spec J/A).

- **`setPresence(regId, side: 'CAPTAIN'|'PARTNER', presence)`** — pointage. Pas de gate
  temporel. Journal `CHECK_IN` (coalescé : on ne journalise pas chaque cycle ○→✅→✕,
  seulement l'état final par écriture).
- **`declareForfeit(regId, side)`** — l'inscription passe `CANCELLED` (réutilise la
  mécanique d'`adminRemoveRegistration` : promotion auto du 1ᵉʳ en attente, emails
  existants) **et le coéquipier restant entre au banc** (`FORFEIT`) dans la même
  transaction. Journal `FORFEIT`.
- **`replacePlayer(regId, side, newUserId)`** — outrepasse la clôture. Revalide : membre
  actif du club, pas déjà inscrit dans ce tournoi, composition de genre. Écrit
  `captainUserId|partnerUserId`, présence du côté remplacé → `PRESENT`, retire `newUserId`
  du banc s'il y était. **Paiement intouché.** Notifs best-effort : email « désinscription »
  au remplacé, « inscription confirmée » au remplaçant. Journal `REPLACE`.
- **`addToBench(tournamentId, userId)`** — retardataire (`WALK_IN`), membre du club requis,
  refusé s'il est déjà inscrit. Idempotent (`@@unique`).
- **`removeFromBench(tournamentId, userId)`** — retrait manuel du banc.
- **`pairFromBench(tournamentId, userAId, userBId)`** — nouveau binôme depuis le banc.
  Mêmes validations que `register` **sauf la deadline** : composition, capacité
  (`occupiesSpotWhere` → place libre = `CONFIRMED`, sinon `WAITLISTED`), prépaiement
  (épreuve `requirePrepayment` → `paymentStatus DUE + paymentDeadline = holdDeadline(now)`,
  le capitaine — le premier touché — paie depuis sa fiche tournoi, parcours existant ;
  non payé → le cleanup job libère, mécanique existante). Les deux sortent du banc dans la
  transaction. Emails d'inscription existants. Journal `PAIR`.
- **`addLateRegistration(tournamentId, captainUserId, partnerUserId)`** — binôme tardif,
  même chemin que `pairFromBench` sans passer par le banc. Journal `ADD_LATE`.
- **`listMarkTable(tournamentId)`** — la projection complète de l'écran : inscriptions
  (avec présences, licence, téléphone — le roster J/A existant s'enrichit), banc, compteurs,
  journal (dernières entrées). **`userId` jamais exposé** côté J/A (règle de la spec J/A) ;
  le banc expose l'identité affichable seulement.
- **`listLog(tournamentId)`** — le journal complet (pagination simple).

Erreurs nouvelles : `NOT_A_MEMBER` 403 (cible hors club), `ALREADY_REGISTERED` 409,
`ALREADY_ON_BENCH` 409, `COMPOSITION_INVALID` 400 (avec le motif genre),
`BENCH_ENTRY_NOT_FOUND` 404. Les gardes existantes (`TOURNAMENT_NOT_YOURS`,
`REGISTRATION_NOT_FOUND`…) inchangées.

## 5. Routes

**J/A** (`clubs.ts`, `authMiddleware` + `resolveReferee` + propriété — miroir des 4 routes
existantes), sous `/:slug/me/referee/tournaments/:id/` :

| Route | Acte |
|---|---|
| `GET …/mark-table` | `listMarkTable` |
| `POST …/registrations/:regId/presence` | body `{ side, presence }` |
| `POST …/registrations/:regId/forfeit` | body `{ side }` |
| `POST …/registrations/:regId/replace` | body `{ side, newUserId }` |
| `POST …/bench` · `DELETE …/bench/:userId` | banc |
| `POST …/bench/pair` | body `{ userAId, userBId }` |
| `POST …/registrations` | binôme tardif `{ captainUserId, partnerUserId }` |

**Staff** (`admin.ts`, gate STAFF hérité) : mêmes routes sous
`/tournaments/:id/mark-table*` — délégation aux mêmes méthodes, `actorUserId = req.user.id`.

Le picker du remplaçant/retardataire réutilise **`GET /:slug/members/search?q=`**
(annuaire existant, réservé aux membres actifs) — côté J/A, c'est déjà accessible à un
membre du club ; aucun endpoint nouveau.

## 6. Frontend

**Composant partagé `components/tournament/MarkTable.tsx`** (+ sous-composants
`MarkTableTile`, `BenchBar`, `MarkTableJournal`) — consommé par deux pages minces :

- **`/me/refereeing/[id]`** (J/A) — ouvert par un bouton « Table de marque » sur la carte
  de `/me/refereeing` (à côté d'« Inscrits »).
- **`/admin/tournaments/[id]/table`** (staff) — bouton sur la carte de
  `/admin/tournaments`.

**Langage visuel** (maquette validée) : mode plein écran (chrome minimal, ✕ retour),
header **brume bleue** (`HERO_GRADIENT`/`HERO_INK`) avec kicker « TABLE DE MARQUE », nom du
tournoi, **chips vivantes** (x/y pointés · attente · banc, banc en coral si non vide) ;
**grille 2 colonnes** de tuiles binôme — liseré émeraude quand les 2 sont pointés, contour
coral si un absent, tuiles d'attente estompées avec chip violette ; **banc en feuille
basse** (avatars `colorForSeed`, halo bleu sur la sélection, « + » pour un retardataire,
bandeau d'aide contextuel pendant un geste) ; **journal en une ligne repliable** au-dessus
du banc. États réseau : action → optimiste + rechargement (pattern Caisse), erreur →
bannière **coral** avec le motif serveur mappé (`COMPOSITION_INVALID` → « Ce tableau exige
2 femmes », etc.).

Pas de `useIsDesktop` : la grille passe de 2 à 4+ colonnes en CSS pur (même philosophie que
`.pl-create-grid`). Mobile 390 = la référence (le J/A est debout au bord du terrain).

## 7. Notifications

Best-effort (`safeNotify`), réutilise les emails existants : remplacé → « désinscription » ;
remplaçant / binôme apparié / tardif → « inscription confirmée » (la fiche tournoi porte le
bouton de paiement si `DUE`) ; promotion → existant. Aucun template nouveau en v1.

## 8. Ce qui ne change pas

- `register` / `changePartner` / `cancelRegistration` joueurs : **inchangés** (deadline
  toujours opposable aux joueurs).
- Les 4 routes J/A existantes (liste, roster, promote, remove) : inchangées — la table les
  englobe mais ne les remplace pas (le roster « Inscrits » de la carte reste).
- `ClubRole`, la facette `isReferee`, le gate 2 étages : inchangés.
- Paiements Stripe : **aucun flux nouveau** — uniquement la mécanique DUE/holdDeadline
  existante, déclenchée par des inscriptions créées autrement.

## 9. Tests

**Backend** — `tournament.service` : pointage (cycle, side, journal coalescé) ; forfait
(CANCELLED + banc + promotion attente dans une transaction) ; remplacement (composition
Dames/Mixte refusée avec motif, non-membre refusé, déjà-inscrit refusé, paiement intouché,
présence PRESENT, sortie du banc) ; appariement (capacité pleine → WAITLISTED, prépaiement
→ DUE+deadline, les 2 sortent du banc) ; tardif ; kill-switch J/A (facette décochée → 403
via la route) ; journal (une entrée par acte, acteur, transaction). Routes : miroir J/A
(403 sans facette, 403 tournoi d'un autre) + staff (mêmes méthodes, gate STAFF) —
vérifier par **mutation** que chaque gate porte.

**Frontend** — `MarkTable` : cycle de pointage optimiste, geste banc→place (halo, places
illuminées, tap = appel API), appariement 2 sélections, feuille ⋮ (forfait avec
confirmation), erreurs mappées, chips compteurs. Pages : bouton d'entrée sur les deux
cartes. **Vérification visuelle CDP obligatoire** (clair/sombre, 1280/390 — la mesure
`scrollWidth` est aveugle, **regarder les images** ; leçon de la carte méta J/A).

## 10. Découpage suggéré

1. Migration + modèle + `setPresence`/`listMarkTable` + tests.
2. Forfait + banc + tests.
3. Remplacement + tests (le cœur du sujet).
4. Appariement + tardif + paiement + tests.
5. Routes J/A + staff + journal + tests.
6. Front : `MarkTable` + pointage + banc/gestes.
7. Front : feuilles ⋮, erreurs, journal, entrées depuis les 2 cartes.
8. Vérif visuelle CDP + E2E vraie base (pattern des lots précédents).
