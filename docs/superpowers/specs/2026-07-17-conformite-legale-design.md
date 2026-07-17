# Conformité légale — mentions, CGU/CGV, RGPD, acceptations (design)

**Date** : 2026-07-17 · **Statut** : validé par Eric (brainstorming section par section)

> ⚠️ **Avertissement** : les textes légaux décrits et rédigés dans le cadre de ce chantier sont des
> **modèles sérieux mais ne constituent pas un conseil juridique**. Ils doivent être **relus par un
> avocat** avant l'ouverture publique. La spec liste les points de vigilance, elle ne remplace pas
> cette relecture.

## 1. Contexte & objectif

Palova est un SaaS multi-tenant : la plateforme (`palova.fr`) est opérée par **Tolaris Studio**
(société **en cours d'immatriculation**, SIRET non encore attribué) ; chaque club dispose de son
propre site sur un sous-domaine et y vend ses prestations (réservations, tournois, offres) via son
propre compte Stripe — Palova n'est pas partie à ces transactions.

L'audit fonctionnel du 2026-07-17 classe les mentions légales `[à compléter]` en **P0 avant
ouverture publique**. Ce chantier couvre tout le socle légal : mentions légales, CGU, CGV,
politique de confidentialité, preuves d'acceptation, médiation de la consommation, désinscription
des emails de diffusion, export de données RGPD.

**Modèle juridique à deux étages** (calqué sur les SaaS multi-tenant type Shopify) :
- **Étage plateforme** — éditeur : Tolaris Studio. Documents versionnés dans le code.
- **Étage club** — chaque club est éditeur de son contenu et responsable de traitement des données
  de ses membres ; Palova est son sous-traitant (art. 28 RGPD). L'infra existante `ClubPage` +
  « Contenu & mentions » est **conservée et complétée**, pas refaite.

## 2. Existant (vérifié en code)

| Brique | État |
|---|---|
| `ClubPage` (CGV / MENTIONS_LEGALES / CONFIDENTIALITE / OFFRES), publiées ou non, `@@unique([clubId, kind])` | ✅ `backend/prisma/schema.prisma`, migration `20260616160000_add_club_content_pages` |
| Modèles Palova pré-remplis avec les données du club | ✅ `backend/src/content/clubPageTemplates.ts` |
| Coordonnées légales club (`legalEntityName`, `legalForm`, `siret`, `vatNumber`, `legalRepresentative`, `legalEmail`, `legalPhone`) | ✅ mêmes migrations ; formulaire dans `/admin/pages` |
| Admin « Contenu & mentions » (coordonnées + éditeur markdown + FAQ), gaté ADMIN | ✅ `frontend/app/admin/pages/page.tsx` |
| FAQ club = socle Palova + questions du club | ✅ `clubPage.service.ts` (`getPublicFaq`) |
| Pages publiques `/cgv`, `/mentions-legales`, `/confidentialite`, `/offres`, `/faq` host-aware | ✅ `ClubPageView` / `ContentShell` / `FaqView` |
| Footer avec liens légaux (contextes club et plateforme) | ✅ `frontend/components/Footer.tsx` |
| Trace CGV à la réservation payée par carte (`Reservation.cgvAcceptedAt`, gate `CGV_NOT_ACCEPTED`) | ✅ `reservation.service.ts` (~l.476-480), migration `20260622120000` |
| Mémoire locale de pré-cochage CGV par club | ✅ `frontend/lib/cgv.ts` |
| Suppression de compte RGPD (anonymisation + garde OWNER + annulation résas futures) | ✅ `account.service.ts`, `DELETE /api/me` |
| Cookies : uniquement fonctionnels (`token`, `clubId`, SameSite=Lax, Secure) — aucun analytics/traceur | ✅ `frontend/lib/session.ts` ; aucun script tiers dans `app/layout.tsx` |
| Signalement + modération des chats (club et plateforme) | ✅ chantier 2026-07-14 |
| Garde SIRET à la création de club (Luhn + API recherche-entreprises) | ✅ merge `ad73ce1` |

## 3. Trous constatés (vérifiés en code)

1. **Inscription joueur sans acceptation** : `/register` n'a ni case ni mention CGU/confidentialité ;
   aucune colonne d'acceptation sur `User` (`frontend/app/register/page.tsx`, `backend/src/routes/auth.ts`).
2. **Création de club sans contrat** : `/clubs/new` envoie `createClub` sans aucun flag d'acceptation
   des CGV Palova ; le paragraphe « ce compte gère l'abonnement » est purement informatif.
3. **Textes plateforme squelettiques** : `frontend/lib/platformContent.ts` — mentions légales
   `[à compléter]` partout, CGU et CGV fusionnées en un document hybride, politique de
   confidentialité sans bases légales ni durées de conservation, pas d'annexe sous-traitance (DPA).
4. **CGV club tracées uniquement si carte** : inscriptions tournois/events payées en ligne et achats
   d'offres passent par Stripe **sans case CGV ni trace**.
5. **Pas de médiateur de la consommation** : le modèle CGV club évoque « un médiateur » sans le
   nommer ; aucun champ pour le renseigner. Obligation B2C du club (art. L612-1 code conso).
6. **Broadcasts club sans désinscription** : pied d'email = « Gérer mes notifications » (nécessite
   connexion) ; pas de lien de désabonnement en un clic (exigé pour la prospection, L34-5 CPCE).
