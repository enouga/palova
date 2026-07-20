# Rappels tournoi/event (clôture + jour J) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Envoyer un rappel (in-app + push + email personnalisable) aux inscrits confirmés d'un tournoi/event, une fois avant la clôture des inscriptions (J-1) et deux fois avant le début de l'épreuve (J-1, H-2) — parité avec les rappels réservations/cours déjà en place.

**Architecture:** Réutilise le job de rappels existant (`backend/src/jobs/reminders.job.ts`, cron toutes les 15 min, technique de tranche temporelle sans flag persisté). Deux nouveaux blocs de requêtes (Tournament/ClubEvent par `registrationDeadline` puis par `startTime`) déclenchent 4 nouvelles fonctions `notify*` dans `backend/src/email/notifications.ts`, qui rendent l'email via 2 nouvelles entrées du registre `EMAIL_DEFS` (donc personnalisables dans `/admin/emails` sans aucun changement frontend). **Aucune migration.**

**Tech Stack:** Node.js/Express, Prisma (Postgres), Jest + `jest-mock-extended` (`prismaMock`), node-cron.

**Spec de référence :** `docs/superpowers/specs/2026-07-19-rappels-tournois-events-design.md`

---

### Task 1: Registre d'emails — 2 nouveaux types personnalisables

**Files:**
- Modify: `backend/src/email/registry.ts:566-567` (fin de `EMAIL_DEFS`, juste avant le `};` de fermeture)
- Modify: `backend/src/email/__tests__/registry.test.ts:90-91` (compteur d'entrées) et ajout de tests spécifiques

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `backend/src/email/__tests__/registry.test.ts`, remplacer la ligne 91 :

```ts
    expect(entries).toHaveLength(20);
```

par :

```ts
    expect(entries).toHaveLength(22);
```

Puis ajouter, à la fin du fichier (après le dernier `describe('renderClubEmail', ...)` — repérer la dernière accolade fermante `});` du fichier et insérer juste avant elle si le fichier se termine par ce bloc ; sinon en fin de fichier), un nouveau bloc :

```ts
describe('renderClubEmail — rappels tournoi/event', () => {
  it('registration.deadline_reminder utilise les défauts', () => {
    const mail = renderClubEmail('registration.deadline_reminder', {
      prenom: 'Marie', activite: 'Tournoi P100', ref_activite: 'le tournoi',
      club: 'Padel Arena', date_limite: 'mardi 30 juin 2026 à 23h59',
      coequipier: '', phrase_coequipier: '', lien: 'https://x.fr/t/1',
    }, brand, null);
    expect(mail.subject).toBe('Dernier délai pour Tournoi P100');
    expect(mail.html).toContain('La clôture des inscriptions approche');
    expect(mail.html).toContain('mardi 30 juin 2026 à 23h59');
  });

  it('registration.upcoming_reminder distingue J-1 (demain) et H-2 (dans 2 heures) via la variable delai', () => {
    const base = {
      prenom: 'Marie', activite: 'Tournoi P100', ref_activite: 'le tournoi',
      club: 'Padel Arena', date: 'dim. 6 juil. 14h00',
      coequipier: '', phrase_coequipier: '', lien: 'https://x.fr/t/1',
    };
    const j1 = renderClubEmail('registration.upcoming_reminder', { ...base, delai: 'demain' }, brand, null);
    expect(j1.subject).toBe('Tournoi P100, c\'est demain !');
    expect(j1.html).toContain('c’est demain');

    const h2 = renderClubEmail('registration.upcoming_reminder', { ...base, delai: 'dans 2 heures' }, brand, null);
    expect(h2.subject).toBe('Tournoi P100, c\'est dans 2 heures !');
    expect(h2.html).toContain('c’est dans 2 heures');
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `cd backend && npx jest src/email/__tests__/registry.test.ts`
Expected: FAIL — `expect(entries).toHaveLength(22)` reçoit `20`, et les 2 nouveaux tests lèvent `Error: EMAIL_TYPE_UNKNOWN` (le type n'existe pas encore dans `EMAIL_DEFS`).

- [ ] **Step 3: Ajouter les 2 entrées au registre**

Dans `backend/src/email/registry.ts`, remplacer :

```ts
  'payment.no_show_charged': {
    type: 'payment.no_show_charged', group: 'paiement',
    title: 'Débit pour absence (no-show)',
    description: "Au joueur quand le club le débite pour une réservation non honorée.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marc' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'montant', label: 'Montant débité', sample: '25,00 €' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/reservations' },
    ],
    defaults: {
      subject: 'Débit pour absence non signalée — {{club}}',
      heading: 'Réservation non honorée',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Vous ne vous êtes pas présenté·e à votre réservation du {{date}} sans prévenir le club. Un débit de <strong>{{montant}}</strong> a été appliqué sur votre carte enregistrée, conformément à la politique du club.</p>',
      ctaLabel: 'Voir mes réservations',
    },
    infoRows: (v) => [row('Terrain', v.terrain), row('Date', v.date), row('Club', v.club), row('Débité', v.montant)],
  },
};
```

par :

```ts
  'payment.no_show_charged': {
    type: 'payment.no_show_charged', group: 'paiement',
    title: 'Débit pour absence (no-show)',
    description: "Au joueur quand le club le débite pour une réservation non honorée.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marc' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'montant', label: 'Montant débité', sample: '25,00 €' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/reservations' },
    ],
    defaults: {
      subject: 'Débit pour absence non signalée — {{club}}',
      heading: 'Réservation non honorée',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Vous ne vous êtes pas présenté·e à votre réservation du {{date}} sans prévenir le club. Un débit de <strong>{{montant}}</strong> a été appliqué sur votre carte enregistrée, conformément à la politique du club.</p>',
      ctaLabel: 'Voir mes réservations',
    },
    infoRows: (v) => [row('Terrain', v.terrain), row('Date', v.date), row('Club', v.club), row('Débité', v.montant)],
  },

  'registration.deadline_reminder': {
    type: 'registration.deadline_reminder', group: 'inscriptions',
    title: "Rappel — clôture des inscriptions",
    description: "Aux inscrits confirmés, la veille de la date limite d'inscription (changer de coéquipier, annuler).",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom du destinataire', sample: 'Marie' },
      { key: 'activite', label: "Nom de l'activité", sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: "Référence (le tournoi / l'événement)", sample: 'le tournoi' },
      { key: 'club', label: 'Nom du club', sample: 'Padel Arena Paris' },
      { key: 'date_limite', label: "Date limite d'inscription", sample: 'mardi 30 juin 2026 à 23h59' },
      { key: 'coequipier', label: 'Coéquipier (tournoi, sinon vide)', sample: 'Lucas Martin' },
      { key: 'phrase_coequipier', label: 'Phrase coéquipier (auto)', sample: ' Vous êtes inscrit·e en binôme avec Lucas Martin.' },
      { key: 'lien', label: "Lien vers l'activité", sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: 'Dernier délai pour {{activite}}',
      heading: '⏰ La clôture des inscriptions approche',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>La date limite pour modifier ton inscription (changer de coéquipier, annuler) à <strong>{{activite}}</strong> est <strong>demain, le {{date_limite}}</strong>.{{phrase_coequipier}}</p>',
      ctaLabel: 'Voir {{ref_activite}}',
    },
    infoRows: (v) => [
      row('Date limite', v.date_limite),
      row('Club', v.club),
      ...(v.coequipier ? [row('Coéquipier', v.coequipier)] : []),
    ],
  },

  'registration.upcoming_reminder': {
    type: 'registration.upcoming_reminder', group: 'inscriptions',
    title: 'Rappel — jour J',
    description: "Aux inscrits confirmés, la veille (J-1) et 2h avant (H-2) le début de l'activité.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom du destinataire', sample: 'Marie' },
      { key: 'activite', label: "Nom de l'activité", sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: "Référence (le tournoi / l'événement)", sample: 'le tournoi' },
      { key: 'club', label: 'Nom du club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date et heure de début', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'delai', label: 'Délai avant le début (auto)', sample: 'demain' },
      { key: 'coequipier', label: 'Coéquipier (tournoi, sinon vide)', sample: 'Lucas Martin' },
      { key: 'phrase_coequipier', label: 'Phrase coéquipier (auto)', sample: ' Vous êtes inscrit·e en binôme avec Lucas Martin.' },
      { key: 'lien', label: "Lien vers l'activité", sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: '{{activite}}, c\'est {{delai}} !',
      heading: '🎾 Rappel',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{activite}}</strong>, c’est {{delai}} — rendez-vous le {{date}}.{{phrase_coequipier}}</p>',
      ctaLabel: 'Voir {{ref_activite}}',
    },
    infoRows: (v) => [
      row('Date', v.date),
      row('Club', v.club),
      ...(v.coequipier ? [row('Coéquipier', v.coequipier)] : []),
    ],
  },
};
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `cd backend && npx jest src/email/__tests__/registry.test.ts`
Expected: PASS (tous les tests, y compris les 2 nouveaux et le compteur à 22)

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/registry.ts backend/src/email/__tests__/registry.test.ts
git commit -m "feat(email): registre — rappels clôture et jour J tournoi/event"
```

---

### Task 2: Fonctions de notification (tournoi + event, clôture + jour J)

**Files:**
- Modify: `backend/src/email/notifications.ts:351-353` (insertion entre la fin de la section Events et le début de la section Parties ouvertes)
- Test: `backend/src/email/__tests__/notifications.registration-reminder.test.ts` (nouveau fichier)

- [ ] **Step 1: Écrire le test qui échoue**

Créer `backend/src/email/__tests__/notifications.registration-reminder.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import {
  notifyTournamentDeadlineReminder,
  notifyEventDeadlineReminder,
  notifyTournamentUpcomingReminder,
  notifyEventUpcomingReminder,
} from '../notifications';

