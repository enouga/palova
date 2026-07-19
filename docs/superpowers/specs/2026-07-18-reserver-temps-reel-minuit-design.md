# Spec — Page Réserver en temps réel + rendez-vous d'ouverture à minuit

**Date** : 2026-07-18
**Statut** : validé en dialogue (Eric), en attente de relecture de la spec écrite
**Contexte** : correctifs 5 et 6 de l'audit perfs « rush de minuit » (2026-07-18). Les correctifs 1-4
(micro-cache dispo, N+1, compression Caddy, cache auth) sont mergés dans main (`a766337`).

## Problème

La page Réserver est **statique entre deux rechargements** : un créneau pris ailleurs reste affiché
« libre » jusqu'au prochain F5, et la fenêtre de réservation ne « s'ouvre » qu'au re-render — le
produit organise donc lui-même la ruée de F5 à minuit (clic → `SLOT_ALREADY_HELD` → re-F5). Le
serveur encaisse désormais la horde (cache 2 s), mais l'expérience reste « rafraîchir pour voir ».

**Principe directeur** : on n'empêche pas le F5 — on le rend *inutile* (la page vit toute seule),
*visiblement inutile* (le joueur voit la page bouger), et *inoffensif* (déjà fait, cache 2 s).

## Décisions de cadrage (actées avec Eric)

- **Approche A** : un canal SSE **par club** (une connexion par onglet), pas une connexion par
  terrain (2 400 connexions pour 8 terrains × 300 joueurs), pas de polling (pas vraiment live).
- **Rendez-vous de minuit = jour verrouillé 🔒 dans le sélecteur de dates + bandeau < 1 h** (les
  deux, pas l'un ou l'autre).
- **Les deux vues (cartes/grille) sont conservées** telles quelles — elles lisent le même état,
  le live les sert toutes les deux gratuitement.

## Volet 1 — Canal SSE « disponibilités club » (backend)

- `SSEService` gagne un **5ᵉ canal** calqué sur les 4 existants :
  `clubClients: Map<clubId, Set<Response>>`, `addClubClient(clubId, res)`,
  `broadcastClub(clubId, event)`, heartbeat 30 s par connexion, nettoyage sur `close`,
  suppression de l'entrée Map quand le Set se vide.
- **Émission jumelle** : chaque site qui broadcast aujourd'hui un événement de créneau par terrain
  (`slot_held`/`slot_confirmed`/`slot_released`) émet **le même payload** vers le canal club. Les
  sites et le `clubId` en scope sont **exactement ceux du câblage `invalidateClubAvailability`**
  (hold, confirm, performCancel, admin create/reschedule, séries create/cancel, job cleanup) —
  même placement, juste après l'invalidation du cache. ⚠️ **Ordre à préserver : invalidation du
  cache PUIS broadcast** — un client qui refetch en réaction à l'événement doit obtenir l'état frais.
- Les émissions **par terrain restent** (la page `/courts/[id]` en dépend).
- **Route publique** `GET /api/clubs/:slug/availability/stream` (routeur clubs) : résolution
  slug→club `ACTIVE` (404 `CLUB_NOT_FOUND` sinon), pas d'auth — cohérent avec `GET /:slug/availability`
  et avec le flux par terrain `/api/resources/:id/stream`, déjà publics tous les deux.
- Aucune migration, aucun changement de payload des événements existants.

## Volet 2 — Grille vivante (frontend, `ClubReserve.tsx`)

- **Une EventSource par onglet** ouverte au montage de l'onglet « book » (fermée au démontage).
  Pas de singleton partagé nécessaire (une seule page consomme ce flux).
- **Patch local pur** — helper testé `frontend/lib/reserveLive.ts` :
  - `slot_held` / `slot_confirmed` → tout créneau **chevauchant** `[startTime, endTime)` de
    l'événement sur ce `resourceId` passe `available: false`. Chevauchement, pas égalité stricte :
    une résa 1h30 bloque les créneaux 1h qui la recouvrent. Patch sûr sans connaissance des autres
    réservations (une résa active chevauchante suffit à bloquer).
  - `slot_released` → **pas de patch local** : le client ne connaît pas les autres résas qui
    peuvent encore couvrir le créneau (ex. slot 8h-9h30 chevauché par deux résas dont une seule
    est annulée). À la place : **refetch débouncé (~500 ms) du jour affiché** via `reloadAll` —
    rare (annulations/expirations), et le cache serveur — invalidé avant le broadcast — sert
    l'état frais. Un créneau qui se libère « réapparaît » donc en vert en ~1 s.
  - Les événements d'un **autre jour** que celui affiché sont ignorés (comparaison au fuseau du club).
- **Pastille « ● En direct »** (point accent qui pulse doucement) posée sur la rangée
  SportPicker/ViewToggle. Connexion coupée → **« Reconnexion… »** (EventSource se reconnecte
  nativement, on ne pose jamais de `onerror → close`, convention du repo) ; à la **reconnexion**,
  un `reloadAll` silencieux resynchronise ce qui a été raté pendant la coupure.
