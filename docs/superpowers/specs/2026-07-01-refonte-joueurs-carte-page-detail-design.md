# Refonte « ajout / modification de joueurs » — carte compacte + page détail

**Date :** 2026-07-01
**Statut :** design validé (à implémenter)

## Contexte

Aujourd'hui, sur une **partie ouverte** (`/parties`), la carte `OpenMatchCard`
embarque **toute** la gestion des joueurs : l'édition des équipes (`MatchTeams`
éditable), la recherche/ajout de joueur (`PartnerSearch`), le remplacement, le
retrait — le tout compressé dans la carte de liste. Résultat : des noms rognés,
une carte surchargée, une édition peu lisible en mobile.

La demande utilisateur : **sortir l'ajout/modif de la carte**. La carte de liste ne
montre plus qu'**une pastille (avatar) par joueur, sans le nom entier**. On **clique
sur la partie** pour ouvrir une **vraie page** où l'on **ajoute/modifie chaque joueur
individuellement** *et* où l'on **discute** de la partie. Cette page est essentielle :
elle doit être **fonctionnelle, très belle et lisible en mobile comme en desktop**.

Le pattern « résumé compact en liste / édition riche sur une surface dédiée » est
appliqué **à toutes les surfaces joueurs** du site.

## Décisions (issues du brainstorming)

- **Périmètre = toutes les surfaces joueurs** : /parties (liste + page détail),
  `BookingModal` (création), `ReservationPlayersInline` (calendrier), affichage
  calendrier (`MyAgendaListItem`/`DayPanel`).
- **Carte de liste = pastilles avatar seules** (pas de nom), **carte cliquable** vers
  la page détail, on **garde le bouton « Rejoindre »** rapide. Tout le reste (équipes,
  ajout, remplacement, chat, résultat, partage) part sur la page détail.
- **Page détail = 2 colonnes en desktop** (infos + équipes à gauche, chat à droite,
  toujours visible) / **onglets `Partie` / `Discussion` en mobile**.
- **On intègre** le plan existant « chat ouvert à tous / suppression de *Ça m'intéresse* »
  (`docs/superpowers/{specs,plans}/2026-07-01-chat-partie-ouverte-ouvert-a-tous*`) dans
  ce même chantier, car « le détail = là où l'on discute » suppose un chat accessible.

## Architecture — deux composants partagés + une page

On factorise la représentation des joueurs en **deux briques** réutilisées partout,
plus l'extraction du chat en panneau embarquable.

### A. `PlayerAvatars` (nouveau) — présentation compacte

`frontend/components/player/PlayerAvatars.tsx`

- **Avatars seuls** (ronds `colorForSeed`), **aucun nom**. Anneau « ami » (prop
  `friendIds`), mini-marqueur « orga » discret (point/anneau accent), puces « place
  libre » en pointillés pour les places restantes, débordement `+N` si trop de joueurs
  pour la largeur (borne `max`, défaut raisonnable).
- Présentation **pure**, aucune action. Props : `players: PlayerPillData[]`,
  `spotsLeft?`, `friendIds?`, `size?`, `max?`.
