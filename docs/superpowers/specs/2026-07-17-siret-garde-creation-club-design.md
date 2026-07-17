# Garde SIRET à la création de club + détection des clubs fantômes — Design

> Spec validée le 2026-07-17 (brainstorming Eric × Claude).
> Contexte stratégique : `docs/strategie-anti-clonage-valorisation.md` — protéger le back-office
> du « tourisme concurrent » **sans sacrifier l'autonomie du club** (le libre-service est la
> stratégie produit ; on passe de la *prévention* à l'*identification + détection*).

## Problème

Aujourd'hui, n'importe qui crée un club en 2 minutes via `/clubs/new` (nom + ville + sport,
aucune identification) et se promène dans tout le back-office admin pour copier écrans et
workflows. On veut que ce visiteur doive **révéler son identité légale** (SIRET → société
visible sur Pappers), qu'Eric soit **notifié de chaque création**, et que les clubs bidons
soient **nettoyés automatiquement** — le tout sans ajouter de validation manuelle ni de
friction réelle pour un vrai club (30 secondes : tout gérant connaît son SIRET).

## Décisions de cadrage (actées par Eric)

| # | Décision | Choix |
|---|---|---|
| 1 | Périmètre | **Les 3 briques** : SIRET vérifié à la création + email « Nouveau club » aux superadmins + ménage automatique des clubs fantômes. (La purge des comptes démo seedés en prod est une **opération manuelle séparée**, hors spec.) |
| 2 | Comportement SIRET | **Bloquant souple** : format (Luhn) toujours vérifié en local ; l'API d'État confirme — inexistant ou fermé → refus clair ; **API indisponible → le club se crée quand même**, marqué « non vérifié » dans la notif. Un vrai club n'est jamais bloqué par une panne extérieure. |
| 3 | Clubs fantômes | Critère = **0 terrain créé** (un vrai club en crée dès le wizard). **Relance J+15, suspension automatique J+30**, réactivable en un clic par le superadmin (et alors plus jamais re-suspendu). |
| 4 | Téléphone gérant | **Obligatoire** dans `/clubs/new` — signal anti-tourisme + canal commercial de rappel (« premiers clubs main dans la main »). |
| 5 | Architecture vérification | **Synchrone** dans `createClub`, appel réseau **hors transaction**, miroir exact du géocodage BAN (`geo.service.ts`). Pas d'état intermédiaire ni de job de vérification. |
| 6 | Numéro FFT | **Écarté** : l'affiliation FFT est réservée aux associations, l'« habilitation » des structures privées est optionnelle, et il n'existe aucune API publique de vérification. Aucun champ. |

## 1. Modèle de données — migration additive `add_club_siret_guard`