- **Animation** : le flip libre↔pris se fait avec une transition CSS douce (fondu/scale léger)
  dans les deux vues — c'est LA preuve visible que la page vit ; `prefers-reduced-motion` respecté.
- Après le propre hold/confirm du joueur, le comportement existant (reloadAll à la confirmation)
  reste — le patch live est idempotent par-dessus.

## Volet 3 — Rendez-vous d'ouverture (frontend)

- Helper pur testé `frontend/lib/bookingOpen.ts` : `nextOpening(club, isSubscriber, now)` →
  `{ opensAtMs, dayKey } | null` — miroir client de `backend/src/services/booking-window.ts` :
  - `DAY_AT_HOUR` (défaut, H=0 ⇒ minuit) et `WINDOW_SHIFT` : prochaine bascule = prochain
    `releaseHour` local du club → un nouveau jour s'ouvre à instant fixe → rendez-vous.
  - `ROLLING_SLOT` (fenêtre glissante continue) : **pas de rendez-vous** → `null`, aucun
    compte à rebours ni jour verrouillé chez ces clubs.
  - La fenêtre est **celle du joueur** : abonné (fenêtre élargie `memberBookingDays` /
    `memberReleaseHour`) vs public — la page connaît déjà l'adhésion (`getMyMemberships`) et
    `bookingWindow` existant fait déjà ce calcul ; `nextOpening` s'appuie dessus.
- **Sélecteur de dates** : le **premier jour au-delà de la fenêtre** apparaît **verrouillé 🔒**
  (un seul jour, pas toute la traîne). Il est tapable → à la place de la grille, **panneau
  compte à rebours** plein cadre : « Les créneaux du samedi 25 juillet ouvrent dans 03:12:45 ·
  ils apparaîtront ici automatiquement ». Timer 1 s (posé en effet — jamais de `new Date()` au
  rendu, convention hydration du repo).
- **Bandeau discret** au-dessus de la grille quand `opensAt − now < 60 min` et que le joueur
  n'est pas déjà sur le panneau : « ⏱ Ouverture des créneaux du {jour} dans MM:SS ».
- **À zéro** : attente d'un **jitter aléatoire 0-3 s** (étale la pointe sur le serveur), puis
  fetch du nouveau jour ; si le joueur était sur le panneau verrouillé → la **grille prend sa
  place toute seule** (le jour se sélectionne) ; sinon le bandeau devient « Les créneaux du
  {jour} sont ouverts → » (tap = sélectionne le jour). Le sélecteur déverrouille le jour.
- Horloge client fausse : assumé — le compte à rebours est indicatif, le fetch à zéro re-valide
  côté serveur (`BOOKING_TOO_FAR` reste la garde de vérité au hold).

## Hors périmètre (volontaire)

- Notification push « c'est ouvert », file d'attente virtuelle, priorité abonnés à l'ouverture.
- Temps réel sur le planning admin et sur `/courts/[id]` (garde son flux par terrain).
- Rate-limit availability/hold (correctif 7 de l'audit, chantier séparé).
- Multi-instance (le canal club est en mémoire process, comme les 4 autres — le passage à
  Redis pub/sub est le même chantier global déjà documenté).
- Limite du nombre de connexions SSE (cohérent avec l'existant, hors périmètre).

## Tests

- **Backend** : `sse.service` (canal club : add/broadcast/cleanup/heartbeat) ; route stream
  (404 club inconnu/suspendu, 200 + headers SSE) ; câblage `broadcastClub` aux sites d'écriture
  (mêmes assertions de câblage que l'invalidation du cache, dans `reservation.service`/
  `reservation.series`/`cleanup.job`).
- **Frontend** : `reserveLive` (patch held/confirmed multi-durées, released → signal refetch,
  autre jour ignoré) ; `bookingOpen` (3 modes de release, abonné vs public, ROLLING → null,
  bascule au releaseHour) ; `ClubReserve.live` (patch appliqué sur événement, reconnexion →
  reloadAll, pastille En direct/Reconnexion — EventSource stubbée, jsdom ne l'implémente pas) ;
  `ClubReserve.opening` (jour 🔒 rendu et tapable, compte à rebours, bandeau < 60 min, bascule
  auto à zéro avec fake timers + jitter mocké).

## Risques & garde-fous

- **Ordre invalidation → broadcast** : déjà respecté par le câblage des correctifs 1-4 ; à ne
  pas inverser (sinon refetch = état périmé pendant ≤ 2 s).
- **Charge SSE** : ~1 connexion par onglet Réserver ouvert ; à 300-1000 connexions le singleton
  actuel tient (cf. audit — coût = 1 socket + 1 timer/connexion). Prod : Caddy streame le SSE
  sans compression (liste `encode` explicite, event-stream exclu).
- **Dérive d'horloge client** : le rendez-vous s'appuie sur l'heure client ; écart toléré, la
  vérité reste serveur au hold.
