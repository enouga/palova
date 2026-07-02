# Checkout de réservation en page dédiée + heros « brume bleue »

**Date :** 2026-07-02
**Statut :** Design validé (maquettes validées dans le companion visuel — `.superpowers/brainstorm/50066-1783024103/content/checkout-hifi-v2.html` et `hero-doux.html`, option A « Brume bleue »)

## Contexte

Aujourd'hui, toute la confirmation d'une réservation vit dans **`BookingModal`** (788 lignes) : un top-sheet
de 480 px qui empile timer de hold, récap, constructeur d'équipes, visibilité, niveau, quotas, 4 modes de
paiement, CGV et formulaire Stripe — sans traitement desktop. Deux points d'entrée l'ouvrent :
`ClubReserve` (`/reserver`, tap sur un créneau + deep-link `?resource=&start=`) et la page terrain legacy
`/courts/[id]`. Le pattern « page + hero + Stripe inline » existe déjà dans l'app (fiches tournoi/event).

Par ailleurs, le dégradé signature **`HERO_GRADIENT`** (`components/agenda/AgendaHero.tsx`,
`linear-gradient(115deg, #5e93da, #2c4668)`, texte blanc) a été jugé trop dur par l'utilisateur — historique :
apricot « trop fort », cyan « fluo », et maintenant le bleu saturé rejeté aussi.

## Objectif

1. **Remplacer la modale par une vraie page de checkout** `/reserver/confirmer` — belle, aérée, avec un
   vrai layout desktop — en conservant à l'identique les mécaniques métier (hold 5 min, abandon = libération,
   joueurs persistés avant paiement, part du joueur, CGV sur le chemin carte).
2. **Adoucir tous les grands bandeaux** : le hero passe en « **brume bleue** » (lavis clair, texte encre)
   partout où `HERO_GRADIENT` est utilisé (checkout, fiche tournoi, fiche event, club-house).

**Décisions validées :** page dédiée (pattern Playtomic/fiche tournoi) plutôt que sheet wizard ou accordéon ;
hero doux étendu à toute l'app **dans cette feature** ; la page remplace la modale **sur les deux points
d'entrée** et **`BookingModal` est supprimé**.

## Design visuel (validé sur maquette)

**Hero « brume bleue »** : fond `linear-gradient(115deg, #e3edf9, #c8daf0)`, texte encre `#181510`,
sous-titres encre ~65 %, chips en blanc translucide (`rgba(255,255,255,.65)`, texte encre), cercle décoratif
`rgba(255,255,255,.45)`, **pastille timer blanche** (`⏱ m:ss`, tabular-nums, ombre légère) posée en haut à
droite, **fine barre de progression du hold** (piste encre 8 %, barre `ACCENTS.blue`) intégrée en bas du hero.

**Page mobile** (dans l'ordre) : barre de titre « ← | Confirmer ma réservation » → hero (chip sport·format,
nom du court, date `jeudi 3 juillet · 18h00 → 19h30`, prix total en grand + « soit X € par joueur », timer,
barre de hold) → carte **① Joueurs** (grille d'équipes `MatchTeams` Éq.1 bleue / VS / Éq.2 coral, places
libres en pointillés ; sports non-padel : chips partenaires + `PartnerSearch`) → carte **② Partie**
(Segmented Privée/Ouverte à tous + fourchette de niveau, padel + partie ouverte seulement) → carte
**③ Paiement** (cartes radio : « Ma part en ligne » avec carte enregistrée et montant de la part, « Au club »
total, « Mon carnet / porte-monnaie » avec solde ; sélection = liseré `ACCENTS.blue`) → note ℹ️ annulation +
lien CGV → **CTA collant** encre (`#181510`, radius 14, libellé adaptatif actuel + sous-ligne rappel du
créneau) avec « Abandonner (le créneau sera libéré) » en dessous. Les numéros d'étape sont des pastilles
`#eef3fb`/`#3a6db5`.

**Desktop (≥ 900 px, `useIsDesktop`)** : 2 colonnes — gauche : Joueurs, Partie, Conditions ; droite
(collante) : hero + carte Paiement + CTA. Largeur max ~860-960 px centrée.

**Étapes numérotées** = repères visuels seulement (pas un wizard) : tout est sur une page, le CTA unique en bas.

## Architecture

### Parcours & navigation

- Nouvelle page **`app/reserver/confirmer/page.tsx`** (client component), URL
  **`/reserver/confirmer?resource=<id>&start=<ISO>&duration=<min>`**.
- `ClubReserve` : tap sur un créneau libre → `router.push()` vers cette URL (plus de state `booking`).
  Le **deep-link** existant `/reserver?resource=&start=` redirige vers la page de checkout (même résolution
  de sport/durée qu'aujourd'hui). La page terrain legacy `/courts/[id]` navigue pareil.
- Le hero s'affiche immédiatement depuis les query params (optimiste) ; les valeurs serveur (prix notamment)
  font foi dès la réponse du hold.
- **Quitter = libérer** : « ← Retour » et « Abandonner » annulent la résa PENDING (best-effort, garde
  `settled` actuelle) puis `router.back()`. Un cleanup à l'unmount couvre le back navigateur. Fermeture
  d'onglet : filet existant (TTL Redis + cleanup job) — pas de sendBeacon en v1.
- Phases conservées : `holding | held | error` ; tout le contenu interactif gaté sur `held` ; erreurs mappées
  par `BOOKING_ERRORS` (quota, créneau pris, fenêtre…) → écran d'erreur + « Retour à la grille ».

### Rafraîchissement de page — hold idempotent (backend, additif)