const club = {
  id: 'club-1', name: 'Padel Arena', slug: 'arena', logoUrl: null, logoWideUrl: null,
  accentColor: '#d6ff3f', timezone: 'Europe/Paris', address: null, city: null,
  contactPhone: null, contactEmail: null,
};

const captain = { id: 'user-cap', email: 'cap@x.fr', firstName: 'Marie', lastName: 'Dupont' };
const partner = { id: 'user-par', email: 'par@x.fr', firstName: 'Lucas', lastName: 'Martin' };

describe('notifyTournamentDeadlineReminder', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('notifie capitaine ET partenaire d\'un tournoi publié avec des inscriptions confirmées', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Tournoi P100', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T12:00:00Z'), endTime: null,
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [{ id: 'reg1', status: 'CONFIRMED', captain, partner }],
    } as any);

    await notifyTournamentDeadlineReminder('t1');

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-cap', category: 'MY_REGISTRATIONS', type: 'registration.deadline_reminder',
      email: expect.objectContaining({ to: 'cap@x.fr' }),
    }));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-par', category: 'MY_REGISTRATIONS', type: 'registration.deadline_reminder',
      email: expect.objectContaining({ to: 'par@x.fr' }),
    }));
  });

  it('ne notifie rien si le tournoi est introuvable', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(null as any);
    await notifyTournamentDeadlineReminder('missing');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ne notifie rien si le tournoi n\'est pas PUBLISHED', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Tournoi P100', status: 'DRAFT',
      startTime: new Date(), endTime: null, registrationDeadline: new Date(),
      club, registrations: [{ id: 'reg1', status: 'CONFIRMED', captain, partner }],
    } as any);
    await notifyTournamentDeadlineReminder('t1');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe('notifyEventDeadlineReminder', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('notifie le joueur inscrit à un event publié', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({
      id: 'e1', name: 'Mêlée du jeudi', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T18:00:00Z'), endTime: null,
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [{ id: 'reg1', status: 'CONFIRMED', user: captain }],
    } as any);

    await notifyEventDeadlineReminder('e1');

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-cap', category: 'MY_REGISTRATIONS', type: 'registration.deadline_reminder',
      email: expect.objectContaining({ to: 'cap@x.fr' }),
    }));
  });

  it('ne notifie rien si l\'event est introuvable', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(null as any);
    await notifyEventDeadlineReminder('missing');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe('notifyTournamentUpcomingReminder', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('notifie capitaine et partenaire, fenêtre J-1 → delai "demain"', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Tournoi P100', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T12:00:00Z'), endTime: new Date('2026-07-10T18:00:00Z'),
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [{ id: 'reg1', status: 'CONFIRMED', captain, partner }],
    } as any);

    await notifyTournamentUpcomingReminder('t1', 'J-1');

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-cap', type: 'registration.upcoming_reminder',
      email: expect.objectContaining({ subject: expect.stringContaining('demain') }),
    }));
  });

  it('fenêtre H-2 → delai "dans 2 heures"', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Tournoi P100', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T12:00:00Z'), endTime: new Date('2026-07-10T18:00:00Z'),
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [{ id: 'reg1', status: 'CONFIRMED', captain, partner }],
    } as any);

    await notifyTournamentUpcomingReminder('t1', 'H-2');

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      email: expect.objectContaining({ subject: expect.stringContaining('dans 2 heures') }),
    }));
  });

  it('ignore les inscriptions WAITLISTED (déjà filtrées par la requête, mais garde-fou si présentes)', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Tournoi P100', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T12:00:00Z'), endTime: null,
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [],
    } as any);

    await notifyTournamentUpcomingReminder('t1', 'J-1');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe('notifyEventUpcomingReminder', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('notifie le joueur inscrit, fenêtre H-2', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({
      id: 'e1', name: 'Mêlée du jeudi', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T18:00:00Z'), endTime: null,
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [{ id: 'reg1', status: 'CONFIRMED', user: captain }],
    } as any);

    await notifyEventUpcomingReminder('e1', 'H-2');

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-cap', type: 'registration.upcoming_reminder',
      email: expect.objectContaining({ subject: expect.stringContaining('dans 2 heures') }),
    }));
  });

  it('ne notifie rien si l\'event n\'est pas PUBLISHED', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({
      id: 'e1', name: 'Mêlée du jeudi', status: 'CANCELLED',
      startTime: new Date(), endTime: null, registrationDeadline: new Date(),
      club, registrations: [{ id: 'reg1', status: 'CONFIRMED', user: captain }],
    } as any);

    await notifyEventUpcomingReminder('e1', 'J-1');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `cd backend && npx jest src/email/__tests__/notifications.registration-reminder.test.ts`
Expected: FAIL à la compilation TypeScript — `notifyTournamentDeadlineReminder`, `notifyEventDeadlineReminder`, `notifyTournamentUpcomingReminder`, `notifyEventUpcomingReminder` ne sont pas exportés par `../notifications`.

- [ ] **Step 3: Implémenter les 4 fonctions**

Dans `backend/src/email/notifications.ts`, remplacer :

```ts
export async function notifyEventPromotion(registrationId: string): Promise<void> {
  const reg = await loadEventRegistration(registrationId);
  if (!reg) return;
  await sendEventPlayerEmail(reg, 'promoted');
}

// ------------------------------------------------------ Parties ouvertes
```

par :

```ts
export async function notifyEventPromotion(registrationId: string): Promise<void> {
  const reg = await loadEventRegistration(registrationId);
  if (!reg) return;
  await sendEventPlayerEmail(reg, 'promoted');
}

// ------------------------------------- Rappels tournoi/event (clôture, jour J)

/** Vrai si `t`/`e` est une épreuve publiée (les rappels ne concernent jamais DRAFT/CANCELLED). */
function isPublished(status: string): boolean {
  return status === 'PUBLISHED';
}

export async function notifyTournamentDeadlineReminder(tournamentId: string): Promise<void> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      club: { select: EMAIL_CLUB_SELECT },
      registrations: {
        where: { status: 'CONFIRMED' },
        include: {
          captain: { select: { id: true, email: true, firstName: true, lastName: true } },
          partner: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!t || !isPublished(t.status) || t.registrations.length === 0) return;
  const brand = brandFromClub(t.club);
  const url = clubAppUrl(t.club.slug, `/tournois/${t.id}`);
  const dateLimite = formatDateFr(t.registrationDeadline, t.club.timezone);
  const override = await emailTemplates.getOverride(t.club.id, 'registration.deadline_reminder');
  for (const reg of t.registrations) {
    const recipients = [
      { user: reg.captain, partner: reg.partner },
      { user: reg.partner, partner: reg.captain },
    ];
    for (const { user, partner } of recipients) {
      if (!user.email) continue;
      const coequipier = fullName(partner);
      const vars: Record<string, string> = {
        prenom: user.firstName,
        activite: t.name,
        ref_activite: refActivite('tournament'),
        club: t.club.name,
        date_limite: dateLimite,
        lien: url,
        coequipier,
        phrase_coequipier: coequipier ? ` Vous êtes inscrit·e en binôme avec ${coequipier}.` : '',
      };
      const mail = renderClubEmail('registration.deadline_reminder', vars, brand, override);
      await dispatch({
        userId: user.id,
        clubId: t.club.id,
        category: 'MY_REGISTRATIONS',
        type: 'registration.deadline_reminder',
        title: 'La clôture des inscriptions approche',
        body: `Dernier délai pour modifier ton inscription à « ${t.name} » : ${dateLimite}.`,
        url,
        email: { to: user.email, subject: mail.subject, html: mail.html, text: mail.text },
      });
    }
  }
}

export async function notifyEventDeadlineReminder(eventId: string): Promise<void> {
  const e = await prisma.clubEvent.findUnique({
    where: { id: eventId },
    include: {
      club: { select: EMAIL_CLUB_SELECT },
      registrations: {
        where: { status: 'CONFIRMED' },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      },
    },
  });
  if (!e || !isPublished(e.status) || e.registrations.length === 0) return;
  const brand = brandFromClub(e.club);
  const url = clubAppUrl(e.club.slug, `/events/${e.id}`);
  const dateLimite = formatDateFr(e.registrationDeadline, e.club.timezone);
  const override = await emailTemplates.getOverride(e.club.id, 'registration.deadline_reminder');
  for (const reg of e.registrations) {
    if (!reg.user.email) continue;
    const vars: Record<string, string> = {
      prenom: reg.user.firstName,
      activite: e.name,
      ref_activite: refActivite('event'),
      club: e.club.name,
      date_limite: dateLimite,
      lien: url,
      coequipier: '',
      phrase_coequipier: '',
    };
    const mail = renderClubEmail('registration.deadline_reminder', vars, brand, override);
    await dispatch({
      userId: reg.user.id,
      clubId: e.club.id,
      category: 'MY_REGISTRATIONS',
      type: 'registration.deadline_reminder',
      title: 'La clôture des inscriptions approche',
      body: `Dernier délai pour modifier ton inscription à « ${e.name} » : ${dateLimite}.`,
      url,
      email: { to: reg.user.email, subject: mail.subject, html: mail.html, text: mail.text },
    });
  }
}

export async function notifyTournamentUpcomingReminder(tournamentId: string, window: 'J-1' | 'H-2'): Promise<void> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      club: { select: EMAIL_CLUB_SELECT },
      registrations: {
        where: { status: 'CONFIRMED' },
        include: {
          captain: { select: { id: true, email: true, firstName: true, lastName: true } },
          partner: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!t || !isPublished(t.status) || t.registrations.length === 0) return;
  const brand = brandFromClub(t.club);
  const url = clubAppUrl(t.club.slug, `/tournois/${t.id}`);
  const dateLabel = formatDateRangeFr(t.startTime, t.endTime, t.club.timezone);
  const delai = window === 'H-2' ? 'dans 2 heures' : 'demain';
  const override = await emailTemplates.getOverride(t.club.id, 'registration.upcoming_reminder');
  for (const reg of t.registrations) {
    const recipients = [
      { user: reg.captain, partner: reg.partner },
      { user: reg.partner, partner: reg.captain },
    ];
    for (const { user, partner } of recipients) {
      if (!user.email) continue;
      const coequipier = fullName(partner);
      const vars: Record<string, string> = {
        prenom: user.firstName,
        activite: t.name,
        ref_activite: refActivite('tournament'),
        club: t.club.name,
        date: dateLabel,
        delai,
        lien: url,
        coequipier,
        phrase_coequipier: coequipier ? ` Vous êtes inscrit·e en binôme avec ${coequipier}.` : '',
      };
      const mail = renderClubEmail('registration.upcoming_reminder', vars, brand, override);
      await dispatch({
        userId: user.id,
        clubId: t.club.id,
        category: 'MY_REGISTRATIONS',
        type: 'registration.upcoming_reminder',
        title: window === 'H-2' ? "C'est dans 2 heures" : "C'est demain",
        body: `« ${t.name} », c'est ${delai} — ${dateLabel}.`,
        url,
        email: { to: user.email, subject: mail.subject, html: mail.html, text: mail.text },
      });
    }
  }
}

