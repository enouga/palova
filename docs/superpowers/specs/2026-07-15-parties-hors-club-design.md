# Parties hors club (CommunityMatch) — partage sur les réseaux — Design

**Date** : 2026-07-15
**Statut** : spec validée (brainstorming avec Eric, maquettes comparées dans le companion visuel)

## Contexte & objectif

Aujourd'hui une partie ouverte EST une `Reservation` (`visibility: PUBLIC`) posée sur un terrain
réservé d'un club Palova. Un joueur qui a réservé une piste **ailleurs** (club non-Palova, réservé
via Playtomic ou en direct) ne peut rien créer sur Palova.

Objectif : permettre de créer une **partie ouverte « hors club »** — terrain déclaré par
l'organisateur, n'importe où — et de la **partager sur les réseaux** (WhatsApp, Instagram…) avec le
« lien vivant » (carte OG temps réel) pour la remplir. Le pari produit : le lien partagé remplace le
groupe WhatsApp (état réel + rejoindre en un tap), et chaque partage devient un entonnoir de
création de comptes Palova chez des joueurs dont le club n'est pas client.

## Décisions de cadrage (validées)

| Question | Décision |
|---|---|
| Où vivent ces parties ? | **Plateforme uniquement** : création, feed et fiches sur `palova.fr` (hôte plateforme). Jamais sur un sous-domaine club. |
| Capture du lieu | **Structuré léger** : `venueName` + `venueCity` (autocomplete ville BAN), géocodage best-effort. Pas de référentiel `Venue` en v1. |
| Rejoindre | **Compte Palova obligatoire** (flux existant `AuthPromptDialog` → register/login → retour `?next=`). Pas de participants « invités », pas de téléphone, pas d'OTP. |
| Découverte | **Feed national fusionné** : parties ouvertes des clubs Palova + parties hors club dans une même page `palova.fr/parties`, avec option « ne pas lister publiquement » à la création (accès par lien seul). |
| Briques embarquées v1 | Équipes G/D + rejoindre par place ciblée, fourchette de niveau déclarée, chat de partie, **padel uniquement**. Pas d'alertes (scopées club). |
| Architecture | **Nouveau modèle dédié** `CommunityMatch` (+ participants). AUCUNE modification de `Reservation` (le `resourceId` nullable a été écarté : trop risqué, il irrigue conflits/pricing/SSE/quotas/caisse). Le club fantôme a été écarté (pollue admin/billing/stats). |
| Création (UI) | **Page « studio »** `palova.fr/parties/creer` 2 colonnes : formulaire + **aperçu vivant de la carte de partage WhatsApp** qui se construit pendant la saisie. |
| Feed (UI) | Badge **« Terrain réservé ✓ »** sur les parties club (garantie système) ; mention « Lieu indiqué par l'organisateur » sur les parties hors club. |

## Modèle de données

Migration **additive** `add_community_matches` (DEV : `prisma db execute` du SQL, prod :
`migrate deploy` — dérive de base connue). Rien de touché sur `Reservation`.

```prisma
model CommunityMatch {
  id             String    @id @default(cuid())
  organizerId    String                    // FK User, onDelete: Cascade
  venueName      String                    // « Padel Factory »
  venueCity      String                    // « Toulouse »
  venueLat       Float?                    // géocodage BAN best-effort
  venueLng       Float?
  department     String?                   // « Haute-Garonne » (pattern Club)
  departmentCode String?                   // « 31 »
  startTime      DateTime  @db.Timestamptz // saisie heure locale, Europe/Paris hardcodé v1
  endTime        DateTime  @db.Timestamptz
  targetLevelMin Float?                    // fourchette 1–8, les deux ou aucune (normalizeLevelRange)
  targetLevelMax Float?
  note           String?                   // « Terrain 3, entrée par le parking » (≤ 300 car.)
  listed         Boolean   @default(true)  // false = accessible par lien seulement
  maxPlayers     Int       @default(4)     // padel 2v2 (champ prêt pour la suite)
  cancelledAt    DateTime?
  createdAt / updatedAt
}

model CommunityMatchParticipant {
  id       String   @id @default(cuid())
  matchId  String                          // FK CommunityMatch, onDelete: Cascade
  userId   String                          // FK User, onDelete: Cascade
  team     Int?                            // 1 | 2, null = dérivé à la lecture
  slot     Int?                            // 0 = G, 1 = D
  joinedAt DateTime @default(now())
  @@unique([matchId, userId])
}
```

