# Fiches tournoi & event — dérédondance + cartes méta compactes (mobile)

**Date** : 2026-07-05
**Statut** : validé
**Périmètre** : frontend uniquement (aucun changement backend, aucune migration)

## Problème

Sur mobile, la fiche tournoi `/tournois/[id]` (et sa jumelle event `/events/[id]`) présente deux défauts :

1. **Débordement** : `MetaCardsRow` est une rangée à défilement horizontal (`flex: 1 0 140px`, `minWidth: 140`, `overflowX: auto`). Sur un écran étroit, la 3ᵉ carte (« Inscription · 30 € par binôme ») est coupée et une barre de scroll grise apparaît sous les cartes.
2. **Redondances** :
   - la **clôture** apparaît 3 fois : chip compte à rebours du hero, carte méta « Clôture des inscriptions », étape timeline « Clôture des inscriptions · ven. 3 juil. » ;
   - le **début** apparaît 2 fois : carte « Horaire » et étape timeline « Début du tournoi · mer. 8 juil. » ;
   - dans le hero, le compteur « 8/8 binômes · 3 en attente » et le badge « Complet · liste d'attente possible » se répètent (et sans capacité, « 5 binômes » + « 5 binômes inscrits » est un doublon total).

## Décisions (validées avec le user)

1. **Supprimer la timeline** (plutôt que d'alléger les cartes ou de tout fusionner en un bloc).
2. **Compacter les cartes méta pour tenir à 3 de front sur mobile** (plutôt que grille wrap ou scroll assumé).
3. **Badge places du hero raccourci, zéro doublon** (le compteur reste la source des chiffres).
4. **Périmètre : fiches tournoi + event** (la fiche cours bénéficie automatiquement du compactage via `MetaCardsRow` partagé).

## Design

### 1. Timeline supprimée (tournoi + event)

- `/tournois/[id]` et `/events/[id]` ne rendent plus `TournamentTimeline` (imports et rendu retirés).
- La clôture est portée par la carte méta « Clôture » (date précise) + le chip compte à rebours du hero (urgence) ; le début par la carte « Horaire ». L'étape « Inscriptions ouvertes » n'apportait rien.
- **Code mort supprimé** : `frontend/components/tournament/TournamentTimeline.tsx`, `timelineSteps` + type `TimelineStep` dans `frontend/lib/tournament.ts`, et leurs tests. `formatDateShort` est conservé (utilisé par d'autres formats).

### 2. Cartes méta compactes — `MetaCardsRow` (`components/agenda/AgendaHero.tsx`)

Rangée **sans scroll, 3 tiers égaux** :

- `flex: '1 1 0'`, `minWidth: 0` (au lieu de `1 0 140px` / `minWidth: 140`), suppression de `overflowX: 'auto'` ;
- `gap` 8 → 6 ; padding carte `11px 13px` → `10px 11px` ; label 11 → 10, valeur 13.5 → 12.5 (interlignes conservés).

Sur mobile 360 px chaque carte fait ~102 px (les valeurs wrappent sur 2-3 lignes) ; sur desktop (`Screen` max 820 px) ~255 px.

**Contenus raccourcis** côté pages appelantes :

| Carte | Avant | Après |
|---|---|---|
| Horaire (tournoi/event) | « mercredi 8 juillet · 13h12 → 21h12 » (`formatDateTimeRange`) | « mer. 8 juil. · 13h12 → 21h12 » (`formatDateShortTimeRange`, existant ; sans heure de fin → `formatDateTimeShort`, nouveau) |
| Clôture | label « Clôture des inscriptions », valeur « vendredi 3 juillet à 13h12 » | label **« Clôture »**, valeur « ven. 3 juil. · 13h12 » (`formatDateTimeShort`) |
| Inscription (tournoi) | « 30 € par binôme » | **« 30 € / binôme »** |
| Prix (event) | « 30 € — à régler en ligne » / « 30 € — règlement au club » | **« 30 € · en ligne »** / **« 30 € · au club »** |

Nouveau helper pur dans `lib/tournament.ts` : `formatDateTimeShort(iso, tz)` → « ven. 3 juil. · 13h12 » (date courte + heure, fuseau du club).

La fiche cours (`/cours/[id]`) profite du compactage visuel sans autre changement (ses libellés actuels restent).

### 3. Badge places du hero raccourci

Nouveau helper pur dans `lib/tournament.ts`, partagé tournoi/event :

```ts
heroPlacesLabel(confirmed: number, capacity: number | null): { text: string; urgent: boolean } | null
```

- `capacity == null` → **`null`** (badge masqué — le compteur « 5 binômes » / « 5 inscrits » suffit) ;
- plein → **« Complet »** (fini « · liste d'attente possible » : « X en attente » est déjà dans le compteur) ;
- `restant ≤ 5` → « Plus que X place(s) » (**urgent**, inchangé) ;
- sinon → « X places restantes » (inchangé).

`AgendaHero.places` devient **nullable** (badge non rendu si `null`). `TournamentHero` passe `heroPlacesLabel(t.confirmedCount, t.maxTeams)` ; la fiche event `heroPlacesLabel(event.confirmedCount, event.capacity)`.

**Les listes ne changent pas** : `tournamentPlacesLabel` / `eventPlacesLabel` restent tels quels pour `AgendaCard`, club-house (`TournamentsAlaUne`), calendrier national (`TournamentFinder`, `UpcomingTournaments`) — sur ces cartes il n'y a pas de compteur à côté, le libellé long y reste utile.

### 4. Tests

- Supprimés : bloc `timelineSteps` dans `__tests__/tournament.test.ts`, mocks `TournamentTimeline` dans `TournamentDetail.test.tsx` / `EventDetail.test.tsx`.
- Ajoutés : `heroPlacesLabel` (4 états : sans capacité, complet, ≤ 5, > 5), `formatDateTimeShort`, badge masqué dans `AgendaHero` quand `places` est `null`.

## Hors périmètre

- Pills du hero (Padel / P100 / Messieurs / Ouvert aux femmes), `ShareActions`, cartes des listes.
- Backend : aucun changement.
- Fiche cours au-delà du compactage automatique.