export async function notifyEventUpcomingReminder(eventId: string, window: 'J-1' | 'H-2'): Promise<void> {
  const e = await prisma.clubEvent.findUnique({
    where: { id: eventId },
    include: {
      club: { select: EMAIL_CLUB_SELECT },
      registrations: {
        where: { status: 'CONFIRMED' },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      },
    },
  });
  if (!e || !isPublished(e.status) || e.registrations.length === 0) return;
  const brand = brandFromClub(e.club);
  const url = clubAppUrl(e.club.slug, `/events/${e.id}`);
  const dateLabel = formatDateRangeFr(e.startTime, e.endTime, e.club.timezone);
  const delai = window === 'H-2' ? 'dans 2 heures' : 'demain';
  const override = await emailTemplates.getOverride(e.club.id, 'registration.upcoming_reminder');
  for (const reg of e.registrations) {
    if (!reg.user.email) continue;
    const vars: Record<string, string> = {
      prenom: reg.user.firstName,
      activite: e.name,
      ref_activite: refActivite('event'),
      club: e.club.name,
      date: dateLabel,
      delai,
      lien: url,
      coequipier: '',
      phrase_coequipier: '',
    };
    const mail = renderClubEmail('registration.upcoming_reminder', vars, brand, override);
    await dispatch({
      userId: reg.user.id,
      clubId: e.club.id,
      category: 'MY_REGISTRATIONS',
      type: 'registration.upcoming_reminder',
      title: window === 'H-2' ? "C'est dans 2 heures" : "C'est demain",
      body: `« ${e.name} », c'est ${delai} — ${dateLabel}.`,
      url,
      email: { to: reg.user.email, subject: mail.subject, html: mail.html, text: mail.text },
    });
  }
}

