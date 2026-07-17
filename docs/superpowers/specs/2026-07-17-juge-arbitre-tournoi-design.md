# Juge-arbitre (J/A) d'un tournoi — Design

> Spec validée le 2026-07-17. Le J/A devient une **entité réelle** de Palova : il possède
> son tournoi et le fait vivre **sans être staff du club**. Modèle = **facette + mission sur
> l'objet**, calqué sur le coach. **Aucun rôle nouveau.** Padel/tournois uniquement.

## 1. Objectif & périmètre

Aujourd'hui, pour laisser le prof du club (ou un J/A licencié) gérer son tournoi, **il faut
le passer STAFF** — et il récupère au passage la caisse, les paiements, le fichier membres,
les remboursements, tout le quotidien du club. C'est exactement la fuite qui avait justifié
la facette coach ; on la referme, à un objet près.

Le juge-arbitre existe déjà dans le produit — **en texte libre**. `Tournament.contactInfo`
(`schema.prisma:1079`) a pour placeholder, mot pour mot, *« Ex. Vous devez contacter le Juge
Arbitre au 06 02 32 33 65 »* (`frontend/app/admin/tournaments/page.tsx:196`). Aucune
sémantique, aucune FK, aucun droit. Cette spec le **promeut en entité**, sans supprimer le
texte libre (les deux cas cohabitent, cf. §3).

