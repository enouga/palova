# Refus des messages privés (opt-out messagerie) — design

## Contexte

La messagerie privée 1-à-1 (`docs/superpowers/{specs,plans}/2026-07-04-messagerie-membres*`) permet à
tout co-membre actif d'un club commun de démarrer une conversation avec n'importe quel autre membre
(`MessagingService.getOrCreateConversation`). Il existe déjà un blocage pair-à-pair (`UserBlock`, « bloquer
ce joueur précis ») mais rien ne permet à un joueur de refuser, de manière générale, que des inconnus lui
écrivent pour la première fois.

Le système d'amis confirmés (`docs/superpowers/{specs,plans}/2026-07-01-amis-opt-in-demandes*`) a déjà posé
le pattern exact pour ce genre de préférence : `User.acceptsFriendRequests` (booléen, défaut `true`),
vérifié avant la création d'une ressource sociale, avec un code d'erreur dédié.

## Décisions

1. **Portée** : le refus bloque uniquement la **création d'une nouvelle conversation**. Les fils déjà
   ouverts avec des gens à qui le joueur parlait avant d'activer le refus continuent de fonctionner
   normalement — pas de revérification à chaque envoi (contrairement à `UserBlock`, plus radical par
   nature).
2. **Exception amis** : deux joueurs en amitié confirmée (`Friendship.status === 'ACCEPTED'`) peuvent
   toujours démarrer une conversation, même si l'un des deux a désactivé le refus général. Le réglage ne
   ferme donc la porte qu'aux inconnus/non-amis, ce qui le rend utile sans avoir besoin d'un choix à 3
   états (tout le monde / amis seulement / personne) — le cas « amis seulement » est déjà le comportement
   par défaut de l'opt-out.
3. **UX du refus** : pas d'annotation proactive des ~8 écrans qui affichent un bouton « Écrire à X »
   (équipes de match, inscrits tournoi/event, suggestions, favoris, amis, `PlayerPills`, `MatchTeams`).
   Le clic échoue avec un message clair au moment de la tentative de création de conversation. Griser ces
   boutons à l'avance demanderait de plomber la préférence dans ~8 endpoints de lecture différents pour un
   gain surtout cosmétique.

## Modèle de données

Migration additive **`add_dm_opt_out`** :

```prisma
model User {
  // ...
  acceptsDirectMessages Boolean @default(true)
}
```

DEV : `prisma db execute` (SQL additif `ALTER TABLE "User" ADD COLUMN "acceptsDirectMessages" BOOLEAN NOT NULL DEFAULT true;`)
suivi de `prisma generate` — pas `db push`/`migrate dev` (base dev en dérive, cf. mémoire projet).
Prod : `prisma migrate deploy`.

Défaut `true` : personne n'est coupé au déploiement, comme `acceptsFriendRequests`.

## Backend

### `MessagingService.getOrCreateConversation`

Le `select` de la requête `other` (déjà exécutée pour vérifier existence/`deletedAt`) est étendu avec
`acceptsDirectMessages: true`. Une nouvelle méthode privée est appelée juste après `assertNotBlocked`,
donc uniquement sur le chemin de **création** (`!conv`), jamais sur une conversation déjà existante :

```ts
private async assertAcceptsMessages(a: string, b: string, otherAccepts: boolean): Promise<void> {
  if (otherAccepts) return;
  const fr = await prisma.friendship.findUnique({
    where: { userAId_userBId: canonical(a, b) },
    select: { status: true },
  });
  if (fr?.status === 'ACCEPTED') return;
  throw new Error('DM_DISABLED');
}
```

Dans le cas par défaut (`acceptsDirectMessages: true`, la majorité des joueurs), zéro requête
supplémentaire — le champ est déjà chargé. La requête `Friendship` ne se déclenche que si la cible a
explicitement coupé les messages.

Ordre des gardes dans `getOrCreateConversation` (uniquement quand `!conv`) : `sharedActiveClubId` (throw
`NOT_CO_MEMBERS`) → `assertNotBlocked` (throw `USER_BLOCKED`) → `assertAcceptsMessages` (throw
`DM_DISABLED`) → `assertRateLimit('dm:newconv', …)` → `create`.

### Route

`backend/src/routes/conversations.ts` — `ERROR_STATUS` gagne `DM_DISABLED: 409` (même famille que
`USER_BLOCKED`).

### `PATCH /api/me`

`routes/me.ts` : `acceptsDirectMessages` ajouté à `PROFILE_SELECT`, à la déstructuration du body, et à la
validation (`typeof !== 'boolean'` → 400), miroir exact du traitement de `acceptsFriendRequests`.

## Frontend

### Réglage profil

`app/me/profile/page.tsx`, section Préférences, juste sous « Autoriser les demandes d'ami » :

```tsx
<span style={label}>Recevoir des messages privés</span>
<div role="group" aria-label="Recevoir des messages privés">
  <Segmented<'oui' | 'non'>
    value={profile.acceptsDirectMessages ? 'oui' : 'non'}
    onChange={(v) => changeAcceptsDirectMessages(v === 'oui')}
    options={[{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }]}
  />
</div>
```

