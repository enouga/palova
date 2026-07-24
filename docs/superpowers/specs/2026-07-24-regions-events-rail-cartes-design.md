# Régions d'events unifiées — rail net + carte « liseré éditorial »

**Date** : 2026-07-24
**Statut** : validé par Eric (choix A « rail net » + carte 3 « liseré éditorial », sur maquettes
comparées dans le companion visuel ; approche « composant région partagé » retenue)

## Problème

Les régions qui affichent des events (tournois, animations, parties, clubs) ont dérivé en
plusieurs copies de CSS de rail légèrement différentes (`TournamentFinder`, `DiscoverMatches`,
`ClubDirectory`, `TournamentsAlaUne`…). En mobile, les colonnes `86%` laissent la carte suivante
**coupée au milieu de son contenu** (jugé brouillon), et chaque section se comporte
différemment. La carte `AgendaCard` elle-même (filet gris `inset`, grosse tuile d'icône) est
jugée en retrait du langage éditorial du reste du site. Le desktop (étagère 2 colonnes) est
jugé bon.

Ce qu'Eric a coché comme gênant : cartes coupées, cartes pas assez belles, incohérence entre
sections. **Pas** le scroll horizontal en soi.

## Décisions (maquettes comparées)

- **Disposition mobile : « rail, une carte à la fois » (option A).** Défilement horizontal
  conservé, mais UNE carte pleinement visible + un liseré net de la suivante (jamais de contenu
  coupé à moitié), `scroll-snap mandatory`, points de pagination. Options rejetées : pile
  verticale + « Voir tout » (B), carrousel une-carte vedette (C).
- **Anatomie de carte : « liseré éditorial » (option 3).** Liseré latéral teinté par type,
  ombre douce, titre display, prix en chiffre vedette. Options rejetées : polish sobre (1),
  tuile-date (2).
- **Stratégie : composant région partagé** (pas de retouches locales par surface) — un seul
  endroit à maintenir, l'incohérence ne peut plus revenir.

## 1 · La carte restylée (`AgendaCardHeader` + `AgendaCard`)

Une seule anatomie, déclinée par type — seuls l'icône et la teinte changent :
tournoi = trophy/`ACCENTS.apricot`, animation = bolt/cyan, cours = whistle/bleu (les accents
déjà passés par les appelants aujourd'hui).

**`AgendaCardHeader` (corps partagé)** :

- La grosse tuile d'icône 42px disparaît → **petite icône (≈13px) inline devant le tag**,
  le tag uppercase prend une **teinte dérivée de l'accent du type** (au lieu du gris uniforme) —
  assombrie en mode clair pour rester lisible sur blanc, accent plein en mode sombre.
- **Titre en police display** (`th.fontDisplay`, ~17.5px, letterSpacing −0.2).
- **Nouvelle prop `price?: string | null`** : rendue en **chiffre display à droite** de la ligne
  de date (baseline alignée). `extra` reste et garde son rôle actuel de suffixe de la ligne de
  date (« Membres ») — les appelants qui passaient `40 €` dans `extra` basculent sur `price`.
- Ligne date à gauche / prix à droite ; jauge + places en pied, **épinglées en bas**
  (`marginTop: auto`) pour que les cartes d'un rail aient leurs pieds alignés à hauteurs égales.
- Chips countdown (coral si urgent) et `sportLabel` : inchangées.
- Tout reste en `<span>` (contrat `<button>`/`<div>` des consommateurs conservé).

**`AgendaCard` (coquille bouton)** :

- **Ombre douce** (recette `cardStyle()` du Club-house) à la place du filet
  `inset 0 0 0 1px th.line` ; `position: relative; overflow: hidden`.
- **Liseré latéral 4px teinté à l'accent** via l'atom **`CardStripe` existant** (`atoms.tsx`).
- **Chevron `chevR` supprimé** (la carte entière est le bouton ; affordance = lift au survol
  via l'utilitaire `.pl-lift` existant).
- La coquille (ombre + stripe + radius + padding) est exposée en **helper partagé**
  (`agendaCardShell(th, accent)` dans le module AgendaCard) pour les cartes dépliables.

**Consommateurs qui héritent sans travail** : `EventsClient` (/events ×3), `TournamentFinder`
(×2 branches), `UpcomingTournaments`. **Consommateurs à aligner sur la coquille partagée**
(petites retouches de wrapper, corps déjà partagé) : `RefereeTournamentCard`,
`CoachLessonCard`.

**Thème sombre (floodlit)** : liseré en pleine teinte accent, tag teinté accent, mêmes alphas
qu'aujourd'hui pour les chips ; l'ombre douce suit la recette `cardStyle` (qui gère déjà les
deux thèmes).

## 2 · Le rail partagé : `components/agenda/AgendaRail.tsx`

Nouveau composant qui remplace les copies de CSS de rail. Il possède **le scroller, pas
l'en-tête de section** (chaque surface garde son kicker/titre — déjà homogènes).

**API** :

```
<AgendaRail
  countLabel?: string | null      // « 8 tournois » — rangée droite au-dessus du rail
  desktopColumns?: string         // grid-auto-columns ≥700px, défaut 'calc(50% - 6px)'
  desktopRows?: 1 | 2 | 'auto'    // défaut 'auto' = 1 rangée si ≤4 enfants, sinon 2
  prevLabel / nextLabel: string   // aria des flèches
>{cards}</AgendaRail>
```

**Comportement** :

- **Mobile < 700px** : 1 rangée, `grid-auto-columns: calc(100% - 26px)` (gap 12) → une carte
  pleine + **liseré net ~14px** de la suivante, `scroll-snap-type: x mandatory`,
  **points de pagination** sous le rail (un point par carte, point actif allongé, cliquables),
  masqués ≥700px. Pas de flèches en mobile.
- **Desktop ≥ 700px** : étagère actuelle — colonnes `desktopColumns`, rangées selon
  `desktopRows`, `scroll-snap proximity`, flèches `RailArrows` (fondu latéral conservé),
  pas de points.
- Marges négatives `margin: 0 -20px` + `padding` internes (pattern actuel `sp-scroll-x`)
  conservés pour que le rail file bord à bord.

**`useScrollRail` étendu** : expose en plus `activeIndex` (index de snap dérivé de
`scrollLeft` / largeur de colonne + gap, mesuré sur le premier enfant) et
`scrollToIndex(i)` (smooth) pour les points. `edges`/`scrollByPage` inchangés pour les
consommateurs existants.

## 3 · Surfaces migrées

| Surface | Rail | Cartes |
|---|---|---|
| /decouvrir · Tournois (`TournamentFinder` embarqué) | `AgendaRail` (2 col desktop) | `AgendaCard` restylée (`price`=entryFee) |
| /decouvrir · Parties (`DiscoverMatches`) | `AgendaRail` (`desktopColumns:'270px'`, 1 rangée) | `NationalMatchCard` **inchangée** (déjà premium : liseré haut accent-club, ombre) |
| /decouvrir · Clubs (`ClubDirectory`) | `AgendaRail` (3 col desktop) | habillage harmonisé : ombre douce + liseré latéral à l'`accentColor` du club |
| Club-house · Prochains events (`TournamentsAlaUne`) | `AgendaRail` (dans sa carte conteneur, en-tête conservé) | ses mini-tuiles `surface2` deviennent de **vraies `AgendaCard` restylées** |
| Club-house · Ça joue bientôt (`OpenMatchesShowcase`) | `AgendaRail` (comportement seul) | cartes showcase **inchangées** |
| Vitrine anonyme · tournois (`UpcomingTournaments`) | passe de la colonne à **`AgendaRail`** | `AgendaCard` restylée |
| Vitrine + Mon Palova · parties (`NationalOpenMatches`) | `AgendaRail` (comportement seul) | cartes **inchangées** |
| /events (page club) + /tournois autonome | **restent des flux verticaux** (pas des rails) | héritent des `AgendaCard` restylées |
| Espaces J/A (`RefereeTournamentCard`) & coach (`CoachLessonCard`) | listes verticales inchangées | coquille partagée (ombre + liseré) + en-tête hérité |

Plafonds d'affichage (`MAX_VISIBLE` 8/9, cap 4 vitrine), filtres, compteurs, deep-links, tri :
**inchangés**.

## 4 · Hors périmètre

- **Aucun backend, aucune migration** — 100 % frontend présentation.
- /me/reservations (`ReservationAgendaCard`, `MyAgendaListItem`, `DayPanel`,
  `MonthCalendar`) : le liseré y signifie « club » (marqueur du 2026-07-22), on n'y touche pas.
- `/parties` (`OpenMatchCard`) et les fiches détail (`/tournois/[id]`, `/events/[id]`).
- Cartes admin (`AgendaAdminCard`) — déjà leur propre langage liseré.
- `StatPill` (mentionne la convention de tuile AgendaCard en commentaire — indépendant).

## 5 · Tests & vérification

- `AgendaCard.test` : nouvelle anatomie (liseré présent teinté accent, prix display rendu via
  `price`, `extra` toujours en suffixe de date, plus de chevron), contrats existants conservés
  (countdown, sport-badge, jauge `card-fill`).
- Nouvelle suite `AgendaRail.test` : points de pagination (nombre = enfants, clic →
  `scrollToIndex`), flèches aria, `countLabel`, règle `desktopRows:'auto'` (1 rangée ≤4).
- Suites de surfaces existantes (`TournamentFinder`, `EventsClient`, `ClubDirectory`,
  `ClubHouse`, `AnonymousView`, `NationalOpenMatches`, `DiscoverMatches`…) : adaptées si elles
  assertaient le CSS de rail ; contrats fonctionnels (titres, liens, filtres) intacts.
- `tsc --noEmit` + **vérif CDP** clair/sombre, desktop 1280 + mobile 390 (`mobile:false`,
  largeur fixe — piège d'émulation connu), sur /decouvrir, /events, club-house, vitrine.
