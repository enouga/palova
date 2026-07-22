# Contacter le juge-arbitre (J/A) d'un tournoi — design

Date : 2026-07-22
Statut : validé en brainstorming avec Eric (canal, périmètre, défaut), spec à relire avant plan.

## Contexte

La fiche publique `/tournois/[id]` affiche le J/A par son **nom seul** — décision de la
feature J/A du 17/07 : l'allowlist `PUBLIC_TOURNAMENT_SELECT` exclut `refereeUserId`, et
`contactInfo` (texte libre du club) reste le canal officiel de contact. Un inscrit n'a donc
aucun moyen de joindre directement le J/A, alors que c'est utile une fois les inscriptions
closes : convocations, retards, forfaits, questions de tableau.

Cette feature ouvre un canal de contact **maîtrisé par le J/A** : les inscrits du tournoi
peuvent lui écrire via la messagerie privée existante, et le J/A règle lui-même sa
disponibilité (jamais / seulement après la clôture / toujours) depuis son espace Arbitrage.

## Décisions de cadrage (validées)

1. **Canal = messagerie interne (DM) existante.** Rien d'exposé (ni téléphone, ni email,
   ni licence — la décision « nom seul » tient toujours) ; on hérite gratuitement des
   notifications, de la modération/signalement, du blocage et du rate-limit DM.
2. **Qui = les inscrits du tournoi** : capitaine ou partenaire d'une inscription
   **non annulée** (CONFIRMED ou WAITLISTED). Pas les simples membres du club, pas les
   visiteurs d'autres clubs (le calendrier national n'ouvre aucun contact).
3. **Réglage à 3 états, défaut « Après clôture »** : `Toujours` / `Après la clôture des
   inscriptions` / `Jamais`. Avant la clôture, les questions relèvent du club
   (`contactInfo`) ; le J/A entre en jeu à la clôture — le défaut suit ce découpage métier
   sans que le J/A ait à toucher un réglage.
4. **Portée du réglage = par club**, stocké sur `ClubMembership` à côté de la facette
   `isReferee` (un J/A multi-clubs peut régler différemment chaque club). Édité dans
   l'espace Arbitrage `/me/refereeing` (page club-scopée, cohérent).

## Données — migration additive `add_referee_contact_policy`

- Enum Prisma **`RefereeContactPolicy { ALWAYS AFTER_DEADLINE NEVER }`**.
- Colonne **`ClubMembership.refereeContactPolicy`**
  `RefereeContactPolicy @default(AFTER_DEADLINE) @map("referee_contact_policy")`
  (table `club_subscribers`, miroir de `isReferee`).
- Aucune autre table. DEV : `prisma db execute` du SQL additif (jamais `db push` — dérive
  connue) ; prod : `migrate deploy`.

## Backend

### 1. Réglage du J/A — `GET`/`PATCH /api/clubs/:slug/me/referee/contact-policy`

