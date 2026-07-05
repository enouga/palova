# Club-house v2 — vitrine du club, affiches, offres en ligne, partenaires (design)

**Date** : 2026-07-05
**Statut** : validé en brainstorming (maquettes navigateur + questions), prêt pour plan d'implémentation.

## Contexte

Le Club-house est la landing page du sous-domaine club. Aujourd'hui : hero « À la une » (annonce épinglée), créneaux libres, prochains events, « Parties pour toi » (3 recos niveau, connecté seulement), vos réservations, annonces texte, offres partenaires (`PartnerOffers`).

Objectif v2 : en faire une vraie vitrine **et** un hub membre — présentation du club avec photos, affiches uploadées par le club (offres, calendriers de tournois, événements) affichées de façon élégante, offres & abonnements souscriptibles **en ligne**, parties ouvertes visibles de tous, mise en avant très moderne des partenaires.

## Décisions produit (validées avec le user)

| Sujet | Décision |
|---|---|
| Audience | **Adaptatif** : visiteur anonyme = vitrine d'abord ; membre connecté = quotidien d'abord (mêmes sections, ordre différent). |
| Présentation du club | **Teaser sur le Club-house + page dédiée `/club`** (présentation complète, galerie, adresse, horaires, contact). |
| Offres & abonnements | **Vitrine + achat en ligne** (Stripe Connect existant), dans **ce chantier** (pas de découpage). |
| Paiement abonnement en ligne | **1re mensualité seulement** (miroir exact de la vente caisse : abonnement activé pour la durée d'engagement, mensualités suivantes au club). Carnet/porte-monnaie = prix unique. |
| Parties ouvertes | Une section générale « Parties ouvertes » (les 3 prochaines, tous niveaux) qui **remplace** « Parties pour toi » (recos supprimées du Club-house). |
| Visuels uploadés | **Annonces enrichies** (pas de médiathèque séparée) : vraie image uploadée + type + date de fin, affichées en **mosaïque bento + lightbox** (choix maquette B). |
| Partenaires | **Rivière de cartes riches défilantes** (choix maquette A2) : logo + nom + rôle + offre/code visibles, défilement lent en boucle, pause au survol. Remplace `PartnerOffers`. |
| Idée différenciante retenue | **Top du mois** (podium 3 joueurs). Écartés : mode TV, pouls du club, météo, affiche QR. |

### Ordre des sections

**Visiteur** : Hero À la une → **Le club** (teaser) → Créneaux libres · Prochains events → **Parties ouvertes** → **À l'affiche** (bento) → **Abonnements & offres** → **Top du mois** → Annonces → **Rivière partenaires**.

**Membre connecté** : Hero → Créneaux · Events → **Parties ouvertes** → Vos réservations → **À l'affiche** → **Top du mois** → **Abonnements & offres** (masquée si abonnement actif) → **Le club** (teaser) → Annonces → **Rivière partenaires**.

Chaque section conserve le comportement actuel : chargement indépendant, vide ou en erreur → masquée en silence. Horloge `now` hydration-safe existante réutilisée (jamais de `new Date()` au rendu).

## Modèle de données (migrations additives)

Appliquées en dev via `prisma db execute` du SQL additif (base dev en dérive — jamais `db push`/`migrate dev`), en prod `migrate deploy`.

**Migration `enrich_announcements`** :
- `Announcement.kind` : enum `AnnouncementKind { INFO OFFER TOURNAMENT EVENT }`, défaut `INFO`.
- `Announcement.validUntil DateTime?` : fin d'affichage. Saisie admin `YYYY-MM-DD`, stockée **fin de journée UTC** (même convention que `Sponsor.offerUntil`). `null` = sans limite.
- `imageUrl` existant réutilisé : il reçoit désormais le chemin d'un fichier **uploadé** (`/uploads/announcements/...`) au lieu d'une URL collée.

**Migration `add_club_presentation`** :
- Nouveau modèle **`ClubPhoto`** : `id`, `clubId` (FK cascade), `url`, `caption String?`, `sortOrder Int @default(0)`, `createdAt`. Index `[clubId]`.
- `Club.presentationText String?` (long, multi-paragraphes ; `description` reste le résumé court de l'annuaire).
- `Club.contactPhone String?`, `Club.contactEmail String?`, `Club.openingHoursText String?` (texte libre, ex. « Lun–Ven 8h–22h »).
- `Club.showOffersPublicly Boolean @default(false)` : opt-in d'affichage des formules sur le Club-house (cohérent avec `listTournamentsNationally`).

Aucun changement sur `Sponsor`, `SubscriptionPlan`, `PackageTemplate`, `Subscription`, `MemberPackage`, `Payment`.

## Backend

### Annonces enrichies

- `POST /api/clubs/:clubId/admin/announcements/:id/image` : multer memoryStorage, 5 Mo max, JPEG/PNG/WebP, fichier `uploads/announcements/<id>-<ts>.<ext>`, ancien fichier supprimé (pattern avatar). Suppression d'annonce → suppression du fichier (best-effort).
- CRUD admin existant étendu : `kind`, `validUntil` (validation date), `imageUrl` n'est plus saisi à la main.
- `GET /api/clubs/:slug/announcements` (public existant) expose `kind`/`validUntil` ; le filtrage des expirées se fait **côté client** avec l'horloge `now` (helper pur, hydration-safe) — le serveur continue de tout renvoyer publié. Une annonce expirée disparaît **partout** (bento, hero, liste texte).

### Présentation du club

- `GET /api/clubs/:slug/presentation` (public) : `{ presentationText, coverImageUrl, photos: [{ id, url, caption }], address, city, latitude, longitude, contactPhone, contactEmail, openingHoursText }`. Club ACTIVE requis.
- Admin (`requireClubMember('ADMIN')`) :
  - `PATCH /api/clubs/:clubId/admin/presentation` : `presentationText`, `contactPhone`, `contactEmail`, `openingHoursText`.
  - `POST /api/clubs/:clubId/admin/photos` (multipart, 5 Mo, JPEG/PNG/WebP, fichier `uploads/club-photos/<clubId>-<ts>.<ext>`) — refus `PHOTO_LIMIT_REACHED` (409) au-delà de **12 photos**.
  - `PATCH /api/clubs/:clubId/admin/photos/:id` (`caption`, `sortOrder`), `DELETE …/photos/:id` (fichier supprimé best-effort).

### Offres & achat en ligne

- `GET /api/clubs/:slug/offers` (public) : si `showOffersPublicly = false`, renvoie `200` avec listes vides (pas d'énumération de l'opt-out). Sinon renvoie :
  - `plans` : SubscriptionPlans actifs (`id, name, monthlyPrice, commitmentMonths, offPeakOnly, benefit, discountPercent, dailyCap, weeklyCap, sportKeys`),
  - `packages` : PackageTemplates actifs (`id, name, kind, price, entries, amount, validityDays`),
  - `onlinePurchase: boolean` (Stripe Connect du club ACTIVE **et** montant ≥ 0,50 €).
- **Achat** (auth requis, adhésion ACTIVE créée à la volée via `ensureActiveMembership`, refus `MEMBERSHIP_BLOCKED`) :
  - `POST /api/clubs/:slug/offers/plans/:id/intent` et `POST /api/clubs/:slug/offers/packages/:id/intent` : créent un PaymentIntent Stripe (compte connecté, pattern `createRegistrationPaymentIntent`, CustomerSession carte enregistrée incluse) avec metadata `{ kind: 'offer_plan'|'offer_package', clubId, userId, offerId }`. Montant : plan → `monthlyPrice` (1re mensualité) ; package → `price`. Erreur `ONLINE_PAYMENT_NOT_ENABLED` (409) si Stripe non actif ou < 0,50 €.
  - **Confirmation** — rien n'est pré-créé en base ; la `Subscription` ou le `MemberPackage` naît à la confirmation, déclenchée par **le client ET le webhook** `payment_intent.succeeded` (routé par metadata) :
    - `POST /api/clubs/:slug/offers/confirm` `{ paymentIntentId }` : vérifie le statut auprès de Stripe, puis transaction Serializable : si un `Payment` avec ce `stripePaymentIntentId` existe déjà → early-return (idempotent, pas d'index unique ajouté) ; sinon création `Subscription` (snapshot plan, `expiresAt = now + commitmentMonths`, miroir `sellSubscription`) **ou** `MemberPackage` (miroir vente caisse `PackageService`), + `Payment` `ONLINE/CAPTURED` avec `receiptNo`, `subscriptionId`/`memberPackageId`, `stripePaymentIntentId`.
    - Le webhook réutilise la même fonction de service (comme `confirmRegistrationPayment`).
  - Plan/template désactivé entre l'intent et la confirmation : la confirmation refait la validation (`OFFER_NOT_FOUND` 404) — le webhook loggue et n'écrit rien (remboursement manuel, cas marginal accepté).
- Pas de remboursement en ligne, pas de récurrence, pas de renouvellement en ligne (hors périmètre).

### Top du mois

- `GET /api/clubs/:slug/top-month` (public) : top **3** joueurs du club par **victoires sur matchs confirmés** du mois calendaire courant (fuseau club, Luxon). Renvoie `[{ userId, firstName, lastName, avatarUrl, wins }]`. Liste vide si **moins de 3 joueurs** ont au moins 1 victoire dans le mois (la section se masque). Réutilise les données de résultats de matchs existantes (même source que le leaderboard `/parties`).

### Parties ouvertes & sponsors

- **Aucun backend** : `GET /api/clubs/:slug/open-matches` est déjà public ; `GET /api/clubs/:slug/sponsors` existe.

## Frontend

### Nouveaux composants `components/clubhouse/`

- **`PosterMosaic`** (« À l'affiche ») : annonces avec image, non expirées (`validUntil` vs `now`), hors hero épinglé, récentes d'abord, plafond 5 affichées.
  - 1 affiche → pleine largeur ; 2 → côte à côte ; 3+ → bento (la plus récente en grand `grid-row: span 2`, les autres en tuiles).
  - Chip du type sur chaque tuile (Offre / Tournoi / Event — `INFO` sans chip), dégradé de lisibilité en pied avec le titre.
  - Clic → **lightbox plein écran** : image entière (`object-fit: contain`), titre + corps + « En savoir plus → » si `linkUrl`, fermeture Échap / tap hors image / bouton ✕ (pattern feuille existant).
- **`OpenMatchesRail`** : 3 prochaines parties ouvertes à venir (tri chronologique), cartes compactes — heure (fuseau club), fourchette de niveau, places restantes, avatars des inscrits (`colorForSeed`). Clic carte → `/parties/[id]`. Lien « Toutes les parties → » vers `/parties`. Visible de tous (anonyme compris). **Supprime `MatchesForYou`** et la logique `recommendMatches`/`getMyRating` du Club-house.
- **`OffersShowcase`** : cartes tarifs — abonnements (nom, prix/mois, engagement, avantages dérivés : sports couverts, creuses/pleines via `offPeakOnly`, INCLUDED/DISCOUNT, plafonds) et carnets/porte-monnaie (réutilise `packageLabel` de `lib/packages.ts`).
  - `onlinePurchase` → bouton « Souscrire » : feuille de paiement réutilisant **`StripePaymentStep`** (target-agnostic, callbacks `createIntent`/`confirm`) ; succès → confirmation + rafraîchit soldes/abos ; anonyme → `AuthPromptDialog` (`next=/`).
  - Sinon → CTA « Renseignez-vous à l'accueil du club ».
  - Viewer déjà abonné (abonnement actif via `getMyClubSubscriptions`) : les **cartes d'abonnement** sont masquées, les carnets/porte-monnaie restent (consommables, toujours achetables). Section entière masquée s'il ne reste rien à afficher.
- **`ClubPresentationCard`** (teaser) : cover (`coverImageUrl`), extrait de `presentationText` (clampé 3 lignes), 3 miniatures de galerie, « Découvrir le club → » vers `/club`. Masqué si ni présentation ni photos.
- **`TopOfMonth`** : podium 3 joueurs (avatars `Avatar` + `colorForSeed`, nom, nombre de victoires, 🥇🥈🥉).
- **`SponsorMarquee`** : remplace `PartnerOffers`. Rangée de cartes riches (logo sur tuile blanche, nom, `offerText`, chip `offerCode` copiable, « Expire J-x » coral < 48 h via `deadlineCountdown`) en **défilement CSS pur** (piste dupliquée, `@keyframes translateX(-50%)`, durée ∝ nombre de cartes), **pause au survol/touch** (`animation-play-state`), fondu latéral. `pinned` = en tête. `prefers-reduced-motion` → grille statique (pas d'animation). ≤ 2 sponsors → grille statique aussi (pas de boucle ridicule). Clic carte → `linkUrl` ; bouton code = sibling hors de l'ancre (pattern existant). `offerIsActive` réutilisé : offre expirée → carte logo simple dans la rivière.

### Page `/club` (« Le club »)

- Page publique (ajoutée aux chemins publics d'`authGate`), shell habituel avec `ClubNav`. Pas de nouvel onglet dans `ClubNav` (accès par le teaser).
- Sections : cover pleine largeur, présentation complète (paragraphes), **galerie** (grille 2–3 col, lightbox partagée avec `PosterMosaic`), infos pratiques — adresse + bouton « Itinéraire » (lien Google Maps `https://www.google.com/maps/search/?api=1&query=lat,lng`, repli adresse encodée), horaires, téléphone/email cliquables (`tel:`/`mailto:`).

### Admin

- **`/admin/announcements`** : champ URL d'image remplacé par un **upload** (aperçu, remplacement, suppression), sélecteur de type (4 kinds), date « Afficher jusqu'au » (`YYYY-MM-DD`).
- **Nouvelle page `/admin/club`** (« Page club », entrée sidebar) : présentation longue (textarea), horaires, téléphone, email, **galerie** (upload multiple, réordonner par flèches `sortOrder`, légende, suppression avec confirmation, compteur x/12). Cover et description courte restent dans `/admin/settings`.
- **`/admin/settings`** : case « Afficher mes formules (abonnements & carnets) sur le Club-house » → `showOffersPublicly`.

### `lib/`

- `lib/api.ts` : types additifs (`Announcement.kind/validUntil`, `ClubPresentation`, `ClubPhoto`, `PublicOffers`, `TopMonthEntry`) + méthodes (`getClubPresentation`, `getClubOffers`, `getTopOfMonth`, `createOfferIntent`, `confirmOfferPayment`, admin : `adminUploadAnnouncementImage`, `adminGetPresentation`/`adminUpdatePresentation`, `adminAddPhoto`/`adminUpdatePhoto`/`adminDeletePhoto`).
- `lib/clubhouse.ts` étendu (helpers purs testés) : `activePosters(announcements, now)` (image + non expirée + hors hero), `posterLayout(n)` (plein/duo/bento), réutilise `offerIsActive`/`deadlineCountdown`.

## Cas limites & erreurs

- **Achat en ligne** : double-clic/double-webhook → idempotence par `stripePaymentIntentId` (early-return en transaction). Échec Stripe à l'intent → message mappé dans la feuille, rien en base. Paiement réussi mais confirm client interrompu → le webhook crée l'abonnement/carnet (source de vérité).
- **Affiches** : image lourde → refus 413 multer ; annonce expirée → disparaît de la bento au tick de `now` ; annonce épinglée avec image → hero seulement (pas doublée en bento).
- **Galerie** : 13ᵉ photo → `PHOTO_LIMIT_REACHED` affiché ; suppression de fichier échouée → best-effort silencieux.
- **Marquee** : `prefers-reduced-motion` ou ≤ 2 sponsors → statique ; aucune offre active → cartes logos simples.
- **Prod** : fichiers `uploads/announcements/` et `uploads/club-photos/` couverts par le volume `backend_uploads` existant.

## Tests

- **Backend** : annonces (upload, kinds, validUntil), présentation/photos (CRUD, plafond 12, permissions ADMIN), offers publics (opt-in, gating Stripe), achat (création subscription/package à la confirmation, idempotence intent, `OFFER_NOT_FOUND`, `MEMBERSHIP_BLOCKED`), top-month (fuseau, seuil 3 joueurs), routes.
- **Frontend** : `clubhouse.test.ts` (activePosters, posterLayout), `PosterMosaic` (layouts 1/2/3+, lightbox, chips), `OpenMatchesRail`, `OffersShowcase` (vitrine, achat, masquage abonné, AuthPrompt anonyme), `SponsorMarquee` (pause, reduced-motion → statique, code copiable), `TopOfMonth`, `ClubPresentationCard`, page `/club`, admin (`AdminClub`, annonces enrichies), ordre adaptatif de `ClubHouse` (visiteur vs connecté).
- ⚠️ Suites real-mount `ClubNav` : tout nouvel appel `api.*` dans les composants montés doit être mocké (pattern connu).

## Hors périmètre (explicite)

- Prélèvement mensuel récurrent (Stripe Billing), renouvellement et remboursement en ligne des abonnements.
- Mode TV, pouls du club temps réel, météo, affiche QR générée (idées écartées — notées pour plus tard).
- Events/tournois auto-injectés dans la bento (les affiches sont des annonces éditoriales).
- Éditeur WYSIWYG de présentation (texte brut multi-paragraphes en v1), carte interactive embarquée.
- Suppression de la page markdown `/offres` (`ClubPage OFFRES`) : conservée telle quelle, la vitrine structurée vit sur le Club-house.
