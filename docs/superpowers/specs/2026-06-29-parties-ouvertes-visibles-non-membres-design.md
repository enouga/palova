# Parties ouvertes visibles & rejoignables par les non-membres — Design

**Date :** 2026-06-29
**Statut :** Validé (en attente de plan d'implémentation)

## Problème

Aujourd'hui, les parties ouvertes (`Reservation` `visibility:PUBLIC`, padel) ne sont
visibles **que** des membres ACTIVE du club, et la page `/parties` est entièrement
derrière le login :

- `proxy.ts` renvoie tout visiteur anonyme vers `/login` pour tout chemin non public
  (et `/parties` n'est pas public) → un non-connecté ne peut même pas atteindre la page.
- `OpenMatchService.listOpenMatches` appelle `resolveActiveMember`, qui lève
  `MEMBERSHIP_REQUIRED` pour un non-membre → la liste échoue.
- Le frontend `OpenMatches` ne charge la liste **que** si un `token` existe.

Les parties ouvertes sont pourtant un levier d'acquisition : un visiteur (anonyme ou
connecté mais pas encore membre) devrait pouvoir **voir** les parties et être invité à
**s'inscrire pour s'y ajouter**.

Note : l'adhésion est ici **quasi automatique** — réserver un terrain
(`reservation.service.ts`) crée déjà une `ClubMembership` à la volée, et `finishAuth`
(`lib/postAuth.ts`) auto-adhère au club au login sur un sous-domaine club. « Devenir
membre » est donc un geste léger, sans validation.

## Objectif

1. **Voir** : la liste des parties ouvertes est visible de **tout le monde**, y compris
   les visiteurs non connectés.
2. **Rejoindre** :
   - **Connecté non-membre** → rejoint en 1 clic (son adhésion ACTIVE est créée à la
     volée, comme à la 1re réservation).
   - **Anonyme** → invité à créer un compte / se connecter, puis ramené sur `/parties`
     pour s'ajouter.

## Matrice de comportement

| Viewer | Voir la liste | Rejoindre | Ça m'intéresse / Discuter / actions orga |
|---|---|---|---|
| **Anonyme** (pas de token) | ✅ lecture seule | « Rejoindre » → **dialog d'auth** (créer un compte / se connecter), retour sur `/parties` | masqués |
| **Connecté non-membre** | ✅ | ✅ **rejoint direct** — adhésion créée à la volée | « Ça m'intéresse » crée aussi l'adhésion ; chat inchangé |
| **Connecté membre** | ✅ | ✅ | ✅ (inchangé) |
| **Membre BLOCKED** | ✅ | ❌ `MEMBERSHIP_BLOCKED` (inchangé) | ❌ |

## Approche retenue

- **Lecture publique = endpoint optionnellement authentifié.** On réutilise
  `GET /:slug/open-matches` en remplaçant son `authMiddleware` par un nouveau
  **`optionalAuth`** (pose `req.user` si `Bearer` valide, sinon `next()` sans 401).
  *Alternative écartée : un endpoint `/public` séparé → duplication de surface.*

- **Rejoindre sans friction = adhésion garantie.** `joinOpenMatch` (et `setInterested`,
  par cohérence) passent de « exige une adhésion existante » à « **garantit l'adhésion** »
  (création ACTIVE si absente ; refus si BLOCKED). C'est le pattern déjà employé par la
  réservation. *Alternative (étape explicite « rejoindre le club ») : écartée — choix
  utilisateur d'un parcours direct.*

- **Aucune migration.** Aucun nouveau modèle ni colonne — `OpenMatchInterest` et
  l'auto-création de `ClubMembership` existent déjà. Changement purement logique.

## Backend

### `middleware/auth.ts` — nouveau `optionalAuth`

```typescript
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as { id: string; email: string };
      req.user = { id: payload.id, email: payload.email };
    } catch { /* token invalide → on continue en anonyme */ }
  }
  next();
}
```

### `OpenMatchService`

- **Nouveau helper `resolveActiveClub(slug)`** : résout le club **ACTIVE par slug sans
  exiger l'adhésion** (pour la lecture). `CLUB_NOT_FOUND` si absent / non ACTIVE.
- **Nouveau helper `ensureActiveMembership(slug, userId)`** : résout le club ACTIVE,
  puis **garantit l'adhésion** (crée ACTIVE si absente ; throw `MEMBERSHIP_BLOCKED` si
  l'adhésion existante est BLOCKED). Renvoie `{ id }`.
- **`listOpenMatches(slug, viewerUserId: string | null)`** : utilise `resolveActiveClub`.
  Si `viewerUserId` est `null` → `viewerIsParticipant` / `viewerIsOrganizer` /
  `viewerIsInterested` = `false`. Le reste (places, niveaux, intéressés, `lastMessageAt`)
  est inchangé.
- **`joinOpenMatch`** : `resolveActiveMember` → `ensureActiveMembership`.
- **`setInterested`** : `resolveActiveMember` → `ensureActiveMembership`.
- **Inchangés** : `removeOpenMatchPlayer` / `leaveOpenMatch` (l'acteur est déjà
  participant donc déjà membre), `addOpenMatchPlayer` (organisateur = membre), chat
  (`openMatchChat.service.ts`, son propre gate `assertChatAccess`).

### Routes (`routes/clubs.ts`)

- `GET /:slug/open-matches` : `authMiddleware` → **`optionalAuth`**, passe
  `req.user?.id ?? null` à `listOpenMatches`.
- Toutes les routes d'**écriture** (join, interest, participants, chat) restent en
  `authMiddleware` (une action requiert un compte).

## Frontend

- **`lib/authGate.ts`** : ajouter `/parties` à `PUBLIC_PATHS` (sinon le proxy renvoie
  l'anonyme vers `/login`). `/parties/...` sous-chemins couverts par le `startsWith`.
- **`lib/api.ts`** : `getOpenMatches(slug, token?)` — `token` optionnel ; pas d'en-tête
  `Authorization` quand absent.
- **`lib/postAuth.ts` + `/login` + `/register`** : honorer un `?next=` (chemin de
  retour). `finishAuth(auth, slug, router, next?)` ; le non-staff sur hôte club fait
  `router.push(next ?? '/')`. Les pages lisent `next` via `useSearchParams`.
  (Les redirections du proxy purgent `search`, mais ici le `push('/login?next=…')` est
  côté client → `next` préservé.)
- **`components/openmatch/OpenMatches.tsx`** :
  - `load()` charge la liste **avec ou sans token** (plus de court-circuit `if (!token)`).
  - Effets `myLevel` / `viewerUserId` / `canModerate` restent gardés par `if (!token)`.
  - Anonyme : masquer le toggle **Classement** (`Segmented`) et le filtre « À mon
    niveau » (features réservées au connecté) ; supprimer l'état vide « Connectez-vous… ».
  - Passe aux cartes un indicateur `isAnonymous` (= `!token`) et un `onAuthPrompt`.
- **`components/openmatch/OpenMatchCard.tsx`** :
  - Anonyme : « Rejoindre » appelle `onAuthPrompt(m)` ; masquer Quitter, Discuter,
    « Ça m'intéresse », l'ajout organisateur (`AddPlayerPill`) et « Saisir le résultat ».
  - Connecté non-membre : « Rejoindre » fonctionne tel quel (le backend crée l'adhésion).
- **Dialog d'auth (anonyme)** : petit composant (réutilise `ConfirmDialog` ou équivalent)
  « Créez un compte ou connectez-vous pour rejoindre cette partie » → boutons
  `/register?next=/parties` et `/login?next=/parties`.

## Edge cases & non-objectifs

- **Vie privée** : l'anonyme voit noms + avatars des joueurs — **assumé** (parties
  `visibility:PUBLIC`, club déjà public). Décision validée : on garde l'affichage
  identique au connecté.
- **BLOCKED** : voit la liste comme tout le monde ; toute écriture (`join`/`interest`)
  lève `MEMBERSHIP_BLOCKED` (le helper `ensureActiveMembership` ne « débloque » jamais).
- **Hors scope** : auto-join automatique au retour d'inscription (on se contente de
  ramener sur `/parties`, l'utilisateur reclique « Rejoindre ») ; chat & intérêt pour
  l'anonyme ; le tab Classement pour l'anonyme.

## Tests

### Backend
- `openMatch.service.test.ts` :
  - `listOpenMatches(slug, null)` (anonyme) → renvoie les parties, flags viewer `false`,
    pas de `MEMBERSHIP_REQUIRED`.
  - `joinOpenMatch` avec un user **non-membre** → crée la `ClubMembership` et l'ajoute.
  - `joinOpenMatch` avec un membre **BLOCKED** → `MEMBERSHIP_BLOCKED`.
  - `setInterested` non-membre → crée l'adhésion + l'intérêt.
- Route (`clubs.*.routes.test.ts`) : `GET /:slug/open-matches` **sans** en-tête
  `Authorization` → 200 + liste.

### Frontend
- `authGate.test.ts` : `isPublicPath('/parties') === true`.
- `OpenMatches.test.tsx` : rendu anonyme → liste affichée, toggle Classement / filtre
  niveau masqués, clic « Rejoindre » → `onAuthPrompt` déclenché.
- `OpenMatchCard.test.tsx` : props anonyme → contrôles membre masqués, « Rejoindre »
  appelle `onAuthPrompt`.

## Fichiers touchés (récap)

**Backend** : `middleware/auth.ts` (+`optionalAuth`), `services/openMatch.service.ts`,
`routes/clubs.ts`, tests associés.
**Frontend** : `lib/authGate.ts`, `lib/api.ts`, `lib/postAuth.ts`, `app/login/page.tsx`,
`app/register/page.tsx`, `components/openmatch/OpenMatches.tsx`,
`components/openmatch/OpenMatchCard.tsx`, dialog d'auth, tests associés.