Famille de routes `/:slug/me/referee/*` existante (`clubs.ts`), gate **`resolveReferee`
étage 1 seul** (adhésion ACTIVE + facette — pas de tournoi en jeu, donc pas d'étage 2).
`GET` → `{ policy }` ; `PATCH` body `{ policy }`, validation stricte des 3 valeurs
(`VALIDATION_ERROR` 400 sinon). Implémenté dans `tournament.service.ts`, voisin de
`resolveReferee` (c'est lui qui possède déjà la logique de la facette J/A).

### 2. Contactabilité exposée dans le payload public

La projection `referee` de `TournamentService.getById()` (aujourd'hui `{ name }`) devient
**`{ name, contactable }`** — booléen calculé serveur, **jamais le userId** :

- `ALWAYS` → `true` ;
- `AFTER_DEADLINE` → `new Date() >= registrationDeadline` (patron de comparaison existant
  du service) ;
- `NEVER` → `false` ;
- **facette retirée ou adhésion non-ACTIVE → `false`** (kill-switch, même philosophie que
  l'étage 1 de `resolveReferee` : décocher la facette coupe la contactabilité même si la
  mission `refereeUserId` reste posée).

Les listes publiques (`listPublicByClubSlug`, `listNationalTournaments`) ne changent pas :
seule la fiche détail a besoin de la contactabilité.

### 3. Endpoint de contact — `POST /api/tournaments/:id/contact-referee` (auth)

C'est lui qui garde le secret du userId. Gardes dans l'ordre :

1. viewer inscrit non-annulé du tournoi (capitaine **ou** partenaire) sinon
   **`NOT_REGISTERED` 403** ;
2. J/A désigné sinon **`TOURNAMENT_NO_REFEREE` 404** ;
3. politique + clôture + facette **re-vérifiées serveur** (même calcul que `contactable` —
   ne jamais faire confiance au client) sinon **`REFEREE_NOT_CONTACTABLE` 409** ;
4. puis **délégation intégrale à
   `MessagingService.getOrCreateConversation(meId, refereeUserId, clubSlug)`** (slug résolu
   depuis le club du tournoi). Toutes les gardes DM restent **souveraines** : blocage
   (`USER_BLOCKED`), opt-out global (`DM_DISABLED` si le J/A a fermé ses messages privés et
   n'est pas ami — limitation assumée : la messagerie reste l'autorité finale, la politique
   J/A n'outrepasse pas un opt-out DM global), rate-limit `dm:newconv`.

Réponse : la `ConversationSummary` (comme `POST /api/me/conversations`). Le userId du J/A
n'est révélé qu'une fois le contact effectivement autorisé — c'est inhérent au DM, et
cohérent avec la fuite colmatée du 17/07 qui ne concernait que le payload public.

Pas de gate temporel de fin : le contact reste possible pendant et après le tournoi
(litiges, résultats), tant que la politique l'autorise.

## Frontend

### Fiche `/tournois/[id]`

La carte méta « Juge-arbitre » (`TournamentHero.tsx`) gagne une action **« Contacter »**
rendue seulement si `t.referee?.contactable` **ET** le viewer a une inscription non annulée
(déjà chargée par la fiche via `GET /api/tournaments/:id/registration`). Clic →
`api.contactTournamentReferee(id, token)` → `openDm(otherUserId, { isDesktop, navigate,
draft })` (`lib/messages.ts`) avec brouillon pré-rempli « Bonjour, à propos du tournoi
{nom}… » (pattern « Inviter à jouer » de `FriendsHub`). Erreurs mappées façon `DM_ERRORS`
(`REFEREE_NOT_CONTACTABLE` → « Le juge-arbitre n'est pas joignable pour le moment. »,
`NOT_REGISTERED` → « Réservé aux inscrits du tournoi. », + pass-through des erreurs DM).

Un anonyme ou un non-inscrit ne voit **pas** le bouton (et l'endpoint le refuse de toute
façon).

### Espace `/me/refereeing`

Bloc « Contact » en tête de page (sous le `<h1>`, avant le `Segmented` À venir/Passés) :
`Segmented` 3 états — « Toujours » / « Après clôture » / « Jamais » — + une phrase
explicative (« Les inscrits de vos tournois peuvent vous écrire via la messagerie. »).
**Persistance immédiate optimiste** (pattern `ClubHouseSectionsCard` : la page n'a pas
d'infrastructure brouillon/SaveBar, et un contrôle isolé s'enregistre au clic) ; erreur →
message inline + retour à la valeur serveur.

### Types `lib/api.ts`

- `Tournament.referee?: { name: string; contactable?: boolean } | null` — `contactable`
  **optionnel** (convention des champs additifs partagés).
- 3 méthodes : `getRefereeContactPolicy(slug, token)` /
  `setRefereeContactPolicy(slug, policy, token)` /
  `contactTournamentReferee(tournamentId, token)`.

## Tests

- **Backend** — `tournament.service.test.ts` : `contactable` calculé (ALWAYS, AFTER_DEADLINE
  avant/après clôture, NEVER, facette retirée → false) ; contact : non-inscrit 403,
  inscription annulée 403, NEVER 409, AFTER_DEADLINE avant clôture 409, pas de J/A 404,
  succès délègue à `MessagingService.getOrCreateConversation` avec les bons arguments.
  Routes : `clubs.referee.routes.test.ts` (GET/PATCH policy, `NOT_A_REFEREE`, valeur
  invalide 400) + `tournaments.routes.test.ts` (contact-referee, auth requis).
- **Front** — `TournamentHero`/`TournamentDetail` : bouton présent (contactable + inscrit),
  absent (non contactable / non inscrit / anonyme), clic → `contactTournamentReferee` puis
  `openDm` avec draft ; page refereeing : segmented rend la valeur, PATCH au clic, erreur
  inline. ⚠️ les suites qui montent la fiche devront mocker les nouvelles méthodes `api`.

## Hors périmètre (v1)

- Réglage **par tournoi** (le par-club suffit ; à revisiter si un J/A le demande).
- Contact par des non-inscrits ou depuis le calendrier national.
- Exposition de coordonnées (téléphone/email/licence) — jamais.
- Notification/email spécifique « un inscrit vous a écrit » (le DM notifie déjà :
  in-app + push + email coalescé par conversation).
- Contact du J/A par le staff (ils se croisent au club ; le staff a déjà l'annuaire).
- Outrepasser l'opt-out DM global du J/A (`acceptsDirectMessages=false` reste souverain).