// ------------------------------------------------------ Parties ouvertes
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `cd backend && npx jest src/email/__tests__/notifications.registration-reminder.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/notifications.ts backend/src/email/__tests__/notifications.registration-reminder.test.ts
git commit -m "feat(email): notify* rappels clôture et jour J tournoi/event"
```

---

### Task 3: Câblage dans le job de rappels (cron)

**Files:**
- Modify: `backend/src/jobs/reminders.job.ts` (imports + constante + 2 blocs de requêtes)
- Modify: `backend/src/jobs/__tests__/reminders.job.test.ts` (mocks + nouveaux tests)

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `backend/src/jobs/__tests__/reminders.job.test.ts`, remplacer tout le fichier par :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../../email/notifications', () => ({
  notifyReservationReminder: jest.fn(),
  notifyMatchResultPrompt: jest.fn(),
  notifyTournamentDeadlineReminder: jest.fn(),
  notifyEventDeadlineReminder: jest.fn(),
  notifyTournamentUpcomingReminder: jest.fn(),
  notifyEventUpcomingReminder: jest.fn(),
}));

import {
  notifyReservationReminder,
  notifyMatchResultPrompt,
  notifyTournamentDeadlineReminder,
  notifyEventDeadlineReminder,
  notifyTournamentUpcomingReminder,
  notifyEventUpcomingReminder,
} from '../../email/notifications';
import { runReminders, REMINDER_WINDOWS, REMINDER_PERIOD_MIN, DEADLINE_REMINDER_LEAD_MIN } from '../reminders.job';