**Chat** : `OpenMatchMessage.reservationId` devient **nullable** + nouvelle FK nullable
`communityMatchId` (cascade). Exactement une des deux renseignée — garantie applicative, pattern
éprouvé `Payment`/`MessageReport`. Les signalements de modération (`MessageReport`) FK le message :
ils marchent sans changement.

- Pas de statut enum : `cancelledAt` suffit (création directe, pas de PENDING).
- L'**organisateur est aussi participant** : ligne créée à la création (team 1, slot 0), comme le
  semis Éq.1/G de BookingModal.
- **Suppression de compte (RGPD)** : `AccountService.deleteAccount` annule les parties hors club
  futures de l'organisateur (notif aux participants) ; FK Cascade en filet.

## Backend

**`CommunityMatchService`** (`backend/src/services/communityMatch.service.ts`, calqué sur
`OpenMatchService`) :

- `create(userId, input)` — validations : futur, durée ≤ 3 h, horizon ≤ 30 j, `venueName`/`venueCity`
  requis (trim), fourchette via le pattern `normalizeLevelRange` (les deux bornes ou aucune, 1–8,
  min ≤ max), note ≤ 300. Géocodage `geo.service` **best-effort** (échec → lat/lng/département
  null, jamais bloquant). Rate-limit `assertRateLimit('cmatch:create', userId, 10, 86400)`.
- `getById(id, viewerUserId | null)` — public, résout aussi passées/annulées (un lien partagé
  répond toujours) ; flags viewer (`viewerIsParticipant`/`viewerIsOrganizer`).
- `join(id, userId, target?: { team, slot? })` — transaction **Serializable**, place ciblée validée
  contre `effectiveTeams` (helpers purs réutilisés tels quels) ; erreurs `TEAM_INVALID` /
  `TEAM_SIDE_FULL` / `TEAM_SLOT_TAKEN` (400), `MATCH_FULL` / `ALREADY_PARTICIPANT` /
  `MATCH_CANCELLED` / `MATCH_PAST` (409/400).
- `leave(id, userId)` — l'organisateur ne quitte pas, il annule.
- `removeParticipant` / `setTeams` (via `applyTeams`) / `cancel` — organisateur seul
  (`NOT_ORGANIZER` 403).
- `listNational()` — parties `listed`, non annulées, à venir (≤ 30 j), non pleines, cap.
- DTO calqué sur le DTO OpenMatch : joueurs avec `team`/`slot`, niveaux via
  `ratingService.getLevelsForUsers` (padel, global), `cardVersion` (hash d'état, miroir
  `matchCardState`).

**Feed fusionné** : le endpoint existant **`GET /api/open-matches/national`** reste l'unique
source (pas de `/national` côté community-matches) — `OpenMatchService.listNationalOpenMatches`
s'enrichit, chaque item gagne
**`kind: 'club' | 'community'`** ; les items club gardent `club{…}`, les items community portent
`venue{ name, city, lat?, lng?, department? }`. Consommateur existant (`NationalOpenMatches`
vitrine) mis à jour pour gérer les deux. Tri chrono ; cap global raisonnable (~100 pour la page
feed, le rail vitrine garde son cap 12).

