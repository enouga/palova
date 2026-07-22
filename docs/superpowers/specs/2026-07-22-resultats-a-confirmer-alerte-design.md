# Alerte « Résultats à confirmer » (miroir de « Résultats à saisir »)

**Date** : 2026-07-22
**Statut** : validé (Eric)

## Problème

Deux besoins symétriques existent autour d'un résultat de match padel :

1. **Saisir** un résultat (aucun `Match` n'existe encore pour la résa jouée) — couvert par la
   carte `ResultsToRecord`, affichée en évidence sur Mon Palova, le Club-house et `/parties`
   (les deux onglets).
2. **Confirmer ou contester** un résultat déjà saisi par un coéquipier/adversaire
   (`Match.status === 'PENDING'` et ma `MatchPlayer.confirmation === 'PENDING'`, exposé côté
   API comme `needsMyConfirmation`) — **sans équivalent visible**. Aujourd'hui ce cas ne vit
   que dans `MyMatchesList`, elle-même enfouie dans l'onglet « Mes matchs » de `/parties` (ou
   `/me/matches`). Le seul rappel proactif est un email/push à la création du match, plus un
   bouton « 🔔 Relancer » que je peux déclencher moi-même vers **les autres** joueurs — rien ne
   me relance moi.

Un match `PENDING` non confirmé se valide quand même automatiquement à `confirmDeadline` (72h,
`autoValidateDue`) — la fenêtre de confirmation est donc aussi la seule fenêtre pour contester un
score erroné. Ne pas la voir a un coût réel (le niveau Glicko s'applique sans qu'on ait pu
réagir).

## Décision

