# Réglages — Sports en enregistrement différé — design

**Date** : 2026-07-16
**Statut** : validé par Eric (brainstorming du 2026-07-16)

## Contexte & objectif

`/admin/settings` a 6 onglets ; 5 éditent le modèle `Club` via un brouillon (`draft`/`server`)
et une barre `SaveBar` sticky unique (Enregistrer/Annuler). Le 6ᵉ, « Sports », gère les
entités `ClubSport` (activer un sport, cocher les durées proposées) et enregistre **chaque
clic immédiatement** — écart assumé documenté dans CLAUDE.md (« 5 onglets à enregistrement
différé + 1 à enregistrement immédiat »). Eric trouve cette incohérence perturbante : il veut
que Sports se comporte **exactement comme les 5 autres onglets** — édition locale, un seul
bouton Enregistrer/Annuler en bas de page pour tout.

## Décisions de cadrage (figées)

| Question | Décision |
|---|---|
| Sauvegarde | Nouvel endpoint **atomique** côté backend (transaction Prisma) plutôt que rejouer les appels existants en série côté front — évite tout état partiellement enregistré. |
| Portée du brouillon | Ajout de sport + cases à cocher des durées. Pas de retrait de sport (absent aujourd'hui, hors périmètre). |
| Comportement Annuler | Réinitialise tout (Club + Sports) sans avoir rien envoyé au serveur — plus simple qu'aujourd'hui où chaque clic Sports est déjà définitif. |
| Un seul Enregistrer pour deux ressources | Le clic déclenche le PATCH Club (si modifié) et le nouveau batch Sports (si modifié) en parallèle ; chacun réussit/échoue indépendamment (ressources distinctes, `Club` vs `ClubSport`) — pas d'atomicité inter-ressources, seulement intra-ressource (le batch Sports lui-même est une transaction). |

## Architecture frontend

État levé de `SettingsSports.tsx` vers `app/admin/settings/page.tsx`, symétrique du couple
`server`/`draft` du Club :

- `sportsCatalog: Sport[]` — catalogue plateforme, chargé une fois, non éditable.
- `sportsServer: AdminClubSport[]` — baseline (résultat de `adminGetSports`).
- `sportsDraft: SportsDraftItem[]` — brouillon édité.

```ts
type SportsDraftItem = { sportId: string; clubSportId: string | null; durationsMin: number[] };
```

`clubSportId: null` = sport ajouté dans le brouillon, pas encore créé côté serveur.
`durationsMin: []` = « durées par défaut du sport » (comportement de création actuel,
inchangé).

`SettingsSports` devient un composant **contrôlé**, sans état ni appel API interne :

```ts
interface SettingsSportsProps {
  catalog: Sport[];
  items: SportsDraftItem[];
  onAdd: (sportId: string) => void;
  onToggleDuration: (sportId: string, min: number) => void;
}
```

Affichage : les infos d'un sport (nom, icône, durées par défaut) sont résolues par lookup
dans `catalog` via `sportId` (marche identiquement pour un sport existant et pour un sport
tout juste ajouté dans le brouillon, jamais besoin d'attendre le serveur). « Ajouter un
sport » = `catalog` filtré des `sportId` déjà présents dans `items`.

### Helpers purs (`lib/adminSettings.ts`)

- `sportsDirty(server: AdminClubSport[], draft: SportsDraftItem[]): boolean` — normalise les
  deux côtés en `{ sportId, durationsMin: sorted }[]` triés par `sportId`, compare en JSON.
  Miroir de `isDirty`.
- `addSportDraft(items, sportId): SportsDraftItem[]` — ajoute si absent (idempotent, anti
  double-clic ; pas de doublon possible).
- `toggleDurationDraft(items, sportId, defaultDurationsMin, min): SportsDraftItem[]` —
  calcule `effectiveDurations(item.durationsMin, defaultDurationsMin)`, bascule `min`,
  refuse de vider l'ensemble (même garde qu'aujourd'hui : au moins une durée).
- `buildSportsBatchBody(server, draft): { sportId: string; durationsMin: number[] }[]` — ne
  renvoie QUE les lignes qui diffèrent de la baseline (diff), jamais la liste entière (pour
  ne jamais écraser un sport non touché par la sauvegarde).

## Backend — endpoint atomique

`PUT /api/clubs/:clubId/admin/sports` (même garde que les routes `/sports*` existantes),
body `{ items: { sportId: string; durationsMin: number[] }[] }` (le diff calculé côté front
par `buildSportsBatchBody`).

`ClubService.applySportsBatch(clubId, items)` — dans **une seule transaction Prisma** :

- pour chaque item, si le club n'a pas encore ce sport activé → `create` (avec
  `durationsMin` explicite si non vide, sinon la colonne garde son défaut) ;
- sinon (sport déjà activé) → `update` de `durationsMin` — toujours non vide dans ce cas :
  un item de diff sur un sport déjà activé n'existe que si ses durées ont changé, et le
  garde-fou de `toggleDurationDraft` garantit qu'elles ne sont jamais vidées ;
- chaque `durationsMin` non vide est validé comme aujourd'hui (`updateClubSport` : entiers
  15-240, multiples de 15, dédupliqués, triés) → `VALIDATION_ERROR` si invalide, et **toute
  la transaction est annulée** (aucun des items du batch n'est appliqué).

Renvoie `AdminClubSport[]` à jour pour le club (même forme que `adminGetSports`) — devient
la nouvelle baseline `sportsServer` **et** `sportsDraft` côté front en cas de succès.

## Sauvegarde / Annulation (page)

`save()` : calcule `clubDirty`/`sportsDirtyNow` séparément, lance les opérations pertinentes
(PATCH Club existant si `clubDirty`, nouveau batch Sports si `sportsDirtyNow`) via
`Promise.allSettled`. Chaque opération qui réussit met à jour sa propre baseline
(`server`/`sportsServer`) — un échec sur l'une n'empêche pas l'autre de se poser ;
`saveError` rapporte ce qui a échoué (le brouillon correspondant reste dirty, l'autre
redevient propre). Le flash « Enregistré ✓ » ne s'affiche que si toutes les opérations
lancées ont réussi.

`cancel()` : `setDraft(server)` (inchangé) **+** `setSportsDraft(sportsServer)` (nouveau) —
aucun appel réseau n'a eu lieu pour les changements Sports non enregistrés, donc rien à
défaire côté serveur (contrairement au fonctionnement actuel où chaque action Sports est
déjà définitive).

`dirty` (page) = `isDirty(server, draft) || sportsDirty(sportsServer, sportsDraft)`.

## Hors v1

- Retrait d'un sport activé (aucune UI aujourd'hui, ne sera pas ajoutée ici).
- Undo unitaire au sein du brouillon Sports (seul « Annuler » global existe, comme pour les
  5 autres onglets).
- Atomicité inter-ressources (Club + Sports en un seul commit serveur) — les deux restent
  deux opérations indépendantes déclenchées par le même clic Enregistrer.

## Tests

- **Backend** : `club.service.test.ts` — `applySportsBatch` (création, mise à jour,
  atomique : un item invalide annule tout le batch) ; `admin.routes` (ou fichier dédié) —
  nouvelle route `PUT /sports` (garde STAFF, 200, 400 sur durée invalide).
- **Frontend** : `adminSettings.test.ts` — `sportsDirty`/`addSportDraft`/
  `toggleDurationDraft`/`buildSportsBatchBody` (purs) ; `SettingsSports.test.tsx` réécrit en
  composant contrôlé (rend `items`/`catalog`, `onAdd`/`onToggleDuration` appelés, **aucun
  appel API direct**) ; `AdminSettings.test.tsx` — ajouter un sport / cocher une durée ne
  déclenche plus d'appel réseau avant clic sur Enregistrer, la barre passe en état modifié,
  Annuler réinitialise sans appel réseau, Enregistrer appelle le nouveau batch (et
  éventuellement le PATCH Club si les deux sont dirty).