**Dans le périmètre (volet B — livrable immédiatement) :**
- Facette « Juge-arbitre » sur la fiche membre (case à cocher, à côté de « Coach »).
- Désignation d'**un** J/A par tournoi, choisi dans le vivier.
- Espace **`/me/refereeing`** (« Arbitrage ») : le J/A voit ses tournois et gère ses inscrits
  (liste d'attente, retrait), avec contacts + licence.
- Affichage du J/A sur la **fiche publique** du tournoi.

**Hors périmètre de l'implémentation, mais gravé ici (volet A — avec le moteur) :**
- Poules / tableaux / scores / classement : c'est la spec parkée
  `2026-07-07-tournois-tableaux-scores-design.md`, **non exécutée**. Son amendement est
  normatif et figure au §8.

**Hors périmètre tout court (v2+) :** plusieurs officiels par tournoi (J/A + adjoints +
table de marque), qualification J/A stockée (JAP1/JAP2…), homologation FFT, création/édition
du tournoi par le J/A, J/A sur les events, facette J/A pour un non-membre.

## 2. Décisions clés (issues du brainstorming)

| Sujet | Décision |
|---|---|
| Rôle ou facette ? | **Facette.** `ClubRole { OWNER ADMIN STAFF }` **n'est pas touché** |
| Périmètre du J/A | **C** — il possède le tournoi de l'inscription au podium (livré en 2 temps : B maintenant, A avec le moteur) |
| Nombre de J/A | **Un seul** par tournoi → FK, pas de table de rattachement |
| Désignation | **(b)** Facette (case sur la fiche membre) + vivier ; le picker du tournoi n'y pioche que dedans |
| Stockage de la facette | **`ClubMembership.isReferee`** (booléen), **pas** une table `Referee` — cf. §3, rupture de symétrie assumée |
| Espace joueur | **Deux entrées séparées** dans le menu profil : « Mes cours » (existe) + « Arbitrage » (neuf) |
| Libellé & route | **« Arbitrage »**, `/me/refereeing`, icône `trophy` — *pas* « Mes tournois » (collision, cf. §6) |
| Accès staff | **Inchangé** : tout STAFF garde l'accès plein à tous les tournois. Le J/A est *ajouté*, jamais substitué |
| J/A public | **Oui**, affiché sur la fiche publique du tournoi |
| Sport | Tournois seuls (donc padel de facto, `Tournament` est déjà padel-only en pratique) |

### Pourquoi pas un rôle — l'argument mécanique

Ce n'est pas une question de goût. `requireClubMember` (`backend/src/middleware/requireClubMember.ts:24-49`)
ne connaît que `req.params.clubId`, et sa hiérarchie est **linéaire et globale** :

```ts
const RANK: Record<ClubRole, number> = { STAFF: 1, ADMIN: 2, OWNER: 3 };
```

Un `ClubRole.REFEREE` devrait s'insérer dans ce classement : **au-dessus de STAFF il verrait
tout le club, en dessous il ne verrait rien**. Il n'existe aucun cran où le glisser. Le
modèle de droits est **club-scopé**, jamais objet-scopé — exprimer « X est J/A du tournoi Y »
demande une mission sur l'objet, ce qui est précisément le pattern coach.

### Pourquoi la double casquette n'est pas un problème

« Souvent le coach est aussi J/A » est un problème **créé par les rôles**, pas par le domaine :
une colonne `role` force l'exclusivité (COACH *ou* J/A) et pousse aux rôles composites
absurdes. Les facettes, elles, **s'additionnent** : la même personne a `Coach.isActive` et
`ClubMembership.isReferee`, indépendamment. Rien à arbitrer, aucun code à écrire pour ça.

## 3. Modèle de données

Migration **additive** `add_tournament_referee` — deux colonnes, **zéro table**.

```prisma
model ClubMembership {          // table club_subscribers
  // …
  watch      Boolean @default(false)                     // précédent : facette booléenne
  isReferee  Boolean @default(false) @map("is_referee")  // NOUVEAU — facette J/A
}

model Tournament {             // table tournaments
  // …
  refereeUserId String? @map("referee_user_id")          // NOUVEAU — la mission
  referee       User?   @relation("TournamentReferee", fields: [refereeUserId], references: [id], onDelete: SetNull)
  @@index([refereeUserId])
}
```

SQL (DEV : `prisma db execute` — la base dev a une dérive connue, **ni `db push` ni
`migrate dev`** ; PROD : `migrate deploy`) :

```sql
ALTER TABLE "club_subscribers" ADD COLUMN IF NOT EXISTS "is_referee" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "referee_user_id" TEXT;
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_referee_user_id_fkey"
  FOREIGN KEY ("referee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "tournaments_referee_user_id_idx" ON "tournaments"("referee_user_id");
```

### Rupture de symétrie assumée : booléen, pas table `Referee`

Le coach a une **table** pour deux raisons précises, et **aucune ne vaut pour le J/A** :

1. `Coach` porte un **profil** (`name`, `photoUrl`, `bio`, `sortOrder`) affiché sur la vitrine
   du club. Le J/A n'a pas de vitrine à soigner.
2. `Coach.userId` est **nullable** — un club peut afficher un prof sans compte Palova. Le J/A
   **doit** avoir un compte, puisqu'il agit dans l'app (c'est tout le sens du « C »).

Une table `Referee { clubId, userId }` sans autre champ et à `userId` non-null serait **un
booléen avec des jointures en plus** — du mimétisme, pas de la cohérence.

La symétrie demandée est **entièrement préservée là où elle compte** — c'est-à-dire à l'écran :
case au même endroit sur la fiche membre, segment « J/A » à côté de « Coachs », double
casquette visible d'un coup d'œil. `ClubMembership.watch` est le précédent exact de ce
pattern. Portée identique, aussi : `CoachService.setMemberCoach` lève déjà `MEMBER_NOT_FOUND`
si la cible n'a pas de `ClubMembership` — la facette coach **exige déjà** une adhésion.

### Le J/A extérieur sans compte

Il reste couvert par **`contactInfo`**, inchangé. Les deux cas cohabitent au lieu de se
marcher dessus : `contactInfo` = *« qui appeler »* (texte libre, aucun droit) ;
`refereeUserId` = *« qui pilote dans l'app »* (compte requis, droits sur ce tournoi).

## 4. Le gate — deux étages, copie conforme du coach

Miroir de `resolveCoach` (`lesson.service.ts:780`) + `assertCoachOwnsLesson` (`:864`).

```ts
/** Étage 1 — « es-tu J/A ? ». Gate de l'espace arbitrage. */
async resolveReferee(clubId: string, userId: string): Promise<boolean> {
  const m = await prisma.clubMembership.findUnique({
    where: { userId_clubId: { userId, clubId } },
    select: { status: true, isReferee: true },
  });
  return !!m && m.status === 'ACTIVE' && m.isReferee;
}

/** Étage 2 — « ce tournoi est-il le tien ? ». */
private async assertRefereeOwnsTournament(tournamentId: string, clubId: string, userId: string) {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { clubId: true, refereeUserId: true },
  });
  if (!t || t.clubId !== clubId) throw new Error('TOURNAMENT_NOT_FOUND');
  if (t.refereeUserId !== userId) throw new Error('TOURNAMENT_NOT_YOURS');
  return t;
}
```

Puis **délégation au cœur admin déjà testé** (`adminPromoteRegistration`
`tournament.service.ts:497`, `adminRemoveRegistration`) — **aucune logique métier dupliquée**,
exactement ce que fait `coachEnrollStudent`.

Codes → HTTP (à mapper dans `clubs.ts`, à côté de `NOT_A_COACH`) :
`NOT_A_REFEREE` 403 · `TOURNAMENT_NOT_YOURS` 403 · `TOURNAMENT_NOT_FOUND` 404.

**Propriétés voulues :**
- **Kill-switch immédiat** : décocher la case coupe l'accès, même sur un tournoi assigné
  (l'étage 1 tombe). `refereeUserId` **n'est pas effacé** → on recoche, il retrouve son
  tournoi. Réversible, comme `Coach.isActive`.
- **Pas de verrou temporel** façon `ENROLLMENT_LOCKED` : le J/A doit agir *pendant* le
  tournoi. Les règles de `registrationDeadline` (et, plus tard, de tableau lancé) sont déjà
  portées par le cœur — on ne les redouble pas.
- Chaque route appelle `ensureActiveMembership(slug, userId)` (`services/membership.ts:8`),
  comme les routes coach.

## 5. Backend — service & routes

Méthodes J/A sur `TournamentService` (miroir des méthodes coach de `LessonService`) :
`resolveReferee` · `listRefereeTournaments` · `refereeListRegistrations` ·
`refereePromoteRegistration` · `refereeRemoveRegistration`.

Routes dans `backend/src/routes/clubs.ts`, sous `authMiddleware` **sans** `requireClubMember` —
à côté de la section coach (`clubs.ts:279-323`) :

| Route | Rôle |
|---|---|
| `GET /:slug/me/facets` | Signal léger `{ isCoach, isReferee }` pour le menu — **ne 403 jamais** (tout à `false` si club inconnu/inactif), reprend le contrat de `GET /:slug/me/coach` en l'élargissant (cf. §6) |
| `GET /:slug/me/referee/tournaments?scope=upcoming\|past` | Ses tournois — **« à venir » = pas encore fini**, `(endTime ?? startTime) >= now` (asc) ; « passés » = le complément (desc, **cap 30**) |
| `GET /:slug/me/referee/tournaments/:id/registrations` | Le roster (cf. ci-dessous) |
| `POST /:slug/me/referee/tournaments/:id/registrations/:regId/promote` | Délègue `adminPromoteRegistration` |
| `DELETE /:slug/me/referee/tournaments/:id/registrations/:regId` | Délègue `adminRemoveRegistration` |

**Roster J/A** — binômes (capitaine + partenaire), statut, `waitlistPosition`,
`paymentStatus` (lecture seule), et pour chaque joueur : **nom, photo, téléphone, licence
`membershipNo`**. La licence est délibérément exposée : le J/A la vérifie à la table de
marque, c'est son métier. Suivre `mapRosterForCoach` (`lesson.service.ts:785-801`) et
**ne jamais exposer `userId`**.

Le J/A **ne crée pas, ne modifie pas, n'annule pas** le tournoi — comme le coach ne crée pas
ses cours. Le staff pose le cadre, le J/A le fait vivre.

## 6. Frontend

**Espace** — page `frontend/app/me/refereeing/page.tsx`, calquée sur `app/me/coaching/page.tsx`
(deux sections à venir / passés). Non-J/A → message « Cet espace est réservé aux
juges-arbitres du club. », **jamais un écran d'erreur générique**.

**Menu** — entrée « **Arbitrage** » dans `ProfileMenu` (icône `trophy` ; `whistle` est pris
par le coach), gatée `isReferee`.

> ⚠️ **Ne pas nommer l'entrée « Mes tournois »** : `GET /api/me/tournaments` existe déjà et
> désigne *les tournois où je suis inscrit comme joueur*. Deux « mes tournois » de sens
> opposés dans le même menu.

**Un seul appel pour les deux facettes** — `ProfileMenu` appelle aujourd'hui `getCoachStatus`
paresseusement **à l'ouverture du menu** (`ProfileMenu.tsx:58`, `.catch(() => {})`). Deux
facettes ⇒ soit deux appels, soit **un `GET /:slug/me/facets → { isCoach, isReferee }`**.

**Décision : `/me/facets`**, et donc **`GET /:slug/me/coach` + `api.getCoachStatus` sont
supprimés** (avec leur test) — vérifié : `getCoachStatus` n'a **qu'un seul consommateur**,
`ProfileMenu.tsx:58`. Les garder ferait du code mort dès le premier jour. `GET /:slug/me/coach/lessons*`
et le reste de l'espace coach ne bougent pas.

Conserver **impérativement la paresse** (appel à l'ouverture du menu, jamais au montage) :
c'est elle qui a évité de casser les suites *real-mount* `ClubNav` au Lot C.

> ⚠️ **Conflit d'édition probable** : `frontend/components/ProfileMenu.tsx` et
> `frontend/__tests__/ProfileMenu.test.tsx` sont **modifiés dans l'arbre de travail** au
> moment où cette spec est écrite (WIP d'Eric). Ce sont exactement les deux fichiers que
> cette tâche doit toucher. Resynchroniser avant de commencer, et ne jamais committer en
> emportant du WIP tiers.

**Admin :**
- Case « **Juge-arbitre** » sur `MemberPanel` (`components/admin/members/MemberPanel.tsx:102-105`),
  à côté de « Coach — anime des cours », visible seulement si `canManageStaff` →
  `PATCH /members/:userId/referee`, **gate `requireClubMember('ADMIN')`** (miroir exact de
  `admin.ts:1029-1034`).
- Segment « **J/A** » sur la page Membres + **colonne CSV** (miroir du segment « Coachs » du Lot A).
- Hydratation de `isReferee` sur la liste des membres : la colonne étant sur `ClubMembership`,
  elle **suit le select existant** — pas de requête groupée à ajouter (contrairement à
  `isCoach`, `club.service.ts:436-440`). C'est un bénéfice direct du choix booléen.
- Champ « **Juge-arbitre** » dans le formulaire du tournoi (`app/admin/tournaments/page.tsx`),
  picker restreint au vivier via `GET /admin/referees` (miroir de `GET /admin/coaches`,
  `admin.ts:758`). `PATCH /tournaments/:id` accepte `refereeUserId` (nullable = retirer).

## 7. Affichage public

Le J/A désigné apparaît sur la **fiche publique du tournoi** (`/tournois/[id]`) — « Juge-arbitre :
Julien Martin ». Info publique par nature (c'est lui qui répond du tournoi). **Nom seul** :
ni téléphone, ni e-mail, ni licence — `contactInfo` reste le canal du club pour ça, et il
reste affiché selon la règle existante.

## 8. Amendement normatif de la spec du moteur (volet A)

`docs/superpowers/specs/2026-07-07-tournois-tableaux-scores-design.md` — **spec validée,
jamais exécutée** — pose aujourd'hui :

> | Scores | **Staff seul** (OWNER/ADMIN/STAFF), pas de flux joueur |

**Cette décision est amendée en : « Staff + le J/A du tournoi ».** La surface admin du
tableau (`/api/clubs/:clubId/admin/tournaments/:id/draw`, composition / lancement / saisie
de score / classement) doit accepter **les deux chemins d'autorité** dès sa conception —
sinon elle naîtra staff-only et il faudra la rétrofitter.

C'est le bénéfice principal du timing : **le moteur naît J/A-aware**. La spec **et son plan**
(`docs/superpowers/plans/2026-07-07-tournois-tableaux-scores.md`) sont à retoucher **avant**
exécution.

**Note de chiffrage** (issue de l'exploration, à ne pas perdre) : la saisie de résultat
actuelle est **auto-déclarée entre pairs** — `MatchService.createFromReservation`
(`match.service.ts:25-49`) exige d'être **l'un des 4 joueurs** et refuse les créneaux de
tournoi (`NOT_A_COURT_RESERVATION`) ; `Match` n'a **aucune FK vers `Tournament`**. Un J/A qui
saisit un tableau est donc un **chemin d'écriture entièrement neuf**, pas une extension des
gardes existantes. Ça ne change rien au modèle de droits — ça pèse sur le moteur.

## 9. Ce qui ne change pas

- **`ClubRole` intact.** Aucun rôle ajouté, aucun `RANK` touché.
- **Le staff garde l'accès plein à tous les tournois** (`admin.ts:181-184`, gate hérité
  STAFF). Le J/A est *ajouté*, jamais substitué — sinon désigner un J/A **enfermerait le club
  dehors de son propre tournoi**.
- **`contactInfo` reste** (§3).
- Le coach, `/me/coaching` et la table `Coach` ne sont **pas touchés**.
- Un J/A qui est aussi STAFF garde ses deux chemins d'accès. Aucun conflit : ce sont deux
  gates indépendants.

## 10. Tests

**Backend** — `tournament.service` (resolveReferee : ACTIVE+isReferee / BLOCKED / non coché ;
assertRefereeOwnsTournament : bon J/A, autre tournoi, autre club ; délégation au cœur ;
kill-switch = décocher coupe l'accès à un tournoi assigné) ·
`clubs.referee.routes` (les 4 routes J/A + `GET /me/facets` qui **ne 403 jamais**, mocke
`ensureActiveMembership` comme `clubs.coach.routes.test.ts:44-46`) ·
`clubs.coach.routes` (**retrait** du cas `GET /me/coach`, supprimé au profit de `/me/facets`) ·
`admin.member-referee.routes` (gate ADMIN, `MEMBER_NOT_FOUND`, idempotence) ·
`club.service` (`isReferee` dans le select des membres) ·
`admin.tournaments.routes` (`PATCH` accepte `refereeUserId`, nullable = retirer).

**Frontend** — `MeRefereeing` · `ProfileMenu` (entrée « Arbitrage » visible/masquée, appel
**paresseux**) · `AdminMembersStaff` (case J/A, gate `canManageStaff`) · `members`
(segment J/A + CSV) · `AdminTournaments` (picker, retrait) · fiche publique (J/A affiché,
absent si non désigné).

⚠️ `MemberHistory.test.tsx` n'a **pas** de `clearAllMocks` — tout `expect(...).not.toHaveBeenCalled()`
doit `mockClear()` d'abord (piège rencontré au Lot A).

## 11. Découpage suggéré

1. Migration + schéma + `resolveReferee`/`assertRefereeOwnsTournament` + tests service.
2. Routes `/me/referee*` + tests routes.
3. Admin : `PATCH /members/:userId/referee`, `GET /admin/referees`, `refereeUserId` sur
   `PATCH /tournaments/:id` + tests.
4. Front : page `/me/refereeing`, entrée menu + `/me/facets`.
5. Front admin : case fiche membre, segment + CSV, picker du formulaire tournoi.
6. Fiche publique.
7. Amendement de la spec + du plan du moteur (§8).
