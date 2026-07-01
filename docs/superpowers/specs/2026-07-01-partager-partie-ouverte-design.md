# Partager une partie ouverte — Design

**Date :** 2026-07-01
**Statut :** validé, prêt pour le plan d'implémentation

## Problème

Les parties ouvertes (`Reservation` `visibility:PUBLIC`, padel) ne vivent aujourd'hui que sous forme de cartes dans la liste `/parties`. Il n'existe **ni URL par partie, ni endpoint de lecture unitaire** : impossible d'envoyer une partie précise à un ami pour qu'il la voie et la rejoigne. Les fiches tournoi (`/tournois/[id]`) et event (`/events/[id]`) disposent déjà d'un partage (Web Share API + repli copie + export `.ics`) via `components/tournament/ShareActions.tsx` ; les parties ouvertes n'ont pas d'équivalent.

Contexte favorable : la liste `/parties` est **déjà publique** (visible des anonymes, rejoignable par les non-membres — évolution 2026-06-29). Un lien partagé peut donc être ouvert par n'importe qui.

## Objectif

Permettre de **partager une partie ouverte** via un lien stable menant à une **page dédiée `/parties/[id]`**, depuis :
- un bouton « Partager » sur **chaque carte** de la liste `/parties` ;
- un bouton « Partager » + « Ajouter au calendrier » sur la **page dédiée**.

Le lien doit produire un **aperçu social riche** (Open Graph) dans WhatsApp/SMS.

## Décisions validées (brainstorming)

1. **Cible du lien** : page dédiée `/parties/[id]` (pas un simple deep-link dans la liste).
2. **Bouton « Partager »** : sur chaque carte **et** sur la page dédiée ; accessible à **tout visiteur** (la partie est publique), y compris anonyme.
3. **Composition de la page** : réutilise le composant `OpenMatchCard` existant (équipes, rejoindre, quitter, discuter, intéressé, résultat) — pas de hero dédié — avec un lien retour et la barre de partage.
4. **Refactor** : extraire la logique d'actions d'`OpenMatches` dans un hook partagé + un composant de modales, réutilisés par la liste et la page détail (une seule source de vérité).
5. **Aperçu OG** : oui — page `/parties/[id]` en **composant serveur** avec `generateMetadata` (fetch serveur de la partie), enveloppant un enfant client interactif.

## Architecture

### 1. Backend — lecture d'une partie unique

**Refactor du mapper DTO.** Extraire le mapping DTO inline de `listOpenMatches` (`openMatch.service.ts`, lignes ~121-152) dans un helper privé `toOpenMatchDTO(row, levels, unreadCount, viewerUserId)`. `listOpenMatches` continue de mapper la liste via ce helper — **comportement byte-identique** (aucun changement de la forme de réponse existante).