7. **Pas d'export de données** (portabilité, art. 20 RGPD).
8. **Site club sans pages légales tant que le club n'a rien publié** : `getPublicPage` renvoie 404
   si non publiée → un site club en ligne peut n'avoir AUCUNE mention légale.

## 4. Design

### 4.1 Corpus documentaire plateforme (4 documents, dans le code)

Les documents restent dans `frontend/lib/platformContent.ts` (faible fréquence de changement, git =
piste d'audit des versions). Décision explicite : **pas d'éditeur superadmin** (YAGNI).

| Document | Page | Contenu (plan de sections) |
|---|---|---|
| **Mentions légales** | `/mentions-legales` | Éditeur : Tolaris Studio, « société en cours d'immatriculation au RCS de [ville] » ; forme juridique, capital, SIRET, siège, téléphone = placeholders `[à compléter]` en **liste fermée** (cf. §8) ; directeur de la publication : Eric Nougayrède ; hébergeur Hetzner (complet : raison sociale, adresse, téléphone) ; contact ; propriété intellectuelle |
| **CGU** *(nouvelle page `/cgu`)* | `/cgu` | Contrat joueur ↔ Palova : objet ; compte (exactitude, sécurité du mot de passe) ; **âge minimum 15 ans ou accord parental** ; comportement (chats, annonces) ; signalement & modération (adosse les mécanismes déjà codés) ; suspension/résiliation de compte ; le club reste le vendeur des prestations (renvoi CGV du club) ; propriété intellectuelle ; responsabilité/disponibilité ; données personnelles (renvoi) ; droit applicable |
| **CGV SaaS** | `/cgv` (hôte plateforme) | Contrat club ↔ Tolaris Studio : objet ; description du service ; abonnement aux paliers de membres actifs (renvoi `/tarifs`) ; facturation (Stripe Billing, mensuel/annuel, HT + TVA) ; mentions B2B obligatoires (pénalités de retard, indemnité forfaitaire 40 €) ; obligations du club (exactitude des infos légales, publication de ses pages, médiation conso, licéité de ses contenus) ; encaissement via Stripe Connect (Palova non partie) ; disponibilité/SLA raisonnable ; résiliation ; **Annexe : accord de sous-traitance des données (DPA, art. 28 RGPD)** — objet et durée, nature/finalités, catégories de données et de personnes, obligations du sous-traitant (sécurité, confidentialité, sous-traitance ultérieure : Hetzner/Stripe/OVH, assistance, notification de violation, sort des données en fin de contrat, audit) |
| **Confidentialité** | `/confidentialite` | Réécriture complète : **double casquette** (Tolaris responsable de traitement pour les comptes plateforme ; sous-traitant des clubs pour les données membres) ; tableau finalités × bases légales × durées de conservation ; destinataires/sous-traitants (Hetzner, Stripe, OVH SMTP) ; transferts hors UE (Stripe — clauses contractuelles types) ; droits + saisine CNIL ; **section Cookies exhaustive** : cookies `token`/`clubId` (fonctionnels, 7 j) + usages localStorage fonctionnels → **pas de bandeau** (exemption CNIL, aucun traceur) — décision assumée, documentée ; export de données (§4.6) et suppression de compte documentés |

Chaque document affiche en tête « Version du {date} » (miroir de `LEGAL_VERSIONS`, cf. §4.3).

**Footer** : contexte plateforme = ajouter « CGU » ; contexte club = ajouter un lien discret
« CGU Palova » (le joueur d'un sous-domaine est aussi utilisateur de la plateforme) → pointe vers
`https://{CANONICAL_ROOT}/cgu`.

### 4.2 Étage club : renforts (infra conservée)

- **Médiation de la consommation** : 2 champs `Club.mediatorName` / `Club.mediatorUrl`
  (migration additive), 2 lignes dans le formulaire « Coordonnées légales » de `/admin/pages`
  (placeholder pédagogique : « ex. CM2C, Médiation de la consommation... — obligation légale pour
  la vente aux particuliers »). Injectés dans le modèle CGV : « Le consommateur peut saisir
  gratuitement {médiateur} : {site} » (repli `[à compléter]` sinon).
- **Modèles enrichis** (`clubPageTemplates.ts`) : CGV club — médiateur nommé, renvoi explicite aux
  CGU Palova, rappel que la politique d'annulation applicable est celle affichée à la réservation,
  clause « toute réservation (y compris au comptoir) implique l'adhésion aux CGV affichées » ;
  confidentialité club — Palova sous-traitant, renvoi politique plateforme pour la part « compte ».
- **Repli légal permanent (corrige le trou n°8)** : pour les 3 kinds légaux (`CGV`,
  `MENTIONS_LEGALES`, `CONFIDENTIALITE`), la route publique `GET /:slug/pages/:kind` renvoie,
  quand aucune page publiée n'existe, **le modèle Palova rendu à la volée** avec les coordonnées
  du club (flag `isFallback: true` dans la réponse ; `OFFRES` garde son 404). Le front affiche un
  bandeau discret « Document type fourni par Palova — le club peut le personnaliser ». Un site
  club a donc TOUJOURS des pages légales opposables. La publication par le club remplace le repli.
- **Guide de démarrage** : nouveau jalon « Infos légales » dans `StartChecklist`, réputé fait
  quand les coordonnées légales clés sont remplies (`legalEntityName`, `siret`, `legalEmail`,
  `mediatorName`) — la publication des pages reste facultative grâce au repli ; lien vers
  `/admin/pages`.
- **Bannière `/admin`** : un club dont Stripe Connect est ACTIVE et dont la page CGV n'est ni
  publiée ni complète (coordonnées légales vides) voit une bannière persistante « Complétez vos
  informations légales » (pattern `BillingBanner`). Pas de blocage dur (décision Eric, §sec. 3).

### 4.3 Preuves d'acceptation & versionnage

**Nouvelle table `LegalAcceptance`** (migration additive, historique en ajout seul — jamais d'update) :

```prisma
enum LegalDocument { CGU  CGV_SAAS  PRIVACY }

model LegalAcceptance {
  id         String        @id @default(cuid())
  userId     String        // FK User, onDelete: Cascade
  clubId     String?       // renseigné pour CGV_SAAS (le club qui contracte)
  document   LegalDocument
  version    String        // ex. "2026-07-17"
  context    String        // 'register' | 'club_create' | 'update_banner'
  acceptedAt DateTime      @default(now())
  @@index([userId, document])
}
```

**Versions courantes dans le code** : constante partagée backend
`LEGAL_VERSIONS: Record<LegalDocument, string>` (module `backend/src/content/legalVersions.ts`),
miroir front (affichage « Version du… » + comparaison bandeau). Convention : version = date ISO du
jour de mise en vigueur ; toute modification substantielle d'un document = bump de la version.

**Points de collecte** :
1. **Inscription joueur** (`/register`) : case unique obligatoire « J'accepte les [CGU] et la
   [politique de confidentialité] » (liens nouvel onglet). `POST /api/auth/register` exige
   `acceptTerms: true` → sinon **400 `CGU_NOT_ACCEPTED`** ; à la **création du compte** (même non
   vérifié), écrit 2 lignes (`CGU` + `PRIVACY`, context `register`).
2. **Création de club** (`/clubs/new`) : case « J'accepte les [CGV Palova], incluant l'annexe de
   sous-traitance des données ». `POST /api/clubs` exige `acceptSaasTerms: true` → sinon
   **400 `CGV_NOT_ACCEPTED`** ; écrit une ligne `CGV_SAAS` (context `club_create`, `clubId` du club
   créé, portée par le compte gérant) — dans la transaction de création.
3. **Bandeau d'évolution** : `GET /api/me/profile` expose un champ additif
   `legal: { cgu: { accepted: string|null, current: string }, privacy: {...}, cgvSaas?: {...} }`
   (`cgvSaas` seulement si l'utilisateur est OWNER d'au moins un club ; `accepted` = version max
   acceptée). Le front compare : écart → **bandeau non bloquant** « Nos conditions ont évolué —
   [Voir] · [J'ai compris] » ; « J'ai compris » → `POST /api/me/legal/accept { document }` (écrit
   la version courante, context `update_banner`). Pour le gérant, même bandeau dans `/admin` pour
   `CGV_SAAS`. Bandeau réaffiché à chaque session tant que non actée (non bloquant).

**Comptes existants** : **aucun backfill** (on n'invente pas une preuve). Ils verront le bandeau au
prochain passage — première trace propre.

### 4.4 Acceptation des CGV du club sur tout le parcours d'achat en ligne

Pattern conservé : **une colonne d'horodatage sur l'objet de la transaction** (pas de table
centrale — la preuve vit avec la transaction, comme `Reservation.cgvAcceptedAt`).

| Parcours | Colonne (migration additive) | Gate serveur | Case UI |
|---|---|---|---|
| Inscription tournoi payée en ligne | `TournamentRegistration.cgvAcceptedAt` | à la création du PaymentIntent/SetupIntent d'inscription | parcours paiement de `/tournois/[id]` |
| Inscription event payée en ligne | `EventRegistration.cgvAcceptedAt` | idem | `/events/[id]` |
| Achat d'offre en ligne (abo/carnet/porte-monnaie) | `Payment.cgvAcceptedAt` | `POST /:slug/offers/.../intent` | modale de souscription `OffersShowcase` |

- Règle uniforme : case obligatoire dès qu'un paiement CB en ligne est en jeu, refus serveur
  **`CGV_NOT_ACCEPTED`** sinon (sémantique identique à `confirmReservation`).
- La case vit dans le **`StripePaymentStep` partagé** (une seule implémentation, prop de lien vers
  les CGV du club) ; `lib/cgv.ts` (pré-cochage local par club) réutilisé tel quel.
- Le lien de la case pointe vers `/cgv` du club — toujours opposable grâce au repli §4.2.
- **Pas de case** pour les règlements comptoir/carnet/porte-monnaie/abonnement (décision assumée :
  l'affichage au club fait foi ; la clause « toute réservation implique l'adhésion » du modèle CGV
  couvre ces cas).

### 4.5 Désinscription des emails de diffusion (broadcasts club)

- **Lien signé sans connexion** en pied de chaque email de **diffusion** (broadcast club) :
  « Se désabonner des communications de {club} » → `GET /api/unsubscribe?token=…`.
- Token = **HMAC-SHA256** (`userId|clubId|catégorie`, secret serveur dédié `UNSUBSCRIBE_SECRET`,
  repli dev sur JWT_SECRET), **sans expiration** (un désabonnement doit toujours marcher),
  endpoint **idempotent**, page HTML minimale de confirmation « Vous êtes désinscrit des
  communications de {club} · [Se réinscrire] » (le lien de réinscription refait un POST signé).
- L'opt-out s'écrit sur la **préférence de notification email existante** de la catégorie des
  broadcasts ; si les broadcasts ne passent pas aujourd'hui par une catégorie opt-outable,
  créer la valeur d'enum `NotificationCategory` idoine (défaut ON) — à vérifier au plan.
- Le composeur de broadcast (`/admin`) **exclut les désinscrits** et son compteur de destinataires
  en tient compte.
- Les emails **transactionnels ne changent pas** (pas de lien de désabonnement ; « Gérer mes
  notifications » reste).

### 4.6 Export de données (portabilité, art. 20 RGPD)

- `/me/profile`, onglet **Sécurité** : bouton « Télécharger mes données » → `GET /api/me/export`
  (auth Bearer), réponse **JSON synchrone** (`Content-Disposition: attachment`).
- Contenu : profil, adhésions clubs, réservations, inscriptions tournois/events/cours, paiements
  (les siens), matchs + historique de niveau, amis/favoris/demandes, **ses propres messages
  envoyés uniquement** (jamais ceux des autres — données de tiers), préférences de notification,
  acceptations légales. Avatar = URL incluse (pas de fichiers/ZIP en v1).
- **Rate-limit 1/heure** via `assertRateLimit` existant (`rateLimit.ts`).
- La politique de confidentialité documente le bouton + le canal manuel `contact@palova.fr` pour
  toute demande hors périmètre.

## 5. Modèle de données — récapitulatif des migrations

Toutes **additives** ; DEV via `prisma db execute` du SQL (dérive de base connue — jamais
`db push`/`migrate dev`), prod `migrate deploy`.

1. `add_legal_acceptances` : enum `LegalDocument` + table `legal_acceptances`.
2. `add_cgv_accepted_columns` : `TournamentRegistration.cgvAcceptedAt`,
   `EventRegistration.cgvAcceptedAt`, `Payment.cgvAcceptedAt` (tous `DateTime?`).
3. `add_club_mediator` : `Club.mediatorName`, `Club.mediatorUrl` (`String?`).
4. (si nécessaire, cf. §4.5) valeur d'enum `NotificationCategory` pour les broadcasts.

## 6. Sécurité & confidentialité

- Tokens de désinscription : HMAC comparé en temps constant, aucun identifiant en clair dans l'URL
  au-delà du nécessaire, endpoint sans effet autre que l'opt-out/opt-in de la catégorie visée.
- Export : uniquement les données du demandeur ; les messages des tiers, `userId` internes de tiers
  et données admin n'y figurent jamais ; rate-limité.
- Acceptations : lignes immuables (insert-only), pas d'API de suppression/modification.
- Repli template public : rendu markdown → même pipeline `Markdown` que les pages publiées
  (aucune injection possible de plus qu'aujourd'hui).

## 7. Tests

**Backend** : service `legalAcceptance` (écritures register/club_create/banner, versions) ; gates
400 `CGU_NOT_ACCEPTED`/`CGV_NOT_ACCEPTED` sur register, createClub, intents tournoi/event/offre ;
repli template de `GET /:slug/pages/:kind` (3 kinds légaux vs OFFRES 404) ; endpoint unsubscribe
(idempotence, token invalide, réinscription) ; export (contenu scopé, rate-limit) ; médiateur dans
le modèle CGV rendu.
**Frontend** : case + refus sans case sur `/register` et `/clubs/new` ; bandeau d'évolution
(affiché sur écart de version, « J'ai compris » appelle l'API) ; case CGV dans `StripePaymentStep`
(tournoi, event, offre) ; bouton export dans l'onglet Sécurité ; liens footer (CGU plateforme,
CGU Palova côté club) ; page `/cgu` ; bandeau « document type » sur une page en repli ;
formulaire médiateur dans `/admin/pages` ; jalon checklist.

## 8. Checklist opérationnelle (actions d'Eric, hors code)

1. **Au Kbis** : remplir la liste fermée des placeholders (forme juridique, capital, RCS + ville,
   SIRET, adresse du siège, téléphone) dans `platformContent.ts` + bump des versions concernées.
2. **Stripe** : renseigner l'identité complète de Tolaris Studio dans le dashboard (les factures
   SaaS émises par Stripe Billing doivent porter SIREN/TVA/adresse).
3. **Clubs** : chaque club doit adhérer à un dispositif de médiation de la consommation (ex. CM2C)
   — obligation du club ; le produit fournit les champs (§4.2).
4. **Avocat** : faire relire les 4 documents plateforme + les modèles club avant ouverture.
5. **SMTP** : (rappel audit P0 n°2) sans SMTP prod, l'email de désinscription/broadcast est théorique.

## 9. Hors périmètre (parqué)

- **Bandeau cookies** — uniquement si un analytics à cookies arrive un jour (aujourd'hui : aucun
  traceur, exemption CNIL documentée).
- **Génération de factures conformes** par le produit (le reçu « non-facture » actuel reste).
- **Effacement dur RGPD** au-delà de l'anonymisation actuelle.
- **Accessibilité EAA/RGAA** (micro-entreprises exemptées ; bonne pratique continue par ailleurs).
- **Registre des traitements** (art. 30) — document interne Tolaris, pas du code.
- **Ré-acceptation bloquante** (modal) — le bandeau non bloquant est la v1 ; durcissable plus tard.
- **Localisation des documents** (ES/EN) — chantier i18n global.