`changeAcceptsDirectMessages` = copie de `changeAcceptsFriendRequests` (update optimiste +
`api.updateMyProfile({ acceptsDirectMessages: next }, token)`).

`MyProfile` (type `lib/api.ts`) gagne `acceptsDirectMessages: boolean`.

### Mapping d'erreur

`lib/messages.ts` gagne une constante exportée :

```ts
export const DM_ERRORS: Record<string, string> = {
  DM_DISABLED: "Ce joueur n'accepte pas les messages privés.",
  USER_BLOCKED: "Impossible d'écrire à ce joueur.",
  NOT_CO_MEMBERS: "Vous n'avez plus de club en commun avec ce joueur.",
};
export function dmErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : '';
  return DM_ERRORS[code] ?? "Impossible d'ouvrir cette conversation.";
}
```

(`USER_BLOCKED`/`NOT_CO_MEMBERS` sont ajoutés au passage : ils échouent déjà silencieusement aujourd'hui
dans 2 des 3 call sites — cf. ci-dessous — et méritent le même traitement que `DM_DISABLED` plutôt qu'un
message générique.)

### 3 points d'appel de `openConversation` à corriger

1. **`NewConversationPanel.tsx`** — a déjà un `catch` qui pose `setError(...)`. Remplacer le message fixe
   par `dmErrorMessage(err)`.
2. **`MessagesHub.tsx`** (deeplink `?with=`, ligne ~61-65) — `.catch(() => {})` aujourd'hui, avale toute
   erreur en silence (le clic sur « Écrire à X » depuis une partie ouverte/un tournoi/un event ne fait
   alors rien de visible, `selected` reste `null`). Ajouter un état `deeplinkError: string | null` : quand
   posé, remplace le texte de l'état vide existant (« Sélectionnez une conversation ») par le message
   d'erreur, à la place de `thread`/`list` habituels côté droit. Réinitialisé si l'utilisateur sélectionne
   ensuite une conversation dans la liste.
3. **`DmWidgetHost.tsx`** (widget desktop ancré, ligne ~44) — même `.catch(() => {})` silencieux, et pas
   d'espace de rendu existant pour une erreur puisque le widget ne s'affiche que si `conv` est posé (sinon
   `return null`). Ajouter un état `error: string | null` : quand posé (et `conv` toujours `null`), affiche
   le même panneau ancré bas-droite que le widget mais avec juste le message d'erreur + un bouton ✕ pour le
   fermer (pas d'auto-fermeture — une erreur ne doit pas disparaître avant d'être lue).

Aucun changement dans les ~8 écrans qui déclenchent `openDm`/`openConversation` (TeamsGrid,
ParticipantsGrid, OpenMatchCard, FriendCard, PlayerPills, MatchTeams, SuggestionsRow, FriendsHub) — ils
continuent d'appeler la même fonction sans connaître la préférence de la cible à l'avance.

## Tests

- `backend/src/services/__tests__/messaging.service.test.ts` : conversation refusée si cible
  `acceptsDirectMessages: false` et non-amis ; conversation autorisée si cible a coupé mais amitié
  `ACCEPTED` ; conversation autorisée par défaut (`true`) ; une conversation **existante** n'est pas
  affectée par un opt-out activé après coup (pas de nouvel appel `assertAcceptsMessages` hors création).
- `backend/src/routes/__tests__/conversations.routes.test.ts` : `DM_DISABLED` → 409.
- `backend/src/routes/__tests__/me.routes.test.ts` : PATCH accepte/rejette `acceptsDirectMessages`.
- `frontend/__tests__/MeProfile.test.tsx` : toggle présent, optimiste, persiste.
- `frontend/__tests__/messages.test.ts` (ou fichier existant `lib/messages`) : `dmErrorMessage` mappe les 3
  codes + repli générique.
- `frontend/__tests__/NewConversationPanel.test.tsx` : message spécifique sur `DM_DISABLED`.
- `frontend/__tests__/MessagesHub.test.tsx` : erreur affichée sur deeplink refusé (plus un `catch` muet).
- `frontend/__tests__/DmWidgetHost.test.tsx` : erreur affichée sur ouverture refusée.

## Hors périmètre

- Granularité plus fine que le binaire tout-le-monde/amis (ex. liste blanche par joueur) — déjà couvert
  par `UserBlock` pour le cas inverse (blocage ciblé).
- Couper les conversations déjà ouvertes quand le refus est activé après coup.
- Notifier l'expéditeur refusé autrement que par le message d'erreur au moment du clic.
- Annoter la préférence dans les listes (`searchClubMembers`, équipes, inscrits…) pour griser les boutons
  à l'avance.
- Réglage par club (le refus est global, comme `acceptsFriendRequests` — cohérent avec `Conversation`
  qui n'a pas de frontière d'accès par club, `clubId` n'étant qu'un marqueur de branding).
