# Pastilles de joueurs uniformes (Mes réservations + pop-up) — design

**Date :** 2026-06-16
**Statut :** validé, prêt pour le plan d'implémentation

## Objectif

Uniformiser l'affichage des joueurs sur trois écrans en reprenant le « graphisme »
de la page **Parties ouvertes** (`OpenMatches`) : des **pastilles colorées avec avatar**
(une couleur par joueur via `colorForSeed`, photo ou initiales), badge « orga » sur
l'organisateur, et des cases **« Place libre »** en pointillés pour les places restantes.

Aujourd'hui :
- **Parties** (`OpenMatches`) → pastilles colorées + avatars + « Place libre ». ✅ (référence)
- **Mes réservations** (`MyAgendaListItem`) → **n'affiche aucun joueur**.
- **Pop-up « Joueurs »** (`ManagePlayersModal`) → joueurs en **lignes plates** (nom + « Retirer »),
  sans avatar ni couleur.

Cible : les pastilles façon Parties apparaissent **à la fois sur les cartes de Mes réservations
et dans la pop-up**, à l'identique de Parties (décision utilisateur : « Cartes + pop-up », rendu
« Fidèle à Parties »).

## Périmètre

Dans le périmètre :
- Nouveau composant présentiel partagé `PlayerPills`.
- Refacto de `OpenMatches` pour qu'il consomme `PlayerPills` (source de vérité unique du look).
- Pastilles en **lecture seule** sur la carte `MyAgendaListItem` (réservations uniquement).
- Pastilles (avec retrait) dans `ManagePlayersModal`, le champ d'ajout `PartnerSearch` conservé.
- 2 enrichissements de payload backend (additifs).

Hors périmètre :
- Pas de refonte de la carte `MyAgendaListItem` (on garde la barre couleur + la case date + les
  boutons « Joueurs »/« Annuler »).
- Pas de pastilles sur les items tournoi/event de l'agenda.
- Aucune migration (les données existent déjà en base).
- Pas d'édition inline des joueurs sur la carte (l'ajout/retrait reste dans la pop-up).

## Composant `PlayerPills`

Fichier : `frontend/components/player/PlayerPills.tsx` (présentiel, sans appel réseau).

Rend, dans l'ordre :
1. une pastille par joueur : avatar coloré (`colorForSeed(userId)` + `Avatar` avec `color`),
   prénom + nom, badge « orga » si organisateur, bouton `×` de retrait optionnel ;
2. `spotsLeft` cases « Place libre » en pointillés (rond pointillé + libellé).

Markup et styles repris **tels quels** de `OpenMatches` (pastilles arrondies `border-radius:999`,
fond `${color}22`, bordure `${color}`, case libre `dashed ${th.lineStrong}`).

API proposée :

```ts
interface PlayerPillData {
  userId: string;            // clé + graine couleur (colorForSeed)
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isOrganizer?: boolean;
  participantId?: string;    // id de participation (utilisé par le retrait côté résa)
}

interface PlayerPillsProps {
  players: PlayerPillData[];
  spotsLeft?: number;                       // nb de cases « Place libre » (défaut 0)
  onRemove?: (player: PlayerPillData) => void; // si fourni + canRemove(p) → affiche le ×
  canRemove?: (player: PlayerPillData) => boolean;
  busy?: boolean;                           // désactive les × pendant une action
  size?: 'sm' | 'md';                       // 'sm' carte compacte, 'md' Parties/pop-up (défaut 'md')
  showOrgaBadge?: boolean;                  // défaut true
}
```

Le callback `onRemove` reçoit le joueur entier : l'appelant décide quoi utiliser
(`participantId` pour une réservation, `userId` pour une partie ouverte).

## Backend (2 ajouts additifs)