Une page doit survivre à F5 : **`ReservationService.holdSlot` devient idempotent pour le même joueur** —
si l'appelant possède déjà une réservation **PENDING non expirée** sur exactement (resource, start, duration),
le service **renvoie cette réservation** (avec `createdAt`) au lieu de `SLOT_ALREADY_HELD`. Le front calcule
`secondsLeft = HOLD_SECONDS − (now − createdAt)` et reprend le décompte. Aucune migration ; la route et le
verrou Redis sont inchangés (le même `lock:` existe déjà pour ce joueur). Un tiers qui tient le créneau reçoit
toujours `SLOT_ALREADY_HELD`.

### Structure frontend

- **Hook `components/checkout/useBookingCheckout.ts`** : extrait de BookingModal la machine à états —
  hold-au-montage (garde `didHold` StrictMode-safe, annulation si fermé pendant le vol), timer, phases,
  `persistHoldSetup` (`applyHoldSetup` : partenaires/visibilité/niveau/équipes AVANT confirm/Stripe),
  confirmation (abo / solde / club / Stripe part du joueur), gating CGV (`cardIntentPath`), mapping
  `BOOKING_ERRORS`. Comportements identiques à l'existant.
- **Composants `components/checkout/`** (présentation) : `CheckoutHero` (hero brume bleue + timer + barre),
  `CheckoutPlayers` (réutilise `MatchTeams`/`PartnerSearch`/`FriendsQuickRow`), `CheckoutMatchOptions`
  (Segmented + `LevelRangeSlider`), `CheckoutPayment` (cartes radio + `StripePaymentStep` inline + CGV),
  `CheckoutFooter` (CTA collant adaptatif + Abandonner). `CancellationNotice` extrait de BookingModal en
  composant partagé ; `BookingHeaderCard` absorbé par `CheckoutHero`.
- **Données** : la page charge elle-même ce que `ClubReserve` passait en props (packages, subscriptions,
  quota status, flags club — `useClub()` + API existantes). Aucune nouvelle API de lecture.
- **Suppression** : `BookingModal.tsx` supprimé en fin de chantier (ConfirmDialog, copie indépendante du
  chrome, reste). Le scaffold mort `frontend/patch/` n'est pas concerné.

### Heros « brume bleue » partout (lot 2)

- `HERO_GRADIENT` (source de vérité dans `AgendaHero.tsx`) → `linear-gradient(115deg, #e3edf9, #c8daf0)`.
- `AgendaHero` passe en **texte encre** : titre `#181510`, sous-titre encre ~65 %, pills blanc translucide,
  jauge de remplissage sur piste encre 8 % (barre accent), compte à rebours inchangé dans sa logique —
  le coral d'urgence reste (lisible sur clair).
- **Tous les consommateurs** basculent (inventaire exhaustif en début de plan via grep `HERO_GRADIENT`) —
  connus : `TournamentHero`/fiche tournoi, fiche event, `HeroAnnouncement` (club-house « À la une », repli
  sans image), `PartnerOffers` (carte partenaire à la une). Les textes/chips blancs posés sur le dégradé
  passent en encre ; le contraste des éléments coral/accent est vérifié sur fond clair.
- Hors périmètre : les emails (branding propre), `MonthCalendar` (pas de hero), heros avec `imageUrl`
  (photo de fond → le texte reste blanc sur overlay sombre, comportement actuel conservé).

## Gestion des erreurs

- Échec du hold (créneau pris, quota, fenêtre, membership) → écran d'erreur dans la page (message
  `BOOKING_ERRORS`) + bouton retour grille. Timer expiré → même écran (« créneau expiré »).
- Échec `applyHoldSetup`/confirm → bandeau d'erreur inline au-dessus du CTA (comportement actuel).
- Carte refusée (Stripe) → géré par `StripePaymentStep` (inchangé), la résa reste PENDING payable autrement.

## Tests

- **Nouvelles suites checkout** (remplacent les 4 suites BookingModal, ~44 tests, mêmes scénarios) :
  hold au montage + garde StrictMode, erreur de hold + retour, abandon/retour = annulation, timer expiré,
  reprise après « refresh » (hold idempotent → secondsLeft recalculé), 4 chemins de paiement (part en ligne,
  club, carnet, abo), CGV gaté chemin carte, applyHoldSetup avec partenaires/équipes avant confirm.
- **Backend** : `reservation.service.test.ts` — hold idempotent (même joueur → renvoie la PENDING existante ;
  autre joueur → `SLOT_ALREADY_HELD` ; PENDING expirée → nouveau hold).
- **Navigation** : `ClubReserve` (tap → push URL ; deep-link → redirection), `/courts/[id]` idem.
- **Heros** : mises à jour des tests fiche tournoi/event/HeroAnnouncement/PartnerOffers (texte encre,
  gradient clair) — assertions de contenu conservées.
- Discipline connue : **suites scopées** (flake BookingModal historique ; vérifier par suites ciblées + tsc).

## Hors périmètre

- Mode « déplacer » (`?move=`) : n'existe plus dans le code actuel (doc CLAUDE.md périmée sur ce point) —
  non recréé ici.
- Refonte de la grille des créneaux de `/reserver` (sélection date/sport/durée inchangée).
- SSE sur la grille `/reserver` (créneau périmé entre affichage et tap → toujours géré par l'erreur de hold).
- sendBeacon à la fermeture d'onglet (TTL suffit).
- Emails, écrans admin, paiements/webhooks Stripe (inchangés).

## Rétro-compatibilité

Aucune migration DB. Backend : un seul changement, **additif et idempotent** (`holdSlot` re-hold même joueur).
Toutes les routes/webhooks existants inchangés. Le lot heros est purement visuel (structure DOM et data-testid
conservés autant que possible). Livraison en 2 lots testables : ① page checkout (+ bascule des 2 points
d'entrée + suppression modale), ② heros brume bleue partout.