const notifyMock = notifyReservationReminder as jest.Mock;
const fixedNow = new Date('2026-07-01T12:00:00Z');

describe('runReminders', () => {
  beforeEach(() => {
    notifyMock.mockReset();
    prismaMock.reservation.findMany.mockResolvedValue([{ id: 'r1' }] as any);
    prismaMock.tournament.findMany.mockResolvedValue([]);
    prismaMock.clubEvent.findMany.mockResolvedValue([]);
  });

  it('calls notifyReservationReminder for J-1 and H-2 windows', async () => {
    await runReminders(fixedNow);
    expect(notifyMock).toHaveBeenCalledWith('r1', 'J-1');
    expect(notifyMock).toHaveBeenCalledWith('r1', 'H-2');
  });

  it('queries correct startTime bounds for each window', async () => {
    await runReminders(fixedNow);

    for (const w of REMINDER_WINDOWS) {
      const expectedFrom = new Date(fixedNow.getTime() + (w.leadMin - REMINDER_PERIOD_MIN) * 60000);
      const expectedTo = new Date(fixedNow.getTime() + w.leadMin * 60000);

      expect(prismaMock.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'CONFIRMED',
            startTime: { gt: expectedFrom, lte: expectedTo },
          }),
        }),
      );
    }
  });

  it('catches errors per reservation and continues', async () => {
    notifyMock.mockRejectedValueOnce(new Error('network error'));
    await expect(runReminders(fixedNow)).resolves.not.toThrow();
    // Still calls for both windows (2 calls total)
    expect(notifyMock).toHaveBeenCalledTimes(2);
  });
});