1. **`reservation.service.ts` → `listUserReservations`** (alimente `GET /api/me/reservations`) :
   - `include` : `participants { orderBy joinedAt asc, select: { id, userId, isOrganizer,
     user: { firstName, lastName, avatarUrl } } }` + `resource.attributes`.
   - Réponse enrichie de `participants[]` (id, userId, isOrganizer, firstName, lastName, avatarUrl)
     et `capacity` (= `playerCount(resource.attributes.format)`).
2. **`reservation.service.ts` → `mapOwnPlayers` / `getOwnReservationPlayers`** (pop-up) :
   - ajouter `avatarUrl` au `select` du `user` et au mapping de chaque participant.

Types front (`lib/api.ts`) :
- `MyReservation` : ajouter `capacity: number` et
  `participants: { id; userId; isOrganizer; firstName; lastName; avatarUrl: string | null }[]`.
- `ReservationPlayer` : ajouter `avatarUrl: string | null`.

Tous les ajouts sont additifs : aucun consommateur existant n'est cassé.

## Carte « Mes réservations » (`MyAgendaListItem`)

Pour `item.kind === 'reservation'` uniquement :
- ajouter une **rangée de pastilles** sous la ligne heure/prix (`metaRow`), en **lecture seule** :
  `<PlayerPills players={r.participants} spotsLeft={Math.max(0, r.capacity - r.participants.length)}
   size="sm" />` (pas de `onRemove`).
- Réservation passée : pastilles affichées, carte déjà atténuée (`opacity 0.7`), pas de × (lecture seule).
- Les boutons « Joueurs » / « Annuler » restent inchangés (l'édition passe par la pop-up).

Tournoi / event : aucun changement (pas de pastilles).

## Pop-up `ManagePlayersModal`

- Remplacer les lignes plates (organisateur + autres) par
  `<PlayerPills players={participants} spotsLeft={Math.max(0, capacity - participants.length)}
   size="md" onRemove={(p) => remove(p.participantId!)}
   canRemove={(p) => canEdit && !p.isOrganizer} busy={busy} />`.
- `participants` mappés vers `PlayerPillData` (`participantId = p.id`).
- Le champ « Ajouter un joueur » (`PartnerSearch`) reste **dessous**, inchangé ; masqué quand complet
  ou non éditable (comportement actuel conservé).

## Refacto `OpenMatches`

Remplacer le bloc de markup inline des joueurs/places libres par `<PlayerPills>` :
`players={m.players}`, `spotsLeft={m.spotsLeft}`,
`onRemove={(p) => api.removeOpenMatchPlayer(slug, m.id, p.userId, token)}`,
`canRemove={(p) => m.viewerIsOrganizer && !p.isOrganizer}`, `busy={busy}`, `size="md"`.
Les boutons d'action (Rejoindre / Quitter / « Vous organisez ») restent **hors** du composant.

## Tests

- **Nouveau** `frontend/__tests__/PlayerPills.test.tsx` : rend les pastilles (nom, badge orga,
  cases « Place libre » = `spotsLeft`), affiche le × seulement si `onRemove` + `canRemove`,
  `×` désactivé si `busy`.
- **Maj** `frontend/__tests__/OpenMatches.test.tsx` : ajuster les assertions au nouveau rendu
  (les noms de joueurs et le comportement de retrait doivent rester verts).
- **Back** `me.routes.test.ts` : la réponse `/api/me/reservations` contient `participants` + `capacity`.
- **Back** `reservation.service.test.ts` : `getOwnReservationPlayers` renvoie `avatarUrl`.

## Risques / points d'attention

- `colorForSeed` utilise `userId` comme graine : les payloads de réservation l'exposent (contrairement
  aux payloads publics de tournoi/event qui n'ont que l'id d'inscription) → couleurs déterministes OK.
- `playerCount` doit renvoyer une capacité raisonnable pour les ressources sans `format` (déjà le cas,
  réutilisé par la pop-up actuelle).
- Hydration : `PlayerPills` est purement déterministe (pas de `new Date()` / aléatoire), sûr au rendu.
- Payload `/api/me/reservations` légèrement plus gros (participants par résa) — acceptable.
