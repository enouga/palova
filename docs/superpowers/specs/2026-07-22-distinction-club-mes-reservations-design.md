# Distinction graphique des entrées d'autres clubs — « Mes réservations »

**Date** : 2026-07-22
**Statut** : validé (Eric, comparatif de 3 pistes — « Couleur du club » retenue)

## Problème

Sur `/me/reservations`, quand le club active `showOtherClubsReservations` (ou sur l'hôte
plateforme palova.fr), les réservations, tournois, events et cours de **tous** les clubs du
joueur sont mélangés. Une entrée d'un autre club est déjà détectée (`isForeign` → carte-lien
« Voir › » sans actions inline) et le nom du club figure en sous-titre texte, mais **rien ne
la distingue visuellement** d'une entrée du club courant.

## Décision

Chaque entrée d'un autre club porte un **marqueur à la couleur d'accent de SON club**
(`Club.accentColor`) :

- **Liseré latéral** 4 px plein bord gauche de la carte (pattern exact du liseré des cartes
  admin `AgendaAdminCard`) ;
- **Chip du nom du club** teintée (`<Chip color={accent}>` existant, lisibilité clair/sombre
  déjà calibrée par le composant) qui **remplace** le nom du club en texte dans le sous-titre
  (jamais chip + texte dupliqués).

### Règle d'activation

| Contexte | Entrée du club courant | Entrée d'un autre club |
|---|---|---|
| Hôte club (`localSlug` non null) | **strictement inchangée** | liseré + chip |
| Hôte plateforme (`localSlug` null) | — (aucun club courant) | **toutes** les entrées portent le marqueur de leur club |

### Périmètre

- Surfaces : listes « À venir »/« Passées » (`MyAgendaListItem`), panneau du jour
  (`DayPanel`), carte padel partagée (`ReservationAgendaCard`, chip seule — le liseré vient
  du wrapper de l'appelant).
- **`MonthCalendar` hors périmètre** : ses pastilles/rubans sont codés **par type** (bleu
  résa / apricot tournoi / emerald event via `agendaKindMeta`) — une couleur club y entrerait
  en collision sémantique directe.
- **Marqueur = présentation seule** : la logique `isForeign` (carte-lien, actions masquées)
  est intouchée. Les **cours** peuvent porter le marqueur (leur payload a un `club.slug`)
  tout en restant hors `isForeign` (leur lien `/cours/{id}` est same-origin).

## Architecture

- **Backend additif, aucune migration** : `accentColor` (colonne existante, donnée publique
  déjà exposée par `ClubDetail`) ajouté aux selects club des 4 payloads « mes inscriptions » :
  `reservation.service.listUserReservations`, `tournament.service.listUserRegistrations`,
  `event.service.listUserRegistrations`, `lesson.service` (3 selects partagés via
  `mapToPublicRow`).
- **Types front** : `accentColor?: string` **optionnel** (convention champs additifs — les
  fixtures hors périmètre restent vertes).
- **Helpers purs** dans `lib/calendar.ts` : `agendaItemClub(item)` (club d'un
  `AgendaListItem` OU d'un `CalendarEntry`, union structurelle) et
  `clubMarker(club, localSlug) → { name, accent } | null` — null si entrée du club courant
  sur hôte club ; **fallback `ACCENTS.blue`** si `accentColor` absent du payload (cache,
  fixtures).
- **Atom `CardStripe`** dans `components/ui/atoms.tsx` (span `aria-hidden` absolu, parent en
  `position:relative; overflow:hidden` pour épouser le borderRadius). L'`opacity` des cartes
  passées estompe le liseré avec la carte (voulu).
- Sous-titres porteurs de chip en `flex; flexWrap` (la chip est `nowrap` → pas de débordement
  mobile 390).

## Ligne d'info quand le cloisonnement est actif (ajout du 2026-07-22)

Sur un hôte club avec `showOtherClubsReservations` **OFF**, un joueur multi-clubs peut croire
qu'une réservation a « disparu » (elle est juste sur l'autre club). Une **ligne discrète sous
la barre d'onglets** (visible quel que soit l'onglet actif — la confusion naît autant dans la
liste À venir que sur un jour du calendrier qui a l'air vide) :

> Vous avez aussi N réservation(s) à venir dans d'autres clubs · **Tout voir sur Palova →**

- Conditions : hôte club + réglage OFF + **≥ 1 entrée étrangère à venir** (les passées ne
  perturbent personne). Réglage ON ou hôte plateforme → jamais affichée.
- **Ne nomme jamais les autres clubs** (le compromis qui respecte le choix du club hôte de ne
  pas afficher les concurrents, tout en dépannant le joueur) ; le lien va vers
  `/me/reservations` de l'hôte plateforme (`platformUrl`), où l'agenda complet vit toujours.
- Helpers purs `foreignUpcomingCount` (compté sur les données NON filtrées, via
  `buildAgendaList` — exclut annulées et passées) et `otherClubsHintLabel`
  (singulier/pluriel) dans `lib/calendar.ts` ; zéro backend (les données étaient déjà
  chargées puis filtrées côté client).

## Hors périmètre

- Couleur club dans la grille mensuelle `MonthCalendar`.
- Logo du club dans le marqueur (accentColor suffit ; élargirait encore les payloads).
- Tout changement de comportement (`isForeign`, liens, actions).