describe('runReminders — passe post-match', () => {
  const promptMock = notifyMatchResultPrompt as jest.Mock;
  const fixedNow2 = new Date('2026-07-01T12:00:00Z');

  beforeEach(() => {
    promptMock.mockReset();
    (notifyReservationReminder as jest.Mock).mockReset();
    prismaMock.tournament.findMany.mockResolvedValue([]);
    prismaMock.clubEvent.findMany.mockResolvedValue([]);
    // 1er appel findMany = fenêtre J-1, 2e = H-2, 3e = passe post-match.
    prismaMock.reservation.findMany.mockResolvedValue([{ id: 'rp1' }] as any);
  });

  it('notifie le résultat pour les réservations finies dans la tranche [-30min, -15min]', async () => {
    await runReminders(fixedNow2);
    expect(promptMock).toHaveBeenCalledWith('rp1');
    // La requête post-match cible endTime dans la bonne tranche.
    const postCall = (prismaMock.reservation.findMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.where?.endTime,
    );
    expect(postCall).toBeTruthy();
    const expectedFrom = new Date(fixedNow2.getTime() - 30 * 60000);
    const expectedTo = new Date(fixedNow2.getTime() - 15 * 60000);
    expect(postCall[0].where.endTime).toEqual({ gt: expectedFrom, lte: expectedTo });
    expect(postCall[0].where.status).toBe('CONFIRMED');
  });

  it('un échec de notification post-match ne casse pas le job', async () => {
    promptMock.mockRejectedValueOnce(new Error('boom'));
    await expect(runReminders(fixedNow2)).resolves.not.toThrow();
  });
});

describe('runReminders — rappel clôture tournoi/event (J-1)', () => {
  const deadlineMock = notifyTournamentDeadlineReminder as jest.Mock;
  const eventDeadlineMock = notifyEventDeadlineReminder as jest.Mock;
  const fixedNow3 = new Date('2026-07-01T12:00:00Z');

  beforeEach(() => {
    deadlineMock.mockReset();
    eventDeadlineMock.mockReset();
    prismaMock.reservation.findMany.mockResolvedValue([]);
  });

  it('notifie les tournois et events dont la clôture tombe dans la tranche J-1', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 't1' }] as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([{ id: 'e1' }] as any);

    await runReminders(fixedNow3);

    expect(deadlineMock).toHaveBeenCalledWith('t1');
    expect(eventDeadlineMock).toHaveBeenCalledWith('e1');

    const expectedFrom = new Date(fixedNow3.getTime() + (DEADLINE_REMINDER_LEAD_MIN - REMINDER_PERIOD_MIN) * 60000);
    const expectedTo = new Date(fixedNow3.getTime() + DEADLINE_REMINDER_LEAD_MIN * 60000);
    expect(prismaMock.tournament.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PUBLISHED', registrationDeadline: { gt: expectedFrom, lte: expectedTo } },
      }),
    );
    expect(prismaMock.clubEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PUBLISHED', registrationDeadline: { gt: expectedFrom, lte: expectedTo } },
      }),
    );
  });

  it('un échec sur un tournoi ne bloque pas les autres', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }] as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([]);
    deadlineMock.mockRejectedValueOnce(new Error('smtp down'));

    await expect(runReminders(fixedNow3)).resolves.not.toThrow();
    expect(deadlineMock).toHaveBeenCalledTimes(2);
  });
});