Ajouter une carte **`ResultsToConfirm`**, miroir visuel et structurel de `ResultsToRecord`,
posée sur les **3 mêmes surfaces** : Mon Palova, Club-house, `/parties` (onglets « Parties » et
« Mes matchs »). Elle est rendue **au-dessus** de `ResultsToRecord` sur chacune de ces surfaces
(la confirmation est bornée dans le temps, la saisie ne l'est pas).

### Contenu d'une ligne

- Avatars des 4 joueurs, libellé « Équipe A **vs** Équipe B » en prénoms (mêmes helpers que
  `ResultsToRecord`, adaptés sans notion de `slot`).
- Score compact (« 6-4, 6-2 »), terrain, date/heure.
- Chip « Pour le fun » si `competitive === false` (identique à `ResultsToRecord`).
- Chip discrète de la date d'auto-validation (`confirmDeadline`), pour expliquer l'urgence
  sans phrase complète.

### Action par ligne

- **Confirmer** : bouton plein en 1 clic (comme « Saisir » sur l'autre carte, mais sans
  modale — l'action est immédiate).
- **Contester** : lien secondaire qui déplie une zone de texte sous la ligne (motif obligatoire,
  1-1000 caractères) avec Envoyer/Annuler — reproduit le comportement déjà existant et testé de
  `MyMatchesList`, mais en état local propre à `ResultsToConfirm` (aucune modification de
  `MyMatchesList`, qui reste la référence pour l'historique complet + fil de discussion).

Rendu `null` si la liste est vide (même contrat que `ResultsToRecord`).

## Architecture

### Backend — endpoint dédié, miroir de `listToRecord`

`MatchService.listToConfirm(userId, now)` : `prisma.matchPlayer.findMany` où
`userId = moi`, `confirmation: 'PENDING'`, `match: { status: 'PENDING' }` — exactement la
condition qui définit `needsMyConfirmation` côté `/api/me/matches`. Trié par
`match.confirmDeadline` croissant (le plus urgent d'abord). Le `now` n'est pas utilisé dans le
filtre (l'urgence est portée par le tri, pas une fenêtre de temps) mais reste un paramètre
explicite par cohérence avec `listToRecord` et pour la testabilité.

DTO renvoyé (léger, juste ce qu'il faut pour la carte — **pas** l'historique complet que renvoie
`/api/me/matches`) :

```
{
  matchId: string;
  playedAt: Date;
  sets: [number, number][];
  competitive: boolean;
  confirmDeadline: Date;
  club: { slug: string; name: string; timezone: string };
  resourceName: string | null;   // null si la réservation source a été supprimée
  players: { userId; firstName; lastName; avatarUrl; team: 1 | 2 }[];
}
```

Pourquoi un nouvel endpoint plutôt que filtrer `/api/me/matches` côté client : ce dernier renvoie
tout l'historique (potentiellement des centaines de lignes à terme) et son `club` n'expose pas
`slug` — impossible de scoper la carte au club courant sur Club-house/`/parties` sans l'élargir.
Un endpoint dédié, léger, trié pour l'usage exact de la carte, est le choix déjà fait pour
« à saisir » ; on le reproduit à l'identique plutôt que d'alourdir un endpoint existant.

Route : `GET /api/me/matches/to-confirm` (même emplacement dans `backend/src/routes/me.ts` que
`/matches/to-record`, juste après).

Aucune migration, aucun changement des routes `confirm`/`dispute` existantes
(`POST /api/matches/:id/{confirm,dispute}`, déjà utilisées par `MyMatchesList` et réutilisées
telles quelles par la nouvelle carte).

### Frontend

- **Types** (`lib/api.ts`) : `MatchToConfirmPlayer`, `MatchToConfirm` (miroir de
  `MatchToRecordPlayer`/`MatchToRecord`, sans `slot`/`isOrganizer`/`visibility` — non pertinents
  ici) + `api.getMatchesToConfirm(token)`.
- **Helpers purs** `lib/resultsToConfirm.ts` : `teamRows`/`teamLabel`, variantes de
  `lib/resultsToRecord.ts` opérant sur `MatchToConfirmPlayer` (groupement par `team`, ordre de
  tableau préservé — pas de tri par `slot`, absent de ce DTO) + `scoreSummary(sets)` (« 6-4,
  6-2 »).
- **Composant** `components/match/ResultsToConfirm.tsx` : props `{ token, clubSlug?, onChanged? }`
  (même signature que `ResultsToRecord`), charge `getMatchesToConfirm` au montage, filtre par
  `clubSlug` si fourni, état local `disputingId`/`reason` pour l'expansion de contestation par
  ligne, appelle `api.confirmMatch`/`api.disputeMatch` (déjà existants) puis recharge + `onChanged?()`.

### Placement (3 emplacements, comme `ResultsToRecord`)

| Fichier | Emplacement |
|---|---|
| `components/platform/MonPalova.tsx` | juste au-dessus du `<ResultsToRecord>` existant |
| `components/ClubHouse.tsx` | juste au-dessus du `<ResultsToRecord>` existant |
| `components/openmatch/OpenMatches.tsx` | au-dessus de `<ResultsToRecord>` dans la branche `view === 'parties'` **et** dans la branche `view === 'matchs'` |

## Tests

- Backend : bloc `listToConfirm` dans `backend/src/services/__tests__/match.service.test.ts`
  (renvoie les `PENDING` de l'utilisateur, exclut `CONFIRMED`/`DISPUTED`/`CANCELLED` et les
  matchs où je suis déjà `CONFIRMED`/`DISPUTED`, tri par `confirmDeadline`) ; test de route dans
  `backend/src/routes/__tests__/me.routes.test.ts` pour `GET /api/me/matches/to-confirm`.
- Frontend : nouvelle suite `frontend/__tests__/ResultsToConfirm.test.tsx` (rendu vide → null,
  rendu d'une ligne, confirmer, contester avec motif vide bloqué, contester avec motif → appel
  API + fermeture). Mises à jour minimales des suites qui montent `MonPalova`/`ClubHouse`/
  `OpenMatches` pour mocker `api.getMatchesToConfirm` (sinon l'appel réel échoue silencieusement
  en test — capté, mais autant fournir un mock explicite comme pour `getMatchesToRecord`).

## Hors périmètre

- Toute modification de `MyMatchesList` (reste la vue complète : historique, fil de discussion,
  relance des autres joueurs).
- Badge numérique sur l'onglet « Mes matchs » ou le menu profil (pourrait venir plus tard,
  discuté comme alternative plus légère mais pas retenue ici).
- Notification supplémentaire (email/push) — le rappel existant à la création du match est
  inchangé ; cette carte n'ajoute qu'un canal de **visibilité**, pas d'envoi.
