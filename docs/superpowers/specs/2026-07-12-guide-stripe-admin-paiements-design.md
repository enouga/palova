# Guide « Comment activer le paiement en ligne ? » sur /admin/payments

## Contexte

La page admin **Paiement en ligne** (`/admin/payments`) permet de connecter un compte Stripe (Connect
**Express**) mais n'expliquait nulle part la procédure au gérant : quels documents préparer, ce qui se
passe au clic sur « Connecter mon compte Stripe », comment vérifier que ça marche, comment tester. Eric a
demandé une procédure complète mais simple — création du compte, association au club, tests — intégrée à
cette page, avec des liens vers la doc officielle Stripe en français.

Point clé qui simplifie la procédure : avec Connect Express, **le gérant n'a pas besoin de créer un compte
sur stripe.com au préalable**. Le bouton « Connecter mon compte Stripe » crée le compte Express et ouvre
directement le formulaire d'onboarding hébergé par Stripe (localisé en français). Le guide dit donc
« préparez vos documents, cliquez, remplissez » — pas « allez créer un compte sur stripe.com ».

**100 % frontend — aucun backend, aucune migration, aucune route.** Le guide se pilote avec le
`stripeAccountStatus` déjà chargé par la page (`NONE | PENDING | RESTRICTED | ACTIVE`).

## Décisions

- **Format** : guide intégré directement sur `/admin/payments`, visible par tous les gérants (pas de
  sous-page séparée).
- **Ouverture par défaut** : ouvert tant que le statut n'est pas `ACTIVE` (le gérant doit le voir), replié
  une fois le compte actif (il ne gêne plus, reste accessible en un clic).
- **Tests** : un seul encart, *En conditions réelles (recommandé)* — réserver un créneau en tant que
  joueur, payer par CB (vraie carte, petit montant), vérifier l'encaissement dans **Paiements** et sur le
  tableau de bord Stripe, puis rembourser. Le volet « Environnement de test (développeurs) » (carte
  `4242 4242 4242 4242`) a été retiré à la demande d'Eric — pas pertinent pour un gérant en production.
- **Liens externes** : uniquement la documentation officielle Stripe en français (`?locale=fr-FR`), pas de
  vidéos tierces (parcours différent de l'onboarding Express intégré, risque de confusion).

## Implémentation

- `frontend/lib/stripeGuide.ts` — helpers purs : `GUIDE_STEPS` (4 étapes), `stripeGuideStates(status)`
  (mappe le statut Stripe sur l'état visuel `done/current/todo` de chaque étape), `STRIPE_DOC_LINKS`.
- `frontend/components/admin/StripeSetupGuide.tsx` — carte accordéon (pattern `AccordionItem` de
  `FaqView.tsx`), étapes numérotées avec pastille d'état, encart de test, liens de pied de carte.
  Composant purement présentational (aucun fetch).
- `frontend/app/admin/payments/page.tsx` — rendu de `<StripeSetupGuide status={status} />` juste après la
  carte de statut, avant la carte « Changer de compte Stripe ».

## Tests

- `frontend/__tests__/stripeGuide.test.ts` — états par statut, contenu des 4 étapes, liens `fr-FR`.
- `frontend/__tests__/StripeSetupGuide.test.tsx` — ouverture par défaut selon le statut, toggle au clic,
  étapes rendues, encart de test présent (et le volet développeurs absent), liens externes corrects.
- `frontend/__tests__/AdminPayments.test.tsx` — le guide apparaît sur la page réelle (cas NONE ouvert, cas
  ACTIVE replié).

## Hors périmètre

- Aucun changement backend (pas de toggle test/live exposé, pas de nouvelle route).
- Pas de vidéos tierces, pas de captures d'écran embarquées.
- Pas de guide côté joueur ni d'email.
