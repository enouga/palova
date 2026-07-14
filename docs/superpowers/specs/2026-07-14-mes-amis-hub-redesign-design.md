# Mes amis — hub social vivant (redesign complet)

**Date** : 2026-07-14
**Statut** : validé (brainstorming avec Eric, direction A choisie sur maquettes comparées dans le companion visuel — 3 pistes : A hub à sections / B deux onglets / C répertoire unifié)

## Contexte & problème

La page `/me/friends` (`FriendsHub`) est fonctionnelle mais brute :

- **5 onglets plats** (Amis / Demandes / Abonnements / Abonnés / Trouver) pour deux systèmes qui se recouvrent — le *suivi* à sens unique (`Follow`) et l'*ami confirmé* (`Friendship`) — conceptuellement lourd pour un joueur.
- **Mur de boutons grisés** « N'accepte pas les demandes » dans Trouver : l'opt-in `User.acceptsFriendRequests` est OFF par défaut, quasi personne ne l'active → la fonction amis est de fait morte et l'annuaire a un ton négatif.
- **Page de gestion pure** : lignes identiques avatar + nom + 3 boutons, aucune valeur vivante (quand jouent mes amis ? avec qui ai-je joué ?).

## Décisions de cadrage (validées)

1. **Refonte complète** : visuel + structure + utilité.
2. **Amis + Favoris** : le suivi à sens unique est renommé **« Favoris ★ »** face utilisateur — un marque-page privé (« mes joueurs sous la main » pour composer une partie), sans notion sociale. **« Amis »** reste le lien confirmé (demande + acceptation). Backend inchangé pour ça : modèles `Follow`/`Friendship`, routes et services gardent leurs noms techniques.
3. **Opt-in demandes d'ami : défaut ON** + backfill des comptes existants (personne n'avait explicitement choisi OFF — c'était le défaut). L'interrupteur du profil reste pour se retirer.
4. **Quatre briques vivantes en v1** : rail « Ça joue bientôt », suggestions « vous avez joué ensemble », carte ami enrichie (parties ensemble), CTA « Inviter à jouer ».
5. **Structure A — hub à sections, zéro onglet** (façon Club-house), l'annuaire « Trouver » est absorbé par la barre de recherche.

## Structure de la page (scroll unique)

Ordre des sections — chaque section optionnelle est **masquée si vide** :