**Chat** : `OpenMatchChatService` gagne une branche community — garde = **tout utilisateur
connecté** + partie non annulée (pas de club, pas d'adhésion) ; mêmes règles corps 1..2000,
soft-delete tombstone, suppression auteur/organisateur (pas de staff club) + modérateur plateforme.
SSE : réutilise le canal match existant (`addMatchClient`/`broadcastMatch`), clé = id du
CommunityMatch (espace de cuids distinct). Rate-limit `match:post` réutilisé.

**Routes** — nouveau routeur **`/api/community-matches`** (hors contexte club, monté dans app.ts) :

| Méthode | Route | Garde |
|---|---|---|
| POST | `/` | auth |
| GET | `/:id` | optionalAuth |
| POST | `/:id/join` | auth, body `{ team?, slot? }` |
| DELETE | `/:id/leave` | auth |
| DELETE | `/:id/participants/:userId` | organisateur |
| POST | `/:id/teams` | organisateur, body `{ teams, slots? }` |
| POST | `/:id/cancel` | organisateur |
| GET/POST/DELETE | `/:id/chat/messages[...]`, POST `/:id/chat/read` | auth (garde community) |
| GET | `/:id/chat/stream` | token JWT en query (pattern existant) |
| GET | `/:id/card.png` | public, `Cache-Control: max-age=300` |

**Carte OG « lien vivant »** : `matchCard.service` paramétré **marque Palova** (dégradé encre +
logo Palova embarqué, nom du lieu + ville à la place du club) ; cache disque
`uploads/ogcards/<id>-<cardVersion>.png` + purge, repli PNG embarqué (jamais de 500 pour un
crawler). URL partagée versionnée `?s=<cardVersion>` (helpers `matchShareUrl`/`matchShareText`
étendus).

**Notifications** (best-effort `safeNotify`, catégorie `MY_GAMES`) : rejoint / retiré / quitté /
partie annulée → organisateur et/ou participants, in-app + push + email. Emails **identité Palova**
(pas de club → pas de personnalisation `/admin/emails` ; builders sur le layout existant avec brand
Palova par défaut). Chat : notif « nouveau message » aux absents du flux SSE, miroir de l'existant,
type dédié (ex. `community_match.message`).

## Frontend

**Routing par hôte** : `app/parties/page.tsx` et `app/parties/[id]/page.tsx` branchent sur
`useClub().slug === null` (pattern `/tournois`) — hôte club : comportement actuel inchangé ; hôte
plateforme : feed national / fiche CommunityMatch. `isPlatformPublicPath` (`lib/authGate.ts`)
gagne `/parties` et `/parties/[id]` ; **`/parties/creer` reste gaté** (login requis).

**Création — page « studio » `/parties/creer`** (2 colonnes ≥ 700 px, empilées mobile, bascule CSS
pure `.pl-create-grid` existante) :
- Formulaire : lieu (nom + ville avec **autocomplete BAN** côté front, `api-adresse.data.gouv.fr`
  type municipality), date (`DateField`) + heure (`TimePicker`) + chips durée 1h/1h30/2h,
  fourchette de niveau optionnelle (case + `LevelRangeSlider`, défaut 3–6, pattern
  `MatchAlertSheet`), note libre optionnelle, toggle « Visible dans le feed national » (ON défaut).
- Colonne droite : **aperçu vivant de la carte de partage** (rendu CSS de la carte OG : bulle
  WhatsApp avec date, lieu, sièges, niveau) mis à jour à chaque frappe + CTA « Créer la partie ».
- Post-création : navigation vers `/parties/[id]` avec la **feuille de partage ouverte**
  (Web Share natif mobile, repli copie).

**Feed `/parties` (plateforme)** : cartes fusionnées (pattern `OpenMatchesShowcase`/
`NationalOpenMatches` — sièges pointillés, fourchette niveau, date au fuseau) ; parties club =
liseré accent club + badge **« Terrain réservé ✓ »** (emerald) + lien cross-sous-domaine
`clubUrl(slug, '/parties/'+id)` ; parties hors club = mention « Lieu indiqué par l'organisateur »
+ lien local. Filtres v1 : **Quand** (presets weekend/semaine — pattern `whenWindow`),
**📍 Autour de moi** (géoloc → tri distance haversine, pattern `TournamentFinder`), **Niveau**
(chevauchement de fourchette). CTA « Créer une partie » (connecté ; anonyme → login).

**Fiche `/parties/[id]` (plateforme)** : composant serveur + `generateMetadata` (OG →
`card.png?v=`, repli neutre) ; hero brume bleue (`HERO_GRADIENT`/`HERO_INK`) : date/heure, lieu +
lien **« Itinéraire »** Google Maps (search `venueName venueCity`), mention « Lieu indiqué par
l'organisateur » ; mini-terrain **`MatchTeams` réutilisé tel quel** (join par place libre,
permutation organisateur) ; chat (feuille existante `OpenMatchChatSheet` adaptée au endpoint
community) ; `ShareActions` (Partager + .ics via `buildAgendaICS` uidPrefix `match`) ; actions
organisateur (retirer joueur, annuler avec `ConfirmDialog`). Anonyme : tout voir, « Rejoindre » →
`AuthPromptDialog` → `?next=/parties/[id]`. Partie passée/annulée : lecture seule, bandeau d'état.

