# Refonte de la modale « Saisir le résultat » (MatchResultModal)

**Date :** 2026-06-22
**Statut :** Design validé

## Problème

`frontend/components/match/MatchResultModal.tsx` est fonctionnelle mais brute :
noir/blanc en dur (pas de tokens de thème → pas d'accent club, pas de dark mode),
pas d'avatars ni de couleurs joueur, et deux gros boutons « Équipe 1 / Équipe 2 »
par ligne sans regroupement visuel des équipes. On ne voit pas qui gagne pendant
la saisie.

## Objectif

Rendre la modale cohérente avec le reste de l'app et plus lisible, **sans changer
la logique métier** (composition 2v2, validation des sets, payload envoyé). Refonte
complète retenue (option « Tout »).

## Périmètre

- Réécriture visuelle de `MatchResultModal.tsx` (même logique d'état et même appel
  `api.recordMatchResult`).
- Nouvelle **prop optionnelle** `context` pour la ligne de contexte.
- Mise à jour des **deux appelants** pour passer `context`.
- **Aucun backend, aucune migration.**

## Conception

### Améliorations visuelles

1. **Tokens de thème partout** via `useTheme()` (`frontend/lib/ThemeProvider`) —
   `th.surface`, `th.surface2`, `th.line`, `th.lineStrong`, `th.text`,
   `th.textMute`, `th.accent`, `th.onAccent`, `th.fontUI`. Remplace tout le
   noir/blanc en dur → dark-mode safe + accent du club.
2. **Avatars colorés par joueur** : `Avatar` (`components/ui/Avatar.tsx`) +
   `colorForSeed(userId)` (`lib/playerColors.ts`), comme `MyMatchesList`/`OpenMatches`.
3. **Bascule d'équipe compacte `1 | 2`** (segmented) à la place des deux gros
   boutons. Case active teintée à la **couleur de l'équipe** (texte via `inkOn`).
4. **Bandeau des deux équipes** en tête de la section : pour chaque équipe, une
   pastille de couleur + libellé « Équipe 1 » + compteur `n/2`. Surface neutre
   (`th.surface2`), couleur seulement sur la pastille/le libellé (dark-mode safe).
5. **Colonnes de score colorées** : au-dessus des steppers, deux libellés
   « Éq. 1 » / « Éq. 2 » dans les couleurs d'équipe.
6. **Badge vainqueur en direct** (option retenue) : quand les sets sont valides
   (`validSets`) et la composition complète, un badge plein « Équipe X gagne A–B »
   (fond = couleur de l'équipe gagnante, texte via `inkOn`), A–B = nombre de sets
   gagnés par chaque équipe. Masqué tant que les sets ne sont pas valides.
7. **Ligne de contexte** sous le titre : `date · heure · terrain`
   (ex. « lun. 20 juin · 18h30 · Court 2 »). Pas de sport (absent des données des
   appelants). Affichée seulement si la prop `context` est fournie.

### Couleurs d'équipe

Constante locale au composant :
`const TEAM_COLORS = { 1: ACCENTS.blue, 2: ACCENTS.coral }` (de `lib/theme.ts`).
`emerald` est volontairement évité (réservé au « Victoire » de `MyMatchesList`).

### Interface du composant

```ts
interface Player { userId: string; firstName: string; lastName: string; avatarUrl: string | null; }

interface MatchContext { whenIso: string; tz: string; courtName: string; }

interface Props {
  reservationId: string;
  players: Player[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
  context?: MatchContext;   // nouveau, optionnel
}
```

La ligne de contexte est formatée avec `Intl.DateTimeFormat('fr-FR', …, { timeZone: tz })`
(même approche que les helpers `fmtDate`/`fmtHour` de `app/me/reservations/page.tsx` :
`weekday/day/month` pour la date, `hour:'2-digit',minute:'2-digit'` puis `:`→`h`
pour l'heure).

### Logique inchangée

`team`/`sets`/`busy`/`error` state, `assign`, `bump`, `teamFull`, `compositionOk`,
`setsOk = validSets(sets)`, `canSave`, `save()` → `api.recordMatchResult(...)` :
**identiques**. Le payload `{ teams: { 1: t1, 2: t2 }, sets }` ne change pas.

### Stabilité des tests existants

Les `data-testid` actuels sont **conservés** pour ne pas casser les tests de
comportement :
- bouton « 1 » de la bascule → `data-testid="team1-${userId}"`
- bouton « 2 » de la bascule → `data-testid="team2-${userId}"`
- steppers → `data-testid="set${i}-team${side+1}-minus|plus"`

### Mise à jour des appelants

- `app/me/reservations/page.tsx` (recordingFor = `MyReservation`) :
  `context={{ whenIso: recordingFor.startTime, tz: recordingFor.resource.club.timezone, courtName: recordingFor.resource.name }}`
- `components/openmatch/OpenMatches.tsx` (recordingFor = `OpenMatch`) :
  `context={{ whenIso: recordingFor.startTime, tz: club.timezone, courtName: recordingFor.resourceName }}`
  (le composant reçoit déjà `club` en prop ; vérifier `club.timezone`).

## Tests

`frontend/__tests__/MatchResultModal.test.tsx` :
- **Conserver** le test existant (enregistre un 2v2 avec un set) — doit rester vert
  grâce aux `data-testid` inchangés.
- Ajouter : les noms des joueurs sont rendus (avatars/chips) ;
- Ajouter : après une saisie valide (compo 2v2 + set 6-4), le **badge vainqueur**
  affiche « Équipe 1 gagne » ;
- Ajouter : quand `context` est fourni, la ligne de contexte affiche le terrain
  (ex. « Court 2 ») ; quand `context` est absent, pas de ligne de contexte.

Mock de `@/lib/api` : doit exposer `assetUrl` (utilisé par `Avatar`) en plus de
`api.recordMatchResult`. Rendu enveloppé dans `<ThemeProvider>` (convention du
projet, requis par `useTheme`/`Avatar`).

## Hors périmètre

- Affichage du sport (donnée absente des appelants).
- Changement de la logique de validation ou du payload.
- Toute modification backend / migration.