describe('runReminders — rappel jour J tournoi/event (J-1, H-2)', () => {
  const upcomingMock = notifyTournamentUpcomingReminder as jest.Mock;
  const eventUpcomingMock = notifyEventUpcomingReminder as jest.Mock;
  const fixedNow4 = new Date('2026-07-01T12:00:00Z');

  beforeEach(() => {
    upcomingMock.mockReset();
    eventUpcomingMock.mockReset();
    prismaMock.reservation.findMany.mockResolvedValue([]);
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 't1' }] as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([{ id: 'e1' }] as any);
  });

  it('notifie pour les fenêtres J-1 ET H-2', async () => {
    await runReminders(fixedNow4);

    expect(upcomingMock).toHaveBeenCalledWith('t1', 'J-1');
    expect(upcomingMock).toHaveBeenCalledWith('t1', 'H-2');
    expect(eventUpcomingMock).toHaveBeenCalledWith('e1', 'J-1');
    expect(eventUpcomingMock).toHaveBeenCalledWith('e1', 'H-2');
  });

  it('interroge startTime avec les mêmes bornes que REMINDER_WINDOWS', async () => {
    await runReminders(fixedNow4);

    for (const w of REMINDER_WINDOWS) {
      const expectedFrom = new Date(fixedNow4.getTime() + (w.leadMin - REMINDER_PERIOD_MIN) * 60000);
      const expectedTo = new Date(fixedNow4.getTime() + w.leadMin * 60000);
      expect(prismaMock.tournament.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PUBLISHED', startTime: { gt: expectedFrom, lte: expectedTo } },
        }),
      );
    }
  });

  it('un échec sur un event ne bloque pas les autres appels', async () => {
    eventUpcomingMock.mockRejectedValueOnce(new Error('boom'));
    await expect(runReminders(fixedNow4)).resolves.not.toThrow();
    expect(eventUpcomingMock).toHaveBeenCalledTimes(2); // J-1 et H-2 malgré l'échec du premier
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `cd backend && npx jest src/jobs/__tests__/reminders.job.test.ts`
Expected: FAIL — `DEADLINE_REMINDER_LEAD_MIN` n'est pas exporté par `../reminders.job`, et les nouveaux mocks (`notifyTournamentDeadlineReminder` etc.) ne sont pas appelés (erreur de compilation/import puis assertions non satisfaites).

- [ ] **Step 3: Câbler les 2 nouveaux blocs dans le job**

Dans `backend/src/jobs/reminders.job.ts`, remplacer l'import :

```ts
import cron from 'node-cron';
import { prisma } from '../db/prisma';
import { notifyReservationReminder, notifyMatchResultPrompt } from '../email/notifications';
```

par :

```ts
import cron from 'node-cron';
import { prisma } from '../db/prisma';
import {
  notifyReservationReminder,
  notifyMatchResultPrompt,
  notifyTournamentDeadlineReminder,
  notifyEventDeadlineReminder,
  notifyTournamentUpcomingReminder,
  notifyEventUpcomingReminder,
} from '../email/notifications';
```

Puis remplacer :

```ts
export const REMINDER_WINDOWS = [
  { key: 'J-1' as const, leadMin: 1440 },
  { key: 'H-2' as const, leadMin: 120 },
];
export const REMINDER_PERIOD_MIN = 15;
```

par :

```ts
export const REMINDER_WINDOWS = [
  { key: 'J-1' as const, leadMin: 1440 },
  { key: 'H-2' as const, leadMin: 120 },
];
export const REMINDER_PERIOD_MIN = 15;

// Rappel de clôture d'inscription (tournoi/event) : une seule fenêtre J-1, découplée de
// REMINDER_WINDOWS (qui ne concerne que le jour J) pour pouvoir évoluer indépendamment.
export const DEADLINE_REMINDER_LEAD_MIN = 1440;
```

Puis remplacer :

```ts
  // Passe post-match : réservations dont la fin tombe dans la tranche écoulée.
```

par :

```ts
  // Rappel clôture d'inscription (tournoi/event) — fenêtre unique J-1.
  {
    const from = new Date(now.getTime() + (DEADLINE_REMINDER_LEAD_MIN - REMINDER_PERIOD_MIN) * 60000);
    const to = new Date(now.getTime() + DEADLINE_REMINDER_LEAD_MIN * 60000);
    const tournaments = await prisma.tournament.findMany({
      where: { status: 'PUBLISHED', registrationDeadline: { gt: from, lte: to } },
      select: { id: true },
    });
    for (const t of tournaments) {
      try {
        await notifyTournamentDeadlineReminder(t.id);
      } catch (e) {
        console.error('[reminders:tournament-deadline]', (e as Error).message);
      }
    }
    const deadlineEvents = await prisma.clubEvent.findMany({
      where: { status: 'PUBLISHED', registrationDeadline: { gt: from, lte: to } },
      select: { id: true },
    });
    for (const ev of deadlineEvents) {
      try {
        await notifyEventDeadlineReminder(ev.id);
      } catch (e) {
        console.error('[reminders:event-deadline]', (e as Error).message);
      }
    }
  }

  // Rappel jour J (tournoi/event) — mêmes fenêtres J-1/H-2 que les réservations.
  for (const w of REMINDER_WINDOWS) {
    const from = new Date(now.getTime() + (w.leadMin - REMINDER_PERIOD_MIN) * 60000);
    const to = new Date(now.getTime() + w.leadMin * 60000);
    const tournaments = await prisma.tournament.findMany({
      where: { status: 'PUBLISHED', startTime: { gt: from, lte: to } },
      select: { id: true },
    });
    for (const t of tournaments) {
      try {
        await notifyTournamentUpcomingReminder(t.id, w.key);
      } catch (e) {
        console.error('[reminders:tournament-upcoming]', (e as Error).message);
      }
    }
    const upcomingEvents = await prisma.clubEvent.findMany({
      where: { status: 'PUBLISHED', startTime: { gt: from, lte: to } },
      select: { id: true },
    });
    for (const ev of upcomingEvents) {
      try {
        await notifyEventUpcomingReminder(ev.id, w.key);
      } catch (e) {
        console.error('[reminders:event-upcoming]', (e as Error).message);
      }
    }
  }

  // Passe post-match : réservations dont la fin tombe dans la tranche écoulée.
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `cd backend && npx jest src/jobs/__tests__/reminders.job.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/jobs/reminders.job.ts backend/src/jobs/__tests__/reminders.job.test.ts
git commit -m "feat(reminders): câblage cron rappels clôture et jour J tournoi/event"
```

---

### Task 4: Vérification globale et note d'évolution CLAUDE.md

**Files:**
- Modify: `palova/CLAUDE.md` (section « Notifications email inscriptions tournois & events (v1) ✅ implémenté »)

- [ ] **Step 1: Lancer toute la suite backend**

Run: `cd backend && npx jest`
Expected: PASS — tous les tests existants restent verts, plus les nouveaux (registry, notifications, reminders.job).

- [ ] **Step 2: Lancer le typecheck backend**

Run: `cd backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Ajouter la note d'évolution**

Dans `palova/CLAUDE.md`, repérer le paragraphe qui commence par :

```
## Notifications email inscriptions tournois & events (v1) ✅ implémenté
```

Juste après le dernier paragraphe de cette section (celui qui se termine par `Spec & plan :
docs/superpowers/{specs,plans}/2026-06-XX-...` — dernier bloc avant le prochain `##` ou `>`
d'une autre section), ajouter :

```markdown

> **Évolution (2026-07-19) — rappels clôture et jour J :** le job de rappels
> (`reminders.job.ts`, déjà en charge des réservations/cours J-1/H-2) couvre désormais les
> inscriptions **tournoi/event confirmées** : rappel **clôture** (J-1 avant
> `registrationDeadline`, « dernier délai pour changer de coéquipier / annuler ») et rappel
> **jour J** (J-1 + H-2 avant `startTime`, même paire de fenêtres que l'existant). **Aucune
> migration** — même technique de tranche temporelle que le job existant. 4 nouvelles
> fonctions `notify{Tournament,Event}{Deadline,Upcoming}Reminder` dans `notifications.ts`,
> au niveau de l'épreuve (une requête, puis boucle sur ses inscrits `CONFIRMED` — capitaine
> + partenaire pour un tournoi, joueur seul pour un event). 2 nouveaux types dans le
> registre d'emails personnalisable (`registration.deadline_reminder` /
> `registration.upcoming_reminder`, 22 types au total), visibles automatiquement dans
> `/admin/emails` — **aucun changement frontend**. Catégorie `MY_REGISTRATIONS` (comme le
> reste du cycle d'inscription), donc email inclus, à la différence des rappels
> réservations/cours (catégorie `REMINDERS`, in-app+push seuls). Hors v1 : relance aux
> membres non-inscrits avant clôture, rappels pour les `WAITLISTED`. Spec & plan :
> `docs/superpowers/{specs,plans}/2026-07-19-rappels-tournois-events*`.
```

- [ ] **Step 4: Commit**

```bash
git add palova/CLAUDE.md
git commit -m "docs: note d'évolution — rappels clôture et jour J tournoi/event"
```