**Vitrine** : le rail `NationalOpenMatches` de `AnonymousView` affiche les deux kinds + lien
« Voir toutes les parties → » vers `/parties`. Entrée « Parties » pour le connecté sur la landing
plateforme.

## Garde-fous & erreurs

- Rate-limits (`rateLimit.ts`, fail-open) : création 10/j/user, join 30/h, chat `match:post` 12/min.
- Bornes création : futur, durée ≤ 3 h, horizon ≤ 30 j, textes trim + longueurs (nom/ville ≤ 80,
  note ≤ 300).
- `listed: false` → absent du feed et du rail vitrine ; `getById` répond toujours.
- Fuseau : **Europe/Paris hardcodé v1** (les lieux n'ont pas de fuseau — limitation assumée,
  cohérente cible FR).
- Modération : signalement des messages de chat (flux existant → superadmin) ; le signalement de
  la partie elle-même est hors v1.
- Codes d'erreur mappés côté front (`BOOKING_ERRORS`-like) : `MATCH_FULL`, `MATCH_CANCELLED`,
  `MATCH_PAST`, `ALREADY_PARTICIPANT`, `NOT_ORGANIZER`, `TEAM_*`, `RATE_LIMITED`,
  `VALIDATION_ERROR`.

## Tests

- **Backend** : `communityMatch.service` (create/validations/rate-limit, join ciblé ×erreurs,
  leave/remove/setTeams/cancel, listNational listed/fenêtre/plein, RGPD cascade),
  `community-matches.routes` (gardes auth/organisateur, chat, 404 sans fuite), feed fusionné
  (`openMatch.service` kinds), chat community (garde connecté, modérateur plateforme), carte OG
  (hash/cache/repli), notifications (destinataires, best-effort non bloquant).
- **Frontend** : helpers purs (mapping feed/filtres, libellés, share URL), `CommunityMatchStudio`
  (validations, aperçu vivant, autocomplete), feed (badge club vs mention, filtres), fiche
  (join anonyme → AuthPrompt, join ciblé, organisateur, chat), `NationalOpenMatches` (2 kinds).

## Hors v1 (explicitement parqué)

- Alertes de parties **géographiques** (« autour de Toulouse ») — les alertes actuelles restent
  scopées club.
- Multi-sport (padel only), fuseaux réels par lieu, récurrence.
- Référentiel `Venue` consolidé + page « toutes les parties à ce lieu » (les données nom+ville le
  permettront plus tard).
- **Heatmap B2B** des lieux (« 37 parties au Club X le mois dernier ») — sous-produit analytics à
  construire sur ces données.
- Participants invités sans compte / OTP SMS.
- Signalement d'une partie (au-delà des messages), bannissement plateforme.
