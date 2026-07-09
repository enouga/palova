# Mes réservations — carte alignée sur « Mes parties »

**Date : 2026-07-09**

## Problème

Sur « Mes réservations » (Calendrier + À venir/Passées), une réservation padel avec des
joueurs affiche aujourd'hui une carte minimale : titre, chip de statut (« En attente » /
« Confirmée » — peu lisible, quasi toujours `CONFIRMED` puisque `CANCELLED` est filtré en
amont dans `lib/calendar.ts`), ligne meta (heure + prix), bouton Annuler, puis le
mini-terrain `MatchTeams` en lecture/édition simple. Sur « Mes parties » (`/parties`,
`OpenMatchCard`), la même donnée (une partie de padel) est présentée de façon beaucoup plus
riche : chip « N places », chips sport/niveau, mini-terrain, barre d'actions Discuter/
Partager/Vous organisez. Le user veut la même présentation sur ses propres réservations.

`DayPanel.tsx` et `MyAgendaListItem.tsx` dupliquent aujourd'hui presque à l'identique le
rendu d'une réservation padel — l'occasion de factoriser en un seul composant au passage.

## Périmètre

- Concerne uniquement les **réservations padel** (celles qui utilisent déjà `MatchTeams`,
  c'est-à-dire `resource.sport?.key === 'padel'`). Les autres sports (`PlayerPills`) sont
  inchangés.
- Concerne les deux vues qui listent une réservation : Calendrier (`DayPanel`) et
  À venir/Passées (`MyAgendaListItem`).
- Les entrées « étrangères » (autre club, vue cross-club) gardent leur carte-lien actuelle,
  inchangée — pas de mini-terrain ni d'actions dessus aujourd'hui, ça ne change pas.
- Tournois/events/cours : inchangés.
- Hors périmètre : badge de non-lus sur « Discuter » (nécessiterait un champ additif côté
  API `listUserReservations`, non fait ici — voir « Hors périmètre » ci-dessous).

## Composant partagé

Nouveau `frontend/components/reservations/ReservationAgendaCard.tsx` : rend le **contenu**
d'une réservation padel (en-tête, ligne meta, `OpenMatchToggle`, mini-terrain, barre
d'actions). `DayPanel` et `MyAgendaListItem` gardent chacun leur propre enveloppe de carte
(stripe/padding/lien « étranger », qui diffèrent légèrement aujourd'hui) et rendent ce
composant à l'intérieur pour le cas `kind === 'reservation'` non-étranger, sport padel.

```
ReservationAgendaCard({
  reservation: MyReservation;
  past: boolean;
  showSport?: boolean;
  token: string;
  now: number;
  onCancel: (r) => void;
  onPlayersChanged: () => void;
  onRecordResult?: (r) => void;
  canRecord?: (r) => boolean;
  existingMatchStatus?: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
})
```

Les réservations non-padel et les entrées étrangères continuent d'être rendues par le code
existant de `DayPanel`/`MyAgendaListItem` (pas de changement pour elles).

## En-tête

- Icône + titre : inchangés.
- Chip à droite :
  - **À venir** : remplace le chip de statut par **« N places »/« Complet »** (mêmes tons
    `Chip` qu'`OpenMatchCard` : `accent` si places restantes, `mute` si complet).
  - **Passée** : pas de chip (le nombre de places restantes ne veut plus rien dire une fois
    la partie jouée).

## Ligne meta

- Heure/date : inchangé.
- Chip sport (au lieu du préfixe texte « Padel · ») si `showSport`.
- Chip niveau (`rangeLabel(targetLevelMin, targetLevelMax)`) si la réservation est une
  partie ouverte (`visibility === 'PUBLIC'`) avec une fourchette définie — même condition
  et même rendu qu'`OpenMatchCard`.

## Barre d'actions (sous le mini-terrain, remplace l'actuel bouton Annuler isolé + la ligne
« Saisir le résultat » séparée)

- **Partie ouverte (`visibility === 'PUBLIC'`)** :
  - Gauche : bouton **Discuter** (ouvre `OpenMatchChatSheet`) + bouton **Partager**
    (réutilise le mécanisme de lien `/parties/:id` déjà présent dans `OpenMatchToggle` — qui
    perd son propre bouton de partage pour éviter le doublon).
  - Droite : **Annuler** (si `isCancellationOpen`), sinon rien — jamais de chip « Vous
    organisez » : sur « Mes réservations » le viewer est **toujours** l'organisateur
    (`listUserReservations` filtre `where: { userId }`), donc ce chip n'apporterait aucune
    information ; Annuler est l'action utile à sa place.
- **Partie privée** : uniquement **Annuler** à droite (si ouvert), pas de Discuter/Partager
  (pas de canal de chat pour une réservation non publique — `assertChatAccess` exige
  `visibility PUBLIC`).
- **Passée** : bouton **Saisir le résultat** à gauche (si `canRecord`), sinon le libellé de
  statut du match existant (« Résultat enregistré » / « En litige ») — reprend exactement
  la logique actuelle de `MyAgendaListItem`, déplacée dans la barre du bas. `DayPanel`
  passera désormais aussi `existingMatchStatus` (petit gain de cohérence, il ne le faisait
  pas avant).
- `OpenMatchToggle` (Ouvrir/Fermer aux joueurs du club) reste affiché **au-dessus** du
  mini-terrain, à sa place actuelle — inchangé dans son fonctionnement, seul son bouton de
  partage disparaît (doublon avec la nouvelle barre du bas).

## Câblage technique

- `viewerUserId` (requis par `OpenMatchChatSheet`) : dérivé de
  `reservation.participants.find(p => p.isOrganizer)?.userId` — pas d'appel API
  supplémentaire (le viewer est toujours cet organisateur).
- `viewerIsOrganizer={true}` (toujours vrai ici) ; `canModerate={false}` (inutile, l'égalité
  organisateur suffit côté `OpenMatchChatSheet.canDelete`).
- Club de contexte pour le chat/partage : `reservation.resource.club.slug` (pas le `slug`
  de la page) — correct même dans la vue agrégée cross-club (`showAll`).
- Lien de partage : même construction que l'actuel `OpenMatchToggle` (`${origin}/parties/${reservation.id}`), pas besoin de `matchShareUrl` (qui attend un `OpenMatch` avec `cardVersion`).

## Hors périmètre

- Badge de non-lus sur le bouton Discuter (demanderait un champ additif côté backend sur
  `listUserReservations` — pas fait ici).
- Toute évolution du chip de statut/places pour les entrées non-padel.
- Toute évolution des cartes tournoi/event/cours.

## Vérification

- `frontend/__tests__/ReservationAgendaCard.test.tsx` (nouveau) : chip places vs statut
  passé, chips sport/niveau, barre d'actions (Discuter+Partager si public, Annuler seul si
  privé, Saisir le résultat si passé), dérivation `viewerUserId`.
- `DayPanel.test.tsx` / `MyAgendaListItem.test.tsx` : mis à jour pour la nouvelle
  composition (toujours verts fonctionnellement).
- `tsc --noEmit` propre.
- Visuel (`/me/reservations`, Calendrier + À venir) clair + sombre, réservation privée et
  publique, passée et à venir.