**Nouvelle méthode `getOpenMatch(slug, id, viewerUserId: string | null)` :**
- Résout le club ACTIVE via `resolveActiveClub(slug)` (public, sans exiger l'adhésion — miroir de `listOpenMatches`).
- Charge **une** réservation avec le même `include` que la liste (resource + participants + interests + dernier message).
- Rejette avec `RESERVATION_NOT_FOUND` si : introuvable, `visibility !== 'PUBLIC'`, `status !== 'CONFIRMED'`, sport ≠ padel, ou `resource.clubId !== club.id`.
- **Autorise les parties passées** (contrairement à la liste qui filtre `startTime > now`) pour qu'un lien partagé résolve toujours, même juste après le créneau.
- Calcule les niveaux (batch `getLevelsBySport` sur ≤ `maxPlayers` joueurs) et l'`unreadCount` du viewer (mêmes requêtes que la liste, scopées à ce match ; `0` si anonyme).
- Renvoie le DTO via `toOpenMatchDTO` — **strictement la même forme** que les éléments de `listOpenMatches`.

**Route.** `GET /api/clubs/:slug/open-matches/:id` en **`optionalAuth`** (public : pose `req.user` si Bearer valide, sinon anonyme). ⚠️ **Ordre des routes** : déclarée **après** `GET /:slug/open-matches/unread-count` (déjà présent), sinon `unread-count` serait capturé comme un `:id`. C'est le seul GET `:id` nu ; les autres routes `:id/...` ont un segment supplémentaire.

### 2. Frontend — API

`api.getOpenMatch(slug: string, id: string, token?: string): Promise<OpenMatch>` — Bearer optionnel (comme `getOpenMatches`). Réutilise le type `OpenMatch` existant (inchangé).

### 3. Refactor partagé — hook + modales

Extraire d'`OpenMatches.tsx` deux briques réutilisées par la liste **et** la page détail :

**Hook `useOpenMatchActions({ club, token, myLevel, reload })`** (nouveau fichier `frontend/lib/useOpenMatchActions.ts` ou `components/openmatch/useOpenMatchActions.ts`). Possède :
- État : `busyId`, `error`, `addingId`, et les cibles de modales `recordingFor`, `joinWarning`, `chatting`, `authPrompt`.
- Handlers (déplacés tels quels depuis `OpenMatches`) : `act`, `handleJoin`, `addPlayerToTeam`, `replacePlayer`, `toggleInterest`, `openChat`, `onToggleAdd`, `onCancelAdd`, `leave`, `removePlayer`, `setTeams`, plus les setters de modales.
- Le `reload` est fourni par le consommateur (la liste recharge toute la liste ; la page détail recharge la seule partie).

**Composant `<OpenMatchModals actions={...} club token viewerUserId canModerate />`** (`components/openmatch/OpenMatchModals.tsx`) : rend les 4 modales existantes (`MatchResultModal`, `ConfirmDialog` niveau hors fourchette, `OpenMatchChatSheet`, `AuthPromptDialog`) en lisant l'état du hook.

`OpenMatches.tsx` est réécrit pour consommer le hook + `<OpenMatchModals>` — **comportement inchangé** (les suites `OpenMatches.test.tsx` doivent rester vertes ; re-valider les mocks `api.*`, cf. note mémoire sur les suites montant le vrai `ClubNav`).

### 4. Bouton « Partager »

Nouveau composant **`components/openmatch/MatchShareButton.tsx`** (petit, autonome). Web Share API avec repli copie-lien — miroir de `ShareActions.share` :
```
const share = async (url, title) => {
  if (typeof navigator.share === 'function') { await navigator.share({ title, url }).catch(() => {}); return; }
  try { await navigator.clipboard.writeText(url); setCopied(true); /* reset 2s */ } catch {}
};
```
Props : `{ url: string; title: string; label?: string; variant?: 'card' | 'pill' }`. Gère `AbortError` (fermeture de la feuille de partage) silencieusement et le contexte non sécurisé (presse-papier indisponible) sans erreur visible.

- **Sur la carte** (`OpenMatchCard`) : un bouton « Partager » dans la barre d'actions, visible de **tous** (y compris `isAnonymous`). URL construite au clic = `${window.location.origin}/parties/${m.id}` (même sous-domaine — pas besoin de `clubUrl`). Titre = `Partie ouverte · ${m.resourceName}`.
- **Sur la page détail** : barre en tête façon `ShareActions` : « Partager » (URL = `window.location.href`) + « Ajouter au calendrier » (`.ics`).

### 5. Export `.ics`

Étendre le type `uidPrefix` de `buildAgendaICS` (`lib/tournament.ts`) : `'tournament' | 'event' | 'match'`. Adapter la partie en `AgendaICSItem` :
```
{ id: m.id, name: `Partie ouverte · ${m.resourceName}`, description: <fourchette niveau / places>, startTime: m.startTime, endTime: m.endTime, club: { name: club.name } }
```
`icsFilename(name)` réutilisé tel quel. Bouton « Ajouter au calendrier » présent **uniquement sur la page détail** (pas sur les cartes de liste, pour ne pas surcharger).

### 6. Page `/parties/[id]`

**Composant serveur `app/parties/[id]/page.tsx` :**
- `generateMetadata({ params })` :
  - `slug = (await headers()).get('x-club-slug')` (posé par `proxy.ts`, même mécanisme que `layout.tsx`).
  - `id = (await params).id` (Next 16 : `params` est une Promise).
  - `fetch(`${NEXT_PUBLIC_API_URL}/api/clubs/${slug}/open-matches/${id}`, { cache: 'no-store' })` (anonyme — suffisant pour l'OG).
  - Succès → `Metadata` : `title = "Partie ouverte · {court} · {date FR}"`, `description = "{places} · {fourchette niveau} · {club}"`, `openGraph` (mêmes titre/description + `images: [${API}/api/clubs/${slug}/icon/512.png]`), `twitter: { card: 'summary' }`.
  - Échec / introuvable / slug absent → repli neutre (`title: 'Partie ouverte'`), **jamais de throw**.
- Export par défaut (serveur) : `await params`, rend `<OpenMatchDetail matchId={id} />`.

**Composant client `components/openmatch/OpenMatchDetail.tsx` :**
- `useClub()` (club fourni par le `ClubProvider` du layout) + `useAuth()`.
- Mêmes gardes que `/parties/page.tsx` : « Chargement… » tant que `club` charge ; « Club introuvable » ; redirection vers `/` si le club n'a pas de padel (`clubHasPadel`).
- Charge la partie : `api.getOpenMatch(club.slug, matchId, token ?? undefined)`. Introuvable/annulée → état doux « Cette partie n'existe plus. » + lien « ← Retour aux parties » (pas de 404 dur).
- Rend, dans un `Screen` + `ClubNav` : lien retour « ← Parties », la barre de partage (Partager + Ajouter au calendrier), **un** `OpenMatchCard` (actions complètes via le hook `useOpenMatchActions`, `reload` = recharger cette seule partie), et `<OpenMatchModals>`.
- Charge les données annexes du viewer comme `OpenMatches` (myLevel via `getMyRating`, `viewerUserId` via `getMyProfile`, `canModerate` via `getMyClubs`, `friendIds` via `listFollowing`) — seulement si `token`.

## Flux de données

```
Liste /parties ──[Partager]──► navigator.share({ url: origin+/parties/{id} })
                                        │
Destinataire ouvre le lien ─────────────┘
   │  (crawler WhatsApp)          (utilisateur)
   ▼                                   ▼
generateMetadata (serveur)        OpenMatchDetail (client)
   fetch GET /open-matches/{id}      api.getOpenMatch(slug,id,token?)
   → OG title/desc/image             → OpenMatchCard + actions (join/chat/…)
```

## Gestion d'erreur

- **Backend** : `RESERVATION_NOT_FOUND` (404) pour toute partie non lisible (inexistante, non-PUBLIC, mauvais club, non-padel). `CLUB_NOT_FOUND` si le slug n'est pas un club ACTIVE.
- **`generateMetadata`** : tout échec réseau/404 → métadonnées de repli, jamais d'exception (pas de page 500 pour un aperçu).
- **`OpenMatchDetail`** : 404 → message doux + retour ; erreurs d'action → mêmes libellés `JOIN_ERRORS` que la liste (réutilisés via le hook).
- **`MatchShareButton`** : `AbortError` et presse-papier indisponible avalés silencieusement.

## Tests

**Backend**
- `openMatch.service.test.ts` : `getOpenMatch` — trouvée (membre), trouvée (anonyme, flags viewer à false), `RESERVATION_NOT_FOUND` (inexistante / non-PUBLIC / mauvais club / non-padel), partie **passée** lisible, `unreadCount` correct.
- Route (`clubs.openmatch-chat.routes.test.ts` ou nouveau) : `GET /:slug/open-matches/:id` → 200 public (sans token), 200 avec token (flags viewer), 404 introuvable ; non capturé par `/unread-count`.

**Frontend**
- `MatchShareButton.test.tsx` : appelle `navigator.share` quand présent ; repli `clipboard.writeText` + « Lien copié ! » sinon ; `AbortError` silencieux.
- `OpenMatchCard` : présence du bouton « Partager » (membre **et** anonyme), URL attendue.
- `OpenMatchDetail.test.tsx` : rend la carte pour une partie chargée ; état « n'existe plus » sur 404 ; barre de partage présente.
- `OpenMatches.test.tsx` : reste verte après extraction du hook/modales (non-régression).

## Hors périmètre (v1)

- **Image OG dédiée** (1200×630 générée) : on réutilise l'icône club carrée (`icon/512.png`). Amélioration future.
- **Flux d'invitation ciblée** (choisir un destinataire, suivi par personne).
- **Deep-link de secours** `/parties?match=<id>` (la page dédiée suffit).
- Partage des tournois/events : déjà couvert par `ShareActions` (inchangé).

## Fichiers touchés (indicatif)

- `backend/src/services/openMatch.service.ts` — `toOpenMatchDTO` + `getOpenMatch`.
- `backend/src/routes/clubs.ts` — route `GET /:slug/open-matches/:id`.
- `frontend/lib/api.ts` — `getOpenMatch`.
- `frontend/lib/tournament.ts` — `uidPrefix` `'match'`.
- `frontend/components/openmatch/OpenMatches.tsx` — consomme le hook + modales (refactor).
- `frontend/components/openmatch/useOpenMatchActions.ts` — **nouveau** hook.
- `frontend/components/openmatch/OpenMatchModals.tsx` — **nouveau** composant.
- `frontend/components/openmatch/MatchShareButton.tsx` — **nouveau**.
- `frontend/components/openmatch/OpenMatchCard.tsx` — bouton « Partager ».
- `frontend/components/openmatch/OpenMatchDetail.tsx` — **nouveau** (client).
- `frontend/app/parties/[id]/page.tsx` — **nouveau** (serveur, `generateMetadata`).
- Tests associés.
