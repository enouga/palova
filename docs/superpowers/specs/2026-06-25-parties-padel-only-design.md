# Parties ouvertes réservées au padel — design

**Date :** 2026-06-25
**Statut :** validé, prêt pour plan d'implémentation

## Problème

Les « parties ouvertes » (matchmaking à la Playtomic : un membre ouvre une partie publique, d'autres rejoignent selon leur niveau) sont un excellent fit pour le **padel** (2v2, écart de niveau dilué, social) mais un mauvais fit pour les autres sports — surtout le **tennis en simple**, où un écart de niveau rend le match injouable et où le pool de candidats compatibles est trop mince.

Aujourd'hui :
- L'onglet **« Parties »** (`ClubNav.tsx`) s'affiche pour **tout membre connecté, sur tous les clubs, sans tenir compte du sport**.
- La liste `/parties` (`OpenMatches.tsx`) **mélange tous les sports** : chaque partie est pourtant déjà liée à un sport au niveau données (`resource.clubSport.sport.key`), mais le filtre n'existe pas.
- L'option **« Partie ouverte »** (`visibility = PUBLIC`) dans `BookingModal.tsx` est proposée sur **n'importe quel terrain**.

## Décision

**Les parties ouvertes (matchmaking) n'existent que pour le padel.** Règle unique, **en dur, sans réglage admin**.

Périmètre du « padel uniquement » : **la liste/onglet des parties ouvertes** et **la création d'une partie ouverte**. Le **classement** (`Leaderboard.tsx`) reste **multi-sport** (inchangé — conserve l'investissement du spec `2026-06-22-sport-prefere-classement-multisport`).

Conséquences assumées :
- Club **tennis-only** (ou tout club sans padel) → l'onglet `/parties` disparaît entièrement (donc plus de classement non plus à cet endroit).
- Club **padel + tennis** → onglet visible ; la liste des parties = **padel seulement** ; le classement garde son sélecteur de sport (tennis inclus).

## Source de vérité

Le **filtre backend sur `getOpenMatches`** est l'unique source de vérité du scope padel. Tout le reste (onglet, page, bloc Club-house) n'est que de la cohérence d'UI qui en découle.

## Changements

### 1. Helper de détection (frontend)
Nouveau helper pur, testable — `frontend/lib/sport.ts` :
```ts
export const PADEL_KEY = 'padel';
export const clubHasPadel = (club: { clubSports?: { sport: { key: string } }[] }) =>
  club.clubSports?.some((cs) => cs.sport.key === PADEL_KEY) ?? false;
```

### 2. Onglet ClubNav
`frontend/components/ClubNav.tsx` — l'onglet Parties passe de `show: ready && !!token` à
`show: ready && !!token && clubHasPadel(club)`.

### 3. Garde d'accès direct `/parties`
`frontend/app/parties/page.tsx` — si `!clubHasPadel(club)` (accès via bookmark / lien profond sur un club sans padel) → **`router.replace('/')`**. Pas de page orpheline, pas de message dédié.

### 4. Liste padel-only (backend — le pivot)
`backend/src/services/openMatch.service.ts`, `getOpenMatches` — ajouter au `where` :
`resource: { clubId: club.id, clubSport: { sport: { key: 'padel' } } }`.
Toute partie non-padel est exclue quoi qu'il arrive en base. Couvre automatiquement le bloc « Parties pour toi » du Club-house (même endpoint).

### 5. Classement multi-sport : inchangé
`frontend/components/openmatch/Leaderboard.tsx` — aucun changement. Garde son sélecteur de sport.

### 6. Niveau = padel (correction d'un bug latent)
`GET /api/me/rating` sans paramètre renvoie le niveau du **sport préféré** du joueur (`me.ts` : « défaut = sport préféré, sinon padel »). Or les deux surfaces parties appellent `getMyRating(token)` **sans sport** → un joueur « tennis préféré » verrait son niveau tennis comparé à des parties padel.

- `frontend/components/openmatch/OpenMatches.tsx` → `api.getMyRating(token, 'padel')`
- `frontend/components/ClubHouse.tsx` → `api.getMyRating(token, 'padel')`

« À mon niveau », « Pour toi » et les recos comparent désormais le niveau **padel**.

### 7. Création « Partie ouverte » côté réservation
- `frontend/components/BookingModal.tsx` — le segment **Partie privée / Partie ouverte** n'est rendu que si `sportKey === 'padel'` (la prop `sportKey` existe déjà). Sur un court non-padel : pas d'option, `visibility` reste `PRIVATE`.
- **Défense en profondeur backend** : `ReservationService.applyHoldSetup` (et `holdSlot` par sûreté) **refuse `visibility = PUBLIC` si la ressource n'est pas padel** → erreur **`OPEN_MATCH_PADEL_ONLY`**. Empêche un état orphelin « public mais invisible ».

## Tests

- `frontend/__tests__/sport.test.ts` — `clubHasPadel` : club padel / multi-sport avec padel / sans padel / `clubSports` absent.
- `frontend/__tests__/ClubNav.test.tsx` (ou existant) — onglet Parties masqué sans padel, présent avec padel.
- `frontend/__tests__/OpenMatches.test.tsx` / `ClubHouse` — `getMyRating` appelé avec `'padel'`.
- `frontend/__tests__/BookingModal*.test.tsx` — segment « Partie ouverte » absent si `sportKey !== 'padel'`, présent si `'padel'`.
- `backend/src/services/__tests__/openMatch.service.test.ts` — `getOpenMatches` filtre sur la clé sport `padel`.
- `backend/src/services/__tests__/reservation.service.test.ts` — `applyHoldSetup` rejette `PUBLIC` sur ressource non-padel (`OPEN_MATCH_PADEL_ONLY`).

## Hors périmètre

- Aucun réglage admin (pas de toggle par sport ni par club).
- Pas de « recherche de partenaire » pour le tennis (mode asynchrone distinct) — piste future éventuelle, non couverte ici.
- Classement inchangé.
- **Aucune migration** — zéro changement de schéma.
