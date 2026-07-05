# Nouvelle conversation depuis la page Messages — Design

**Date** : 2026-07-05
**Statut** : validé

## Objectif

Permettre de démarrer une conversation privée avec un membre du club **directement depuis la page Messages** (`/me/messages`). Aujourd'hui, les seuls points d'entrée sont externes (Mes amis, parties ouvertes, inscrits tournoi/event) — la boîte de réception elle-même n'offre aucun moyen d'initier un fil.

## Périmètre

**100 % frontend — aucun changement backend, aucune migration.** Trois APIs existantes suffisent :

- `api.searchClubMembers(slug, q, token)` — annuaire des membres actifs du club (id + nom, jamais l'e-mail).
- `api.listClubFriends(slug, q, token)` — amis du joueur présents dans le club (avec niveau).
- `api.openConversation(userId, token, clubSlug)` — get-or-create idempotent, déjà utilisé par le deeplink `?with=`.

## Design

### 1. Bouton « ✏️ Nouveau » dans l'en-tête de la liste

`MessagesHub` (`frontend/components/messages/MessagesHub.tsx`) gagne un bouton « ✏️ Nouveau » dans l'en-tête « Conversations », à côté du bouton « Bloqués » existant.

- Rendu **seulement si `clubSlug` est non-null** : la recherche de membres est club-scoped. La page `/me/messages` exige déjà un hôte club — c'est une garde défensive.

### 2. Composant `NewConversationPanel`

Nouveau composant `frontend/components/messages/NewConversationPanel.tsx` : **dialog overlay** (même pattern que la modale « Membres bloqués » déjà présente dans MessagesHub — fond assombri cliquable pour fermer, carte centrée, `role="dialog"`).

Contenu :

- **Champ de recherche** en tête, debounce **250 ms** (pattern de l'onglet « Trouver » de `FriendsHub`).
- **Champ vide** → section « Mes amis » : `listClubFriends`, lignes avatar coloré (`colorForSeed`) + nom + `LevelChip`. Si aucun ami → texte d'invite « Tapez un nom pour trouver un membre ».
- **En tapant** → résultats de l'annuaire (`searchClubMembers`), lignes avatar + nom.
- Le **viewer lui-même est filtré** des résultats (défensif, via `viewerUserId` déjà passé à MessagesHub — on ne peut pas s'écrire à soi-même, le backend renvoie `CANNOT_MESSAGE_SELF`).

### 3. Sélection d'un membre

Tap sur une ligne → `api.openConversation(userId, token, clubSlug)` → même flux que le deeplink `?with=` : `setSelected(conversation)` + `reload()`, fermeture du panneau. Sur mobile, le fil prend le plein écran (comportement existant de MessagesHub).

**Erreurs** : si le backend refuse la création (membre bloqué dans un sens ou l'autre — la création de conversation est refusée vers un bloqué), afficher un petit message d'erreur **dans le panneau** (« Impossible d'ouvrir cette conversation. ») au lieu d'un échec silencieux. Pas de mapping fin des codes en v1.

### 4. Tests

`frontend/__tests__/NewConversationPanel.test.tsx` :

- Le bouton « Nouveau » ouvre le panneau.
- Champ vide → amis affichés (`listClubFriends` mocké).
- Taper un nom → `searchClubMembers` appelé (debounce), résultats affichés.
- Clic sur un membre → `openConversation` appelé avec le bon userId + panneau fermé + conversation sélectionnée.
- Échec d'`openConversation` → message d'erreur visible, panneau toujours ouvert.
- Le viewer est absent des résultats.

Mocks : `api.listClubFriends`, `api.searchClubMembers`, `api.openConversation` (+ mocks existants de MessagesHub si la suite monte le hub complet).

## Hors périmètre

- Le widget desktop ancré (`DmWidgetHost`) garde son comportement actuel (pas de bouton « Nouveau »).
- Conversations de groupe.
- Bouton 💬 inline dans d'autres surfaces (déjà couvert par FriendsHub, parties, fiches tournoi/event).