- Accessibilité : chaque avatar porte un `title`/`aria-label` avec le nom complet
  (le nom reste accessible au survol / lecteur d'écran même s'il n'est pas affiché).
- Consommateurs : `OpenMatchCard` (liste), `MyAgendaListItem` (lecture),
  `DayPanel` (lecture), et tout affichage résumé de joueurs.

### B. `MatchTeams` (redesign) — édition riche, belle et lisible

`frontend/components/match/MatchTeams.tsx` (composant existant, **refonte visuelle**)

- Conserve : Éq.1 (gauche, `ACCENTS.blue`) vs Éq.2 (droite, `ACCENTS.coral`), « VS »
  central, emplacements fixes par équipe, côte à côte même en mobile, positions
  mémorisées en session, logique `onSetTeams`/`onMove`/`applyTeams` **inchangée**.
- Améliore : **grande carte par joueur** — avatar + **nom complet** (jamais rogné à
  zéro : nom en ligne 1 pleine largeur, métadonnées en ligne 2) + **chip niveau**
  (`LevelChip`) + badge « orga ». En mode `editable`, contrôles **par joueur** clairs
  et espacés (passer d'équipe →, remplacer 🔍, retirer ✕) + emplacement libre `+` (ajout
  ciblé à un côté). Cible **desktop aérée** (cartes plus grandes, `size` étendu) et
  **mobile lisible** (2 colonnes, wrap des contrôles sous le nom).
- Le redesign profite **automatiquement** à `BookingModal`, `ReservationPlayersInline`
  et la page détail, qui l'utilisent déjà.

### C. `MatchChatPanel` (nouveau) — chat embarquable

`frontend/components/openmatch/MatchChatPanel.tsx`

- **Extrait le contenu interne** de `OpenMatchChatSheet` (liste des messages, SSE via
  `chatStreamUrl`, envoi optimiste, suppression `ConfirmDialog`, emojis) en un panneau
  **qui remplit son conteneur** (pas de `position:fixed`, pas d'enveloppe grisée).
- Props : `slug, token, reservationId, viewerUserId, viewerIsOrganizer, canModerate,
  timezone`. Marque « lu » (`api.markOpenMatchChatRead`) à l'ouverture, émet
  `palova:openmatch-unread`.
- La page détail l'embarque (colonne droite desktop / onglet mobile).
- `OpenMatchChatSheet` devient un **fin habillage** de `MatchChatPanel` (feuille
  mobile / widget desktop) **ou est retiré** si plus aucun appelant. La carte n'ouvre
  plus le chat → le state `chatting` et l'usage dans `OpenMatchModals` disparaissent.

## La carte de liste — `OpenMatchCard`

- **Corps** : terrain + chip sport (si multi-sport) + fourchette de niveau + chip
  places (inchangés) ; créneau ; ligne « N de vos amis jouent ici » (inchangée) ;
  **`PlayerAvatars`** à la place de `MatchTeams`/`PartnerSearch`.
- **Cliquable** : la carte entière est un lien vers `/parties/[id]` (`next/link`).
- **Barre d'actions réduite** :
  - Non-participant : **« Rejoindre »** (stopPropagation ; anonyme → `onAuthPrompt`).
  - Participant : chip « Inscrit ✓ ». Organisateur : chip « Vous organisez ».
  - **Indicateur de non-lus** discret (💬 + `unreadCount`) si > 0, faisant partie du
    lien vers le détail (plus de bouton « Discuter » séparé).
- **Retiré de la carte** : `MatchTeams` éditable, `PartnerSearch`/`addMode`,
  « Discuter », « Ça m'intéresse » (supprimé par ailleurs), « Saisir le résultat »,
  « Quitter », partage → **tous déplacés sur la page détail**.
- Props supprimées : `onSetTeams`, `onAddPlayer`, `onReplacePlayer`, `onToggleAdd`,
  `onCancelAdd`, `onRemovePlayer`, `onRecordResult`, `onOpenChat`, `onToggleInterest`,
  `addingOpen`. Conservées : `match`, `friendIds`, `timezone`, `onJoin`, `onAuthPrompt`,
  `isAnonymous`, `showSport`.

## La page détail — `OpenMatchDetail` (`/parties/[id]`)

`frontend/app/parties/[id]/page.tsx` (**nouveau** — la route n'existe pas encore)
rend `OpenMatchDetail` (refonte du composant existant).

### Layout

- **Header pleine largeur** : retour « ‹ Parties », terrain · sport · date/créneau,
  chips (fourchette niveau, places), **partage** (`ShareActions`, `uidPrefix 'match'`,
  déjà en place).
- **Desktop (`useIsDesktop`)** : deux colonnes.
  - **Gauche (~ 60 %)** : carte **Infos** (terrain, format, créneau, prix, niveau,
    organisateur) ; **`MatchTeams`** (éditable pour l'organisateur, lecture sinon) avec
    ajout/remplacement/retrait par joueur ; ligne « vos amis jouent ici » ; **actions**
    (« Rejoindre »/« Quitter », « Saisir le résultat » quand éligible).
  - **Droite (~ 40 %)** : **`MatchChatPanel`** toujours visible (hauteur bornée,
    sticky agréable).
- **Mobile** : header, puis **`Segmented` `Partie` / `Discussion`**.
  - « Partie » : Infos + `MatchTeams` + actions.
  - « Discussion » : `MatchChatPanel` plein écran.
- **Recherche d'ajout** (`PartnerSearch` + `FriendsQuickRow`) rendue **dans la colonne
  gauche / onglet Partie** (sous les équipes) quand l'organisateur déclenche un ajout /
  remplacement — même logique `addMode` qu'aujourd'hui, mais dans un espace lisible.

### États & accès

- **Chargement** : `api.getOpenMatch(slug, id, token?)` (existant). `notfound` →
  « Cette partie n'existe plus. »
- **Anonyme** : peut **voir** (token optionnel) ; « Rejoindre » → `AuthPromptDialog`
  (`next=/parties/[id]`) ; le chat affiche une invite à se connecter (pas de saisie).
- **Connecté non-organisateur** : équipes en lecture, « Rejoindre »/« Quitter »,
  chat actif.
- **Organisateur** : édition complète des équipes + ajout/remplacement/retrait.
- **Actions** réutilisent `useOpenMatchActions` (join/leave/setTeams/addPlayerToTeam/
  replacePlayer/removePlayer/record) et `OpenMatchModals` (résultat, join-warning,
  auth-prompt) — le state/`OpenMatchChatSheet` du chat en modale n'est plus utilisé sur
  cette page (chat embarqué).

## Propagation aux autres surfaces

- **`BookingModal`** (création) : garde `MatchTeams` éditable — hérite du redesign,
  aucun changement de logique (`teamsDraft`, `buildPlayers`, `teams` au payload).
- **`ReservationPlayersInline`** (calendrier, résa perso) : garde `MatchTeams`
  (padel) / `PlayerPills` (autres) éditables — hérite du redesign, logique inchangée.
- **`MyAgendaListItem` / `DayPanel`** : l'**affichage lecture** des participants passe
  de `MatchTeams`/`PlayerPills` à **`PlayerAvatars`** (compact, cohérent avec la carte).
  L'**édition inline** de sa propre résa à venir (`ReservationPlayersInline`) reste
  disponible (elle, en `MatchTeams` riche).
- **Hors périmètre** : on **ne crée pas** de page détail pour une réservation privée
  (non publique) — il n'en existe pas et l'exemple utilisateur porte sur les parties
  ouvertes. L'édition d'une résa privée reste inline (mais plus belle grâce au redesign).

## Chat ouvert à tous + suppression de « Ça m'intéresse »

Intégré depuis le plan existant
`docs/superpowers/{specs,plans}/2026-07-01-chat-partie-ouverte-ouvert-a-tous*` :

- **Accès chat** = tout utilisateur connecté (adhésion ACTIVE créée à la volée, refus
  `BLOCKED`) via le helper partagé `backend/src/services/membership.ts`. Plus de
  condition « participant OU intéressé ».
- **Notifs de message** = participants ∪ auteurs de messages (− auteur − connectés SSE).
- **Suppression totale** de `OpenMatchInterest` : modèle Prisma + table
  `open_match_interests` (migration destructive `drop_open_match_interests`, dev via
  `prisma db execute`, prod via `migrate deploy`), routes `/interest`,
  `notifyOpenMatchInterest`, champs DTO `interestedCount`/`viewerIsInterested`/
  `interested`, méthodes front `setInterested`/`removeInterested`, handler
  `toggleInterest` et prop `onToggleInterest`.
- **Anonyme** : « Rejoindre » et le chat renvoient vers `AuthPromptDialog`.

## Tests

**Frontend :**
- `PlayerAvatars` : rend N avatars sans nom visible, `+N` au-delà de `max`, places
  libres, anneau ami, `title` = nom complet.
- `MatchTeams` (redesign) : nom complet lisible, chip niveau, contrôles par joueur
  (déplacer/remplacer/retirer/ajouter) ; cas 2v2 complet (permutation) ; non-éditable
  = pas de contrôles.
- `MatchChatPanel` : liste, envoi optimiste, suppression, marquage lu, SSE `upsert`.
- `OpenMatchCard` (compacte) : pastilles sans nom, carte = lien `/parties/[id]`,
  « Rejoindre » (stopPropagation), anonyme → `onAuthPrompt`, indicateur non-lus, plus
  de `MatchTeams`/`PartnerSearch`/« Discuter »/« Ça m'intéresse ».
- `OpenMatchDetail` : header + partage, 2 colonnes desktop / onglets mobile, édition
  organisateur, join/leave, chat embarqué, anonyme (voir + invites), `notfound`.
- Suites impactées mises à jour : `OpenMatches`, `MyAgendaListItem`/calendrier,
  `MatchesForYou`/`recommend` (mocks `OpenMatch` sans `interested*`).

**Backend :** repris du plan chat-ouvert — `membership`, `openMatchChat.service`
(accès à tous), `notifications.openmatch-chat` (destinataires), `openMatch.service`
(DTO sans intérêt), routes.

## Livraison par phases

1. **Fondation** : `PlayerAvatars`, redesign `MatchTeams`, `MatchChatPanel` (+ tests).
2. **Carte + route** : `OpenMatchCard` compacte cliquable, `/parties/[id]/page.tsx`.
3. **Page détail** : `OpenMatchDetail` 2 colonnes / onglets + chat embarqué + actions.
4. **Propagation** : calendrier (`PlayerAvatars` en lecture), vérif BookingModal /
   ReservationPlayersInline.
5. **Backend chat-ouvert + suppression « intéressé »** (plan 2026-07-01 folded).
6. **Docs + vérification finale** (tsc + suites ciblées).

## Hors périmètre

- Page détail pour réservations privées (non publiques).
- Chat générique tournois/events, réactions/réponses, accusés de lecture par joueur.
- Drag-and-drop desktop des joueurs, verrouillage d'équipe, équipes en admin.
- Conserver l'« intéressé » comme preuve sociale (supprimé).

## Fichiers touchés (récapitulatif)

**Nouveaux :** `frontend/components/player/PlayerAvatars.tsx`,
`frontend/components/openmatch/MatchChatPanel.tsx`,
`frontend/app/parties/[id]/page.tsx`,
`backend/src/services/membership.ts`,
migration `drop_open_match_interests`.

**Modifiés :** `frontend/components/match/MatchTeams.tsx` (redesign),
`frontend/components/openmatch/{OpenMatchCard,OpenMatchDetail,OpenMatchModals,
useOpenMatchActions,OpenMatchChatSheet,OpenMatches}.tsx`,
`frontend/components/calendar/{MyAgendaListItem,DayPanel}.tsx`,
`frontend/lib/api.ts` (retrait `interested*` + méthodes),
`backend/src/services/{openMatch.service,openMatchChat.service}.ts`,
`backend/src/email/notifications.ts`, `backend/src/routes/clubs.ts`,
`backend/prisma/schema.prisma`, + tests listés.