Cinq colonnes sur `Club`, toutes nullables (zéro impact sur l'existant) :

```prisma
siret               String?   @map("siret")                  // 14 chiffres ; null = club pré-feature ou créé par superadmin sans SIRET
siretVerifiedAt     DateTime? @map("siret_verified_at")      // confirmation API d'État ; null = non vérifié (panne API à la création)
siretLegalName      String?   @map("siret_legal_name")       // raison sociale renvoyée par l'API (comparaison avec le nom déclaré)
setupReminderSentAt DateTime? @map("setup_reminder_sent_at") // relance J+15 envoyée (jamais deux fois)
autoSuspendedAt     DateTime? @map("auto_suspended_at")      // suspension auto J+30 faite (jamais deux fois, même après réactivation)
```

Application : DEV via `prisma db execute` du SQL additif (dérive de base connue — jamais
`db push`/`migrate dev`), prod via `prisma migrate deploy` (dossier de migration horodaté).

## 2. Backend — `backend/src/services/siret.service.ts` (miroir de `geo.service.ts`)

- **`siretIsValidFormat(siret: string): boolean`** — pur, hors réseau : exactement 14 chiffres
  + clé de Luhn valide. Cas particulier connu et **non géré** : les SIRET de La Poste
  (356 000 000 xxxxx) ne respectent pas Luhn — un club de padel n'est pas La Poste.
- **`checkSiret(siret: string): Promise<SiretCheck | null>`** — GET
  `https://recherche-entreprises.api.gouv.fr/search?q=<siret>` (API publique gratuite, sans
  clé), timeout 5 s, **ne throw jamais** : renvoie
  `{ exists: boolean; active: boolean; legalName: string | null; city: string | null }`
  ou `null` si l'API est injoignable/en erreur. `active` = état administratif « A » de
  l'établissement correspondant. Seule porte vers l'API : swappable (API Sirene INSEE…)
  sans toucher au reste du code.

### `createClub` (self-service, `POST /api/clubs`)

Nouveaux champs body : **`siret` (requis)**, **`ownerPhone` (requis)**.

Ordre des gardes (avant la transaction existante, à côté du géocodage BAN) :

1. `siret` absent ou format invalide → **`SIRET_INVALID` 400**.
2. `ownerPhone` absent/vide → **`VALIDATION_ERROR` 400**.
3. `checkSiret()` :
   - `exists === false` → **`SIRET_NOT_FOUND` 400** ;
   - `active === false` → **`SIRET_INACTIVE` 400** ;
   - `null` (API en panne) → **on continue**, `siretVerifiedAt` reste null ;
   - OK → `siretVerifiedAt = now`, `siretLegalName` persisté.
4. Transaction existante inchangée, enrichie : écrit `siret`/`siretVerifiedAt`/`siretLegalName`
   sur le club, **`User.phone = ownerPhone`** (champ existant, déjà exigé pour les tournois)
   et pré-remplit **`Club.contactPhone = ownerPhone`**.
5. **Après commit** : notification superadmin (§3), best-effort.

Aucune contrainte d'unicité sur `siret` : une même société peut légitimement ouvrir
plusieurs clubs (multi-établissements, franchises).

### Route superadmin (`POST /api/platform/clubs`)

`siret` **optionnel** (Eric crée à la main, il a déjà vérifié qui il a au téléphone).
S'il est fourni : format vérifié (`SIRET_INVALID` 400), appel API **best-effort** pour
stocker `siretLegalName`/`siretVerifiedAt`, **jamais bloquant** (ni NOT_FOUND ni INACTIVE —
le superadmin est souverain). Pas de notification (il est déjà au courant).

## 3. Email « Nouveau club » aux superadmins

- Déclenché **après commit** de `createClub` self-service, **best-effort** (pattern
  `safeNotify` : un échec SMTP n'annule jamais la création).
- Destinataires : tous les `User.isSuperAdmin && deletedAt: null` (pattern exact de
  `moderation.service.ts`).
- Contenu : nom du club + URL sous-domaine, ville, gérant (nom, email, **téléphone**),
  SIRET + raison sociale API + badge **« ✓ vérifié » / « ⚠ non vérifié (API indisponible) »**,
  lien `/superadmin/clubs`.
- Identité visuelle **Palova** (builders purs dans `src/email/templates/`, pattern
  `moderation.ts`/`billingEmails.ts`). **Pas** un type personnalisable de `/admin/emails`
  (email plateforme, pas club).

## 4. Ménage des clubs fantômes — job nocturne

Nouveau cron nocturne (fichier `backend/src/jobs/clubJanitor.job.ts`, planifié vers 04:15
Europe/Paris, à côté des jobs existants). Chaque nuit :

- **Cible** : `status: ACTIVE` **et** `siret != null` **et** aucun `Resource`.
  Conséquences du garde `siret != null` :
  - les clubs **pré-feature** et ceux **créés par superadmin sans SIRET** ne sont jamais touchés ;
  - un vrai club sort du viseur dès son **premier terrain** (créé dès le wizard d'onboarding).
- **Relance J+15** : `createdAt < now − 15 j` et `setupReminderSentAt == null` →
  email au gérant (OWNER) « Besoin d'aide pour démarrer ? » (ton accompagnement, pas menace)
  + `setupReminderSentAt = now`.
- **Suspension J+30** : `createdAt < now − 30 j`, `setupReminderSentAt < now − 7 j`
  (garantit toujours ≥ 7 jours entre relance et suspension, même si le job est resté
  éteint plusieurs semaines), `autoSuspendedAt == null` → `status = SUSPENDED` + `autoSuspendedAt = now`
  + email au gérant (« club mis en veille — répondez-nous pour le réactiver »)
  + email d'information aux superadmins.
- **Réactivation** : le PATCH superadmin existant (ACTIVE) suffit ; `autoSuspendedAt`
  non-null garantit que le job ne re-suspendra **jamais** ce club, même toujours sans terrain.
- Emails du job : identité Palova, best-effort, non personnalisables.

## 5. Frontend

### `/clubs/new`

- Champ **SIRET** : validation Luhn **live côté client** (helper pur
  `frontend/lib/siret.ts`, miroir de `siretIsValidFormat` — à garder synchro), aide
  « 14 chiffres — visible sur votre Kbis ou annuaire-entreprises.data.gouv.fr ».
- Champ **Téléphone** (requis).
- Mapping d'erreurs : `SIRET_INVALID` → « Ce numéro SIRET est invalide (14 chiffres). » ;
  `SIRET_NOT_FOUND` → « Ce SIRET n'existe pas dans le répertoire des entreprises. » ;
  `SIRET_INACTIVE` → « Cet établissement est fermé administrativement. ».
- La vérification serveur reste la seule source de vérité (le client peut être contourné).

### Superadmin

- `/superadmin/clubs` : champ **SIRET optionnel** au formulaire de création.
- Fiche club `/superadmin/clubs/[id]` : affiche SIRET, raison sociale API et date de
  vérification (ou « non vérifié »).

### Inchangé

Wizard d'onboarding, `/admin/*`, parcours joueur : **aucune modification**.

## 6. Tests

- `siret.service.test.ts` : Luhn (valide, invalide, longueur, non-numérique), mapping
  réponse API (actif/fermé/introuvable), panne réseau → `null` (jamais de throw).
- `club.service.test.ts` : refus `SIRET_INVALID`/`SIRET_NOT_FOUND`/`SIRET_INACTIVE`,
  création réussie si API down (`siretVerifiedAt` null), `User.phone` + `Club.contactPhone`
  écrits, notif superadmin appelée après succès et jamais bloquante.
- Routes : codes 400 sur `POST /api/clubs`, SIRET optionnel non bloquant sur
  `POST /api/platform/clubs`.
- `clubJanitor.job.test.ts` : relance à J+15 (une seule fois), suspension à J+30
  (une seule fois), club avec terrain ignoré, club `siret null` ignoré, club réactivé
  jamais re-suspendu.
- Front : formulaire (champs requis, Luhn live, messages d'erreur mappés), superadmin
  (champ optionnel, fiche club).

## 7. Hors périmètre (parqué, assumé)

- **Identifiants d'entreprise non-FR** (NIF/CIF Espagne…) — le champ reste `siret` FR-only ;
  à généraliser au chantier i18n (cf. mémoire `i18n-global-strategy`).
- **Numéro FFT / habilitation** — pas d'API publique de vérification, champ écarté (décision #6).
- **Backfill des SIRET des clubs existants** — colonnes null, aucune rétro-saisie exigée.
- **Purge des comptes démo seedés en prod** (`test@`, `owner@`, `admin@`, `staff@palova.fr`
  en `password123`) — **opération manuelle urgente mais séparée**, pas du code.
- **Rate-limit sur la création de club** — l'infra `rateLimit.ts` existe si besoin un jour.
- **Écran « pourquoi le SIRET ? »** — une ligne d'aide suffit ; pas de page dédiée.
