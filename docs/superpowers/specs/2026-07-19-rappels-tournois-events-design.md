# Rappels tournoi/event — clôture d'inscription & jour J (design)

**Date** : 2026-07-19
**Statut** : validé (brainstorming avec Eric)

## Problème

Le job de rappels (`backend/src/jobs/reminders.job.ts`) couvre les réservations de terrain
et les cours (fenêtres J-1 et H-2 avant le début), mais **jamais** les inscriptions
tournoi/event : un joueur inscrit ne reçoit aucun rappel avant la clôture des inscriptions
(dernier moment pour changer de coéquipier ou annuler) ni avant le jour J de l'épreuve.

## Décisions (choix utilisateur)

- **Deux rappels distincts**, tous deux réservés aux inscrits **déjà confirmés** (pas de
  relance marketing aux membres non-inscrits — hors périmètre, demanderait une logique de
  ciblage/audience séparée) :
  - **Clôture** : une seule fenêtre **J-1** avant `registrationDeadline` (« la date limite
    pour modifier ton inscription approche » — information actionnable : changer de
    coéquipier ou annuler avant qu'il ne soit trop tard).
  - **Jour J** : les deux fenêtres **J-1 et H-2** avant `startTime`, en parité stricte avec
    les rappels réservations/cours existants.
- **Canaux** : in-app + push + **email personnalisable** (comme les autres emails du cycle
  d'inscription — `registration.confirmed`, `.waitlisted`, etc. — et à la différence des
  rappels réservations/cours qui restent in-app+push seuls).
- **Aucune migration** : même technique de **tranche temporelle** que le job existant (pas
  de flag « déjà notifié » persisté) — deux requêtes de plus dans `runReminders(now)`.

## Portée exacte

Concerné : `Tournament` (via `TournamentRegistration`) et `ClubEvent` (via
`EventRegistration`). **Statut de l'épreuve `PUBLISHED`** uniquement (une épreuve
`DRAFT`/`CANCELLED` n'émet aucun rappel). **Statut d'inscription `CONFIRMED`** uniquement
— les `WAITLISTED` ne sont pas garantis de jouer, ils ne reçoivent ni le rappel de clôture
ni celui du jour J ; les `CANCELLED` sont naturellement exclus par le filtre de statut.

Une inscription `CONFIRMED` mais encore `paymentStatus DUE` (paiement en ligne en attente,
hold 15 min) ne pose pas de cas particulier : le job de nettoyage minute existant libère
déjà les `DUE` expirées bien avant qu'un rappel (J-1 = 24h, minimum) ne puisse les
concerner — au moment où le job de rappels tourne, seules les inscriptions réellement
actives restent `CONFIRMED`.

Un tournoi notifie **capitaine + partenaire** ; un event notifie **le joueur seul**
(mêmes destinataires que les emails `registration.*` existants).

## Modèle de données

**Aucun changement de schéma.** Les deux dates ancres existent déjà :
`Tournament.registrationDeadline` / `.startTime` et `ClubEvent.registrationDeadline` /
`.startTime`. L'idempotence repose, comme pour les réservations, sur le fait qu'une date
donnée ne tombe que dans **une seule tranche de 15 minutes** par run — le job tourne déjà
toutes les 15 min (`REMINDER_PERIOD_MIN`), donc le même mécanisme de tranche
`[now + lead − période, now + lead]` s'applique tel quel aux nouvelles dates ancres.

## Backend

### `reminders.job.ts`

Deux nouveaux blocs dans `runReminders(now)`, sur le modèle des blocs réservations/cours
existants :

```ts
// Fenêtre unique J-1 avant clôture — indépendante de REMINDER_WINDOWS (celle-ci ne
// concerne que le jour J), pour pouvoir faire évoluer les deux sans les coupler.
const DEADLINE_REMINDER_LEAD_MIN = 1440;
```

1. **Rappel clôture** — pour `Tournament` et `ClubEvent`, `status: 'PUBLISHED'`,
   `registrationDeadline` dans la tranche `[now + lead − période, now + lead]` avec
   `lead = DEADLINE_REMINDER_LEAD_MIN` → `notifyTournamentDeadlineReminder(id)` /
   `notifyEventDeadlineReminder(id)`.
2. **Rappel jour J** — pour `Tournament` et `ClubEvent`, `status: 'PUBLISHED'`, boucle sur
   `REMINDER_WINDOWS` (J-1 et H-2, réutilisées telles quelles) appliquée à `startTime` →
   `notifyTournamentUpcomingReminder(id, window)` / `notifyEventUpcomingReminder(id, window)`.

Chaque appel est enveloppé `try/catch` + `console.error` comme les blocs existants (un
échec sur une épreuve ne bloque pas les autres).

### `notifications.ts` — 4 nouvelles fonctions

Au niveau de l'**épreuve** (pas de la registration individuelle) : une requête charge le
tournoi/event + ses inscriptions `CONFIRMED`, puis on boucle pour notifier chaque
destinataire — même esprit que `sendTournamentPlayerEmails`/`sendEventPlayerEmail`
existants, réutilisés autant que possible pour construire les `vars`.

- `notifyTournamentDeadlineReminder(tournamentId)`
- `notifyEventDeadlineReminder(eventId)`
- `notifyTournamentUpcomingReminder(tournamentId, window: 'J-1' | 'H-2')`
- `notifyEventUpcomingReminder(eventId, window: 'J-1' | 'H-2')`

Chacune : charge l'épreuve (+ club, + inscriptions `CONFIRMED` avec leurs joueurs), renvoie
immédiatement si l'épreuve est introuvable/annulée ou n'a aucune inscription confirmée,
sinon boucle sur les destinataires et appelle `dispatch(...)` avec un payload email
construit via `renderClubEmail(...)` (résolution de la surcharge club via
`emailTemplates.getOverride`, pattern identique à tout le reste du fichier).

Pour un tournoi, `coequipier`/`phrase_coequipier` sont résolus **par destinataire** (le
capitaine voit le nom du partenaire et inversement) — même calcul que dans
`sendTournamentPlayerEmails`, à réutiliser tel quel plutôt que redupliqué.

Catégorie **`MY_REGISTRATIONS`** (déjà utilisée pour tout le cycle d'inscription — pas
`REMINDERS`, réservée aux réservations/cours qui n'ont pas d'email).

### Registre d'emails — 2 nouveaux types (22 au total)

`backend/src/email/registry.ts`, groupe `inscriptions` :

**`registration.deadline_reminder`**
- `vars` : `prenom`, `activite`, `ref_activite`, `club`, `date_limite` (deadline formatée
  fuseau club), `lien`, `coequipier`, `phrase_coequipier` (vide pour un event, même
  convention que `registration.confirmed`).
- `defaults.subject` : `Dernier délai pour {{activite}}`
- `defaults.heading` : `⏰ La clôture des inscriptions approche`
- `defaults.bodyHtml` : `<p>Bonjour {{prenom}},</p><p>La date limite pour modifier ton
  inscription (changer de coéquipier, annuler) à <strong>{{activite}}</strong> est
  <strong>demain, le {{date_limite}}</strong>.{{phrase_coequipier}}</p>`
- `ctaLabel` : `Voir {{ref_activite}}`
- `infoRows` : Date limite, Club, Coéquipier (si présent)

**`registration.upcoming_reminder`**
- `vars` : `prenom`, `activite`, `ref_activite`, `club`, `date` (date/heure de début,
  formatée), `delai` (« demain » ou « dans 2 heures » — un seul type d'email couvre les 2
  fenêtres plutôt que 4 types séparés), `lien`, `coequipier`, `phrase_coequipier`.
- `defaults.subject` : `{{activite}}, c'est {{delai}} !`
- `defaults.heading` : `🎾 Rappel`
- `defaults.bodyHtml` : `<p>Bonjour {{prenom}},</p><p><strong>{{activite}}</strong>, c'est
  {{delai}} — rendez-vous le {{date}}.{{phrase_coequipier}}</p>`
- `ctaLabel` : `Voir {{ref_activite}}`
- `infoRows` : Date, Club, Coéquipier (si présent)

Ces deux types apparaissent automatiquement dans `/admin/emails` (page pilotée par
`EMAIL_DEFS`) — **aucun changement frontend requis**.

## Hors périmètre v1 (parqué)

- Relance aux membres **non-inscrits** avant clôture (ciblage d'audience, opt-out dédié —
  différent en nature d'un rappel à un inscrit).
- Rappel de clôture avec fenêtre **H-2** (jugé peu utile : action ponctuelle, une alerte
  24h avant suffit).
- Rappel pour les inscriptions **`WAITLISTED`**.
- Rappels pour les **cours** côté tournoi/event (déjà couverts par ailleurs via
  `Reservation`, hors sujet ici).
- Annulation/replanification d'une épreuve après l'envoi d'un rappel (best-effort assumé,
  comme le reste du job).

## Tests

- **Backend**
  - `reminders.job.test.ts` : nouveaux blocs — tournoi/event dans la tranche clôture J-1,
    dans les tranches jour J J-1/H-2, épreuve `DRAFT`/`CANCELLED` ignorée, aucune
    inscription confirmée → pas d'appel, tranche hors fenêtre → pas d'appel.
  - Nouveau `notifications.registration-reminder.test.ts` (mirroring
    `notifications.no-show.test.ts`) : contenu des 4 fonctions — capitaine+partenaire
    notifiés pour un tournoi, joueur seul pour un event, `WAITLISTED` exclu, épreuve
    introuvable → no-op, échec `dispatch` sur un destinataire n'empêche pas les autres.
  - `registry.test.ts` : les 2 nouvelles entrées (22 types), substitution des vars,
    `phrase_coequipier` vide pour un event.
- Pas de test frontend requis (aucun changement UI).