1. **Titre + barre de recherche** — double rôle : filtre *mes* joueurs (amis + favoris) en direct, ET dès la saisie affiche les résultats **annuaire** (`searchClubMembers`) dans une section « Dans le club » avec les actions ★ / Ajouter en ami / 💬. Remplace l'onglet « Trouver ».
2. **Bannière Demandes** (brume bleue `HERO_GRADIENT` + `HERO_INK`) — seulement si demandes *reçues* : identité + Accepter / Refuser inline. Les demandes *envoyées* = ligne discrète en bas de bannière (« N envoyée(s) » avec Annuler par ligne dépliable). S'il n'y a que des envoyées (aucune reçue), la bannière s'affiche en variante discrète.
3. **Rail « Ça joue bientôt »** — cartes horizontales snap-scroll (pattern `OpenMatchesShowcase`) : parties ouvertes et tournois/events à venir où figurent mes amis **ou** favoris. Chaque carte : quand (jour + heure, fuseau club), quoi (label), avatars empilés des amis concernés, CTA → `/parties/[id]`, `/tournois/[id]` ou `/events/[id]`.
4. **Section « Amis · N »** — cartes riches (`cardStyle(th)`, ombre douce) : avatar coloré `colorForSeed`, nom, `LevelChip`, ligne vivante « 12 parties ensemble · sam. dernier », actions **⚡ Inviter à jouer** / **💬** / retirer (via menu ou bouton discret, `ConfirmDialog` pour retirer).
5. **Section « Suggestions »** — « Vous avez joué ensemble samedi », boutons **★** et **+ Ajouter en ami**. Masquée si vide.
6. **Section « Favoris ★ · N »** — chips compactes (avatar + prénom). Tap sur une chip → petite feuille d'actions (💬 message, ⚡ inviter, retirer ★). Un favori qui est déjà ami n'apparaît **que** dans Amis (dédup : Favoris = follows − amis confirmés).
7. **Pied « Qui me suit · N »** — ligne repliable discrète (remplace l'onglet Abonnés) : liste simple avec « ★ Suivre en retour » quand pertinent.

**Deep-links conservés** (URLs déjà émises par les notifications) :
- `?tab=demandes` → scroll sur la bannière Demandes ;
- `?tab=followers` → déplie et scrolle sur le pied « Qui me suit » ;
- `?tab=amis` / `?tab=following` (ou tout autre) → haut de page, sans erreur.

**États** : chargement (squelette léger ou « Chargement… » homogène) ; erreur réseau silencieuse par section (une brique qui échoue n'empêche pas le reste) ; page vide totale (aucun ami/favori/suggestion) → état d'accueil avec explication courte (« Retrouvez ici vos partenaires de jeu ») + focus sur la recherche.

## Renommage « Favoris » (transverse, 100 % libellés front)

Vérifié dans le code : la rangée d'ajout rapide (`FriendsQuickRow`, consommée par `PartnerSearch` → BookingModal, parties ouvertes, inscription tournoi, `NewConversationPanel`) est alimentée par `listClubFriends` = **mes follows** ∩ membres actifs du club. Le renommage est donc cohérent partout :

- `FriendsQuickRow` : titre « Mes amis » → **« Favoris ★ »**.
- `FollowButton` : « + Suivre / ✓ Suivi(e) » → **« ★ Favori / ★ Retirer »** (ou « ☆ Favori » inactif / « ★ Favori » actif — toggle étoile, l'état mutual n'affiche plus de libellé spécial).
- `OpenMatchCard` : « N de vos amis jouent ici » → **« N de vos favoris jouent ici »** (l'anneau sur les avatars `PlayerPills.friendIds` reste, il est déjà alimenté par `listFollowing`).
- `ProfileMenu` : l'entrée « Mes amis » ne change pas (la page s'appelle toujours Mes amis).
- Notification `follow.new` (« X vous suit ») : reformulée « X vous a ajouté en favori » — *texte de notif backend*, seule exception au « 100 % front » de ce chapitre (chaîne dans `notifyNewFollower`).

## Opt-in demandes d'ami : défaut ON

- **Migration additive `friend_requests_default_on`** :
  ```sql
  ALTER TABLE users ALTER COLUMN "acceptsFriendRequests" SET DEFAULT true;
  UPDATE users SET "acceptsFriendRequests" = true;
  ```
  DEV : `prisma db execute` du SQL (convention repo — jamais `db push`), prod : `migrate deploy`. Schéma Prisma : `@default(true)`.
- UI annuaire : un joueur qui a décoché l'opt-in n'affiche **aucun bouton ami** (juste ★ et 💬) — plus jamais de gros bouton grisé négatif. Le libellé de l'interrupteur profil ne change pas.
- Aucune autre logique ne bouge : `requestFriend` garde sa garde `FRIEND_REQUESTS_DISABLED`.

## Backend — trois briques additives (zéro breaking)

### 1. `GET /api/clubs/:slug/me/friends-agenda` — « Ça joue bientôt »

Nouveau service `FriendsAgendaService` (ou méthode dans `FollowService`/module dédié `friendsAgenda.service.ts`) :

- **Cercle** = mes amis confirmés (`Friendship` ACCEPTED) ∪ mes follows (`Follow.followerId = moi`).
- **Sources** (club courant, à venir, tri chrono, cap 6) :
  - Parties ouvertes : `Reservation` `visibility: PUBLIC`, `status: CONFIRMED`, `startTime > now`, ressource du club — où l'organisateur ou un participant ∈ cercle ;
  - Tournois `PUBLISHED` à venir du club dont une inscription non annulée contient un membre du cercle (capitaine ou partenaire) ;
  - Events `PUBLISHED` à venir du club avec une `EventRegistration` non annulée d'un membre du cercle.
- **Réponse** : `{ kind: 'match'|'tournament'|'event', id, startTime, endTime?, label, friends: [{ id, firstName, lastName, avatarUrl }] }[]` — `label` = intitulé (nom du tournoi/event ; pour une partie : format court type « Partie ouverte · {terrain} »). `friends` = seulement les membres du cercle (pas tous les joueurs), cap 4 par item.
- Auth requise, `ensureActiveMembership` non nécessaire (lecture) mais club ACTIVE requis ; cercle vide → `[]` sans requête lourde.

### 2. `GET /api/clubs/:slug/me/player-suggestions` — « Vous avez joué ensemble »

- **Vivier** : participants (et organisateurs) des réservations `CONFIRMED` **passées** des 90 derniers jours de ce club où je figure (comme organisateur ou participant).
- **Exclusions** : moi, super-admin, joueurs déjà suivis (follow), amis confirmés, demandes en cours (PENDING dans les deux sens), comptes supprimés (`deletedAt`).
- **Réponse** : `{ id, firstName, lastName, avatarUrl, level, lastPlayedAt, playedCount }[]`, tri `lastPlayedAt desc`, cap 8. Niveau via `resolvePreferredSportKey(caller)` + `ratingService.getLevelsForUsers` (même pattern que `listClubFriends`).
- Le libellé (« Vous avez joué ensemble samedi ») est construit **côté client** depuis `lastPlayedAt` (helper pur).

### 3. Enrichissement de `GET /api/me/friendships`

`FriendshipService.listFriends` renvoie en plus, par ami :

- `playedTogetherCount` : nombre de réservations `CONFIRMED` passées (tous clubs — l'amitié est globale) où les deux joueurs figurent (organisateur ou participant) ;
- `lastPlayedTogetherAt` : date de la plus récente ;
- `level` : niveau du sport préféré du caller (comme `listClubFriends`) — aujourd'hui absent de ce endpoint.

Implémentation : une requête groupée sur l'ensemble des amis retournés (pas de N+1). Champs **additifs** dans la réponse — le type front `Friend` les gagne en optionnel.

## « Inviter à jouer » ⚡ (100 % front)

- CTA sur la carte ami (et la feuille d'actions d'un favori) → ouvre la **messagerie privée pré-remplie** « On se fait une partie ? ».
- Mécanique : `openDm(userId, { isDesktop, navigate, draft? })` — le paramètre `draft` est transporté par l'event window `palova:open-dm` (desktop, widget ancré) et par l'URL `/me/messages?with=<id>&draft=<texte>` (mobile). `MessageComposer` gagne une prop `initialDraft?` appliquée **seulement si le brouillon courant est vide** (jamais d'écrasement).
- Rien côté backend.

## Front — organisation du code

- **`FriendsHub.tsx` réécrit** en orchestrateur de sections ; sections extraites dans `components/social/` : `FriendRequestsBanner.tsx`, `FriendsAgendaRail.tsx`, `FriendCard.tsx`, `SuggestionsRow.tsx`, `FavoritesRow.tsx`, `FollowersFooter.tsx` (noms indicatifs, à ajuster au plan).
- **Helpers purs testés** dans `lib/social.ts` (nouveau) : libellé relatif (« sam. dernier », « il y a 2 sem. » — paramétré par `now`, hydration-safe), dédup favoris − amis, mapping agenda → cartes, construction du libellé suggestion, parsing du deep-link `?tab=`.
- Types `lib/api.ts` : `Friend` enrichi (`playedTogetherCount?`, `lastPlayedTogetherAt?`, `level?` déjà là), nouveaux `FriendsAgendaItem`, `PlayerSuggestion`, méthodes `getFriendsAgenda`, `getPlayerSuggestions` ; `openDm` étendu (`lib/messages.ts`).
- Langage visuel : `SectionHeader`/`cardStyle` (pattern Club-house), `HERO_GRADIENT`/`HERO_INK` pour la bannière demandes, `ACCENTS` pour les touches de couleur, jamais de `new Date()` au rendu (horloge `now` posée en effet).
- Mobile d'abord : aucune section ne doit provoquer de scroll horizontal de page (rails en `.sp-scroll-x` ou équivalent), vérif CDP clair + sombre, 1280 + 390.

## Tests

**Backend** :
- `friendsAgenda.service.test.ts` : cercle amis ∪ follows, 3 sources, exclusions (parties passées, DRAFT/CANCELLED, non-PUBLIC), cap 6, cercle vide → `[]`.
- `playerSuggestions` (service) : vivier 90 j, exclusions (déjà suivi / ami / demande en cours / soi / supprimé), tri, cap 8.
- `friendship.service.test.ts` : `playedTogetherCount`/`lastPlayedTogetherAt`/`level` présents, pas de N+1 (une requête groupée).
- Routes : les 2 nouveaux endpoints (200 auth, 401 anonyme).
- Migration : `acceptsFriendRequests` défaut `true` (visible via `searchMembers` annoté `friend.requestable`).

**Frontend** :
- `FriendsHub` réécrit : rendu des sections, sections vides masquées, recherche → annuaire, bannière demandes (accepter/refuser/annuler), deep-links `?tab=demandes`/`?tab=followers`, état d'accueil page vide.
- `lib/social.ts` : helpers purs.
- `FriendsQuickRow` (« Favoris ★ »), `FollowButton` (libellés étoile), `OpenMatchCard` (« favoris »), `MessageComposer` (`initialDraft` seulement si vide), `openDm` (draft).

## Hors périmètre (v1)

- Groupes d'amis, suggestions cross-club, badges/streaks/anniversaires de matchs.
- Nouvelles notifications (on réutilise l'existant ; seule la formulation de `follow.new` change).
- Page « Trouver » dédiée (absorbée par la recherche).
- Endpoint agrégat unique « friends-hub » (on garde des briques réutilisables ; à reconsidérer si les 6 fetchs au montage posent problème).
- Réciprocité automatique des favoris, import de contacts.
