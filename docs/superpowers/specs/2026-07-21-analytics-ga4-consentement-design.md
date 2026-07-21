# Google Analytics 4 + bannière de consentement (opt-in strict) — Design

**Date :** 2026-07-21
**Statut :** validé (design), à planifier
**Périmètre :** frontend (majeure) + mises à jour légales back+front (mineure). Aucune migration, aucun endpoint.

## Contexte et intention

Palova veut une **mesure d'audience** de son trafic. Aujourd'hui le site ne dépose que des
traceurs strictement fonctionnels (cookies `token`/`clubId`, préférences localStorage) et la
politique de confidentialité affirme explicitement *« Aucun traceur de mesure d'audience […]
Si cela changeait, un recueil de consentement serait mis en place au préalable. »*

Ajouter Google Analytics **déclenche l'obligation de consentement RGPD/CNIL** : GA dépose des
cookies non essentiels (`_ga`, `_ga_XXX`). On honore donc la clause d'anticipation déjà
inscrite dans la politique : recueil de consentement **préalable**, GA chargé **uniquement**
après un « Accepter » explicite.

## Décisions de cadrage (arbitrées avec Eric)

| Question | Décision |
|----------|----------|
| **Audience** | Toi seul (propriétaire plateforme). **Une seule propriété GA4 globale**, un seul ID, couvrant `palova.fr` + tous les sous-domaines clubs. Aucun accès gérant, aucune fonctionnalité produit par club. |
| **Outil** | **GA4 en direct** (`gtag.js`), pas de conteneur GTM. |
| **Consentement** | **Opt-in strict** : GA ne se charge PAS tant que l'utilisateur n'a pas cliqué « Accepter ». Refus ou ignoré = zéro cookie GA, GA jamais chargé. |
| **Périmètre pages** | **Partout SAUF les back-offices** `/admin/*` et `/superadmin/*` (pages authentifiées de gestion — se tracer soi-même en superadmin, ou coller une bannière cookie au gérant dans son outil de travail, n'a aucune valeur « audience »). Restent tracés, tous hôtes : vitrines publiques, app joueur (`/reserver`, `/me`, `/parties`, `/club`, `/events`…), ainsi que `/login` et `/register` (l'inscription est une conversion d'acquisition utile à mesurer). |

## Architecture

### Composant `AnalyticsConsent` (client)

Nouveau composant client monté **une fois** dans `app/layout.tsx` (global — tous hôtes). Il lit
le chemin courant via `usePathname` : sur un **back-office** (`/admin/*`, `/superadmin/*`) il rend
`null` — ni GA, ni bannière. Partout ailleurs, il lit le cookie de consentement et décide :

- **`granted`** → injecte `gtag.js` (ID `NEXT_PUBLIC_GA_ID`) + init GA4, puis émet les `page_view`.
- **`denied`** → ne charge rien.
- **aucun choix** → rend la **bannière** ; GA reste éteint.

**Garde par variable d'env :** si `NEXT_PUBLIC_GA_ID` est absent (vide), le composant est
**inerte** — ni bannière, ni GA. Conséquences voulues :
- **dev = aucune bannière** (variable non renseignée localement) ;
- feature **dormante** en prod tant que l'ID n'est pas fourni au build.

Même patron de garde que `NEXT_PUBLIC_GLITCHTIP_DSN`.

### Configuration GA4 « mesure d'audience seule »

À l'init : **Google Signals désactivé**, **personnalisation publicitaire désactivée**
(`allow_google_signals: false`, `allow_ad_personalization_signals: false`), IP anonymisée
(comportement par défaut GA4). On reste strictement « analytics », jamais « pub » → posture
CNIL plus nette, pas de catégorie de consentement supplémentaire à gérer.

### Chargement dans Next.js 16

- Injection de `gtag` **après** consentement (script + init).
- **Pages vues SPA** : l'App Router ne recharge pas la page → un hook basé sur `usePathname`
  envoie un `page_view` GA à **chaque navigation cliente**.
- ⚠️ **Next.js 16 diffère des versions connues** (breaking changes Turbopack, API `next/script`,
  `headers()`). Lire `node_modules/next/dist/docs/` avant d'écrire le code d'injection
  (rappel `frontend/AGENTS.md`).

## Consentement — stockage et portée

- Cookie **`palova_consent`** : valeur `granted` | `denied` + un numéro de **version**.
- Posé avec **`domain=.palova.fr`** en réutilisant la logique de domaine existante de
  `lib/session.ts` (`cookieDomainAttr`) → **consenti une seule fois, valable sur tous les
  sous-domaines** : le joueur qui accepte sur `palova.fr` ne re-consent pas sur
  `son-club.palova.fr`.
- En **dev** (`*.localhost`), le cookie est par-hôte (limitation Chrome déjà connue et documentée
  pour la session) — sans impact fonctionnel.
- Le cookie de consentement est lui-même **strictement fonctionnel** → exempté de consentement.
- **Versionné** : si un jour GA collecte autre chose, on bumpe la version du consentement → la
  bannière réapparaît pour re-recueillir le choix.

## Bannière — conformité CNIL (non négociable)

- **Bandeau bas d'écran, non bloquant** : on peut continuer à naviguer sans choisir → GA reste
  éteint (cohérent avec l'opt-in strict). Naviguer ne vaut **pas** consentement.
- **Deux boutons d'égale importance** : « Accepter » et « Refuser » (CNIL : refuser doit être
  aussi simple qu'accepter — même taille, même proéminence, pas de dark pattern).
- Lien discret « En savoir plus » → `/confidentialite`.
- **Pas de case pré-cochée.**
- **Retrait aussi simple que l'octroi** : bouton **« Gérer les cookies »** ajouté au `Footer`
  (global). Il rouvre la bannière ; changer d'avis efface/repose le cookie et (dé)charge GA en
  conséquence. (Le Footer est masqué sur `/admin`/`/superadmin` — précisément les pages où GA
  n'est de toute façon pas actif — et sur `/login`/`/register` ; le point de retrait reste
  accessible depuis toute page publique et l'app joueur, ce qui suffit.)
- **Style** : tokens du design system (`th.*`), thème club respecté sur sous-domaine. **Pas de
  panneau sombre** (préférence Eric).

## Mises à jour légales

- **`frontend/lib/platformContent.ts`** + **`backend/src/content/legalVersions.ts`** : section
  **Cookies** réécrite —
  - GA4 = cookie de **mesure d'audience soumis au consentement (opt-in)** ;
  - lister `_ga` / `_ga_<id>` avec rétention (13 mois) + le cookie de consentement `palova_consent` ;
  - **retirer** les phrases « Aucun traceur de mesure d'audience » / « aucun bandeau ».
- **Google ajouté aux sous-traitants** dans la Confidentialité **et** l'annexe DPA (Google
  Ireland Ltd / Google LLC, finalité mesure d'audience, transfert encadré — Data Privacy
  Framework). Même geste que l'ajout de GlitchTip.
- **Bump `LEGAL_VERSIONS` (document PRIVACY)** back **et** front → les comptes existants revoient
  le bandeau « politique mise à jour » (`LegalUpdateBanner`) et ré-accusent réception. Cohérent :
  la politique cookies a matériellement changé.

## Configuration & prérequis

- **`NEXT_PUBLIC_GA_ID`** ajouté en **build-arg frontend** : `docker-compose.prod.yml`,
  `.env.prod.example`, `render.yaml`. Gelé au build (comme la clé Stripe publique et le DSN
  GlitchTip) → un changement d'ID impose un rebuild du front.
- **Prérequis manuel (Eric, hors code)** : créer la propriété GA4 sur analytics.google.com,
  récupérer le `G-XXXXXXXX`, le renseigner dans l'environnement de build. Sans ID, rien ne
  s'affiche et rien n'est tracé.

## Backend

Aucune migration, aucun nouvel endpoint. **Seule touche** : bump de la version PRIVACY dans
`backend/src/content/legalVersions.ts` + texte du sous-traitant Google (Confidentialité + DPA).

## Tests

- **Purs** (`frontend/lib/consent.ts`) : lecture/écriture du cookie `palova_consent`, décision
  « GA doit-il charger ? » selon la valeur, comparaison de version (bannière réaffichée si version
  périmée), garde ID absent.
- **Composant** (`AnalyticsConsent`) : bannière rendue si aucun choix ; « Accepter » → `gtag`
  chargé (mock) + cookie `granted` ; « Refuser » → aucun `gtag`, cookie `denied` ; `NEXT_PUBLIC_GA_ID`
  absent → composant inerte (ni bannière ni script) ; sur `/admin` et `/superadmin` → rend `null`
  (ni GA ni bannière) même consentement accordé ; « Gérer les cookies » du Footer rouvre la
  bannière.
- **Aucun appel réseau réel à Google** — `gtag`/l'injection de script sont mockés.

## Hors périmètre (YAGNI)

- Google Tag Manager (conteneur).
- Consent Mode v2 (pings anonymisés par défaut).
- Propriété/flux GA par club, tableau de bord analytics pour les gérants.
- Pixel Meta, conversions Google Ads, tout tag publicitaire.
- Catégories de cookies fines (un seul interrupteur « mesure d'audience » — on n'a que GA).
- Traçage d'événements métier custom (clics, conversions internes) — v1 = pages vues seules.
