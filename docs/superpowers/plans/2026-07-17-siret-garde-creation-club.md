# Garde SIRET à la création de club + détection des clubs fantômes — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exiger un SIRET français vérifié + le téléphone du gérant à la création self-service d'un club, notifier les superadmins de chaque création, et suspendre automatiquement les clubs restés sans terrain (relance J+15, suspension J+30).

**Architecture:** Vérification **synchrone** du SIRET dans `createClub`, appel réseau **hors transaction**, miroir exact du géocodage BAN (`geo.service.ts`). Notification superadmin par email best-effort **après commit** (mailer générique `sendMail`, jamais de blocage). Ménage des fantômes par un **job nocturne** testable (`runClubJanitor(now)` + wrapper cron `startClubJanitorJob()`), copie du pattern de `reminders.job.ts`.

**Tech Stack:** TypeScript, Prisma 7 (driver adapter), Express, Jest, luxon, node-cron ; Next.js 16 côté front. API publique gratuite `recherche-entreprises.api.gouv.fr` (sans clé).

**Spec :** `docs/superpowers/specs/2026-07-17-siret-garde-creation-club-design.md`

---

## File Structure

**Backend — créés :**
- `backend/src/services/siret.service.ts` — seule porte vers la validation/vérification SIRET (pur `siretIsValidFormat` + réseau `checkSiret`). Miroir de `geo.service.ts`.
- `backend/src/email/templates/clubLifecycle.ts` — 3 builders d'emails purs (nouveau club → superadmins, relance J+15 → gérant, suspension J+30 → gérant).
- `backend/src/jobs/clubJanitor.job.ts` — `runClubJanitor(now)` (testable) + `startClubJanitorJob()` (cron 04:15).
- `backend/prisma/migrations/20260717120000_add_club_siret_guard/migration.sql` — 5 colonnes additives sur `clubs`.
- Tests : `backend/src/services/__tests__/siret.service.test.ts`, `backend/src/email/__tests__/clubLifecycle.test.ts`, `backend/src/jobs/__tests__/clubJanitor.job.test.ts`.

**Backend — modifiés :**
- `backend/prisma/schema.prisma` — 5 champs sur `Club`.
- `backend/src/services/club.service.ts` — `createClub` : params `siret`/`ownerPhone`, gardes, écriture des champs + `User.phone` + `Club.contactPhone`, notification après commit.
- `backend/src/services/platform.service.ts` — `createClubWithOwner` : `siret` optionnel best-effort.
- `backend/src/routes/clubs.ts` — route `POST /` passe `siret`/`ownerPhone` ; codes `SIRET_*` dans `ERROR_STATUS`.
- `backend/src/routes/platform.ts` — `SIRET_INVALID` dans `ERROR_STATUS`.
- `backend/src/app.ts` — démarre `startClubJanitorJob()`.
- Tests existants : `club.service.test.ts`, `platform.service.test.ts`, routes.

**Frontend — créés :**
- `frontend/lib/siret.ts` — `siretIsValidFormat` (miroir client de la validation Luhn).
- Test : `frontend/__tests__/siret.test.ts`.

**Frontend — modifiés :**
- `frontend/app/clubs/new/page.tsx` — champs SIRET + téléphone, Luhn live, mapping d'erreurs.
- `frontend/app/superadmin/clubs/new/page.tsx` — champ SIRET optionnel.
- `frontend/lib/api.ts` — `CreateClubBody` (+`siret`,`ownerPhone`), `CreateClubByPlatformBody` (+`siret?`), `PlatformClubDetail` (+ champs SIRET).
- `frontend/app/superadmin/clubs/[id]/page.tsx` — affichage SIRET / raison sociale / vérifié.
- Tests : `frontend/__tests__/NewClubPage.test.tsx` (existant), `frontend/__tests__/SuperAdminClubsNew.test.tsx` (à créer si absent).

---

## Task 1: Migration `add_club_siret_guard` + schéma Prisma

**Files:**
- Create: `backend/prisma/migrations/20260717120000_add_club_siret_guard/migration.sql`
- Modify: `backend/prisma/schema.prisma` (bloc `model Club`, après `amenities` vers la ligne 255)

- [ ] **Step 1: Écrire le SQL de migration additif**

Create `backend/prisma/migrations/20260717120000_add_club_siret_guard/migration.sql` :

```sql
-- Garde SIRET à la création de club + détection des clubs fantômes (additif, nullable).
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "siret" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "siret_verified_at" TIMESTAMP(3);
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "siret_legal_name" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "setup_reminder_sent_at" TIMESTAMP(3);
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "auto_suspended_at" TIMESTAMP(3);
```

- [ ] **Step 2: Ajouter les 5 champs au modèle `Club`**

In `backend/prisma/schema.prisma`, dans le bloc `model Club { ... }` juste après la ligne `amenities   String[] @default([]) @map("amenities")` :

```prisma
  // Garde anti-tourisme : SIRET du club (self-service) + vérification API d'État.
  // null = club pré-feature ou créé par le superadmin sans SIRET (jamais purgé par le janitor).
  siret               String?   @map("siret")
  siretVerifiedAt     DateTime? @map("siret_verified_at")       // confirmation recherche-entreprises ; null = non vérifié (API indispo)
  siretLegalName      String?   @map("siret_legal_name")        // raison sociale renvoyée par l'API
  setupReminderSentAt DateTime? @map("setup_reminder_sent_at")  // relance J+15 « aucun terrain » envoyée (jamais 2 fois)
  autoSuspendedAt     DateTime? @map("auto_suspended_at")       // suspension auto J+30 faite (jamais 2 fois, même après réactivation)
```

- [ ] **Step 3: Appliquer en DEV + régénérer le client Prisma**

Run (base DEV, dérive connue → jamais `db push`/`migrate dev`) :

```bash
cd backend && node node_modules/prisma/build/index.js db execute --file prisma/migrations/20260717120000_add_club_siret_guard/migration.sql --schema prisma/schema.prisma && node node_modules/prisma/build/index.js generate
```

Expected: `Script executed successfully.` puis `Generated Prisma Client`.

> Si `prisma`/`node ... prisma` échoue (shims cassés), utiliser `npx prisma db execute ...`. Prod : `prisma migrate deploy`.

- [ ] **Step 4: Vérifier que le client typé connaît les nouveaux champs**

Run:

```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "siret|autoSuspended|setupReminder" | head
```

Expected: aucune ligne (les champs existent, pas d'erreur de type les concernant).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260717120000_add_club_siret_guard/
git commit -m "feat(club): schema + migration garde SIRET (add_club_siret_guard)"
```

---

## Task 2: `siret.service.ts` — validation de format pure (Luhn)

**Files:**
- Create: `backend/src/services/siret.service.ts`
- Test: `backend/src/services/__tests__/siret.service.test.ts`

- [ ] **Step 1: Écrire le test de format**

Create `backend/src/services/__tests__/siret.service.test.ts` :

```typescript
import { siretIsValidFormat } from '../siret.service';

describe('siretIsValidFormat', () => {
  it('accepte un SIRET valide (14 chiffres + clé de Luhn)', () => {
    // SIRET de test valide au sens Luhn (Google France, établissement connu).
    expect(siretIsValidFormat('44306184100047')).toBe(true);
  });

  it('rejette une longueur incorrecte', () => {
    expect(siretIsValidFormat('4430618410004')).toBe(false);  // 13
    expect(siretIsValidFormat('443061841000470')).toBe(false); // 15
  });

  it('rejette les caractères non numériques', () => {
    expect(siretIsValidFormat('4430618410004A')).toBe(false);
    expect(siretIsValidFormat('443 061 841 00047')).toBe(false);
  });

  it('rejette une clé de Luhn invalide', () => {
    expect(siretIsValidFormat('44306184100048')).toBe(false);
  });

  it('rejette vide/espace', () => {
    expect(siretIsValidFormat('')).toBe(false);
    expect(siretIsValidFormat('   ')).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test (échec attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js siret.service --silent`
Expected: FAIL — `Cannot find module '../siret.service'`.

- [ ] **Step 3: Implémenter `siretIsValidFormat`**

Create `backend/src/services/siret.service.ts` :

```typescript
// Validation + vérification d'un SIRET français. Seule porte vers l'API entreprises :
// swappable (Sirene INSEE…) sans toucher au reste du code. Miroir géo : geo.service.ts.
const API_URL = 'https://recherche-entreprises.api.gouv.fr/search';
const TIMEOUT_MS = 5000;

/**
 * Vrai si `siret` = exactement 14 chiffres avec une clé de Luhn valide (contrôle hors réseau).
 * Miroir client : frontend/lib/siret.ts — garder les deux synchronisés.
 * NB : les SIRET de La Poste (356 000 000 xxxxx) ne respectent pas Luhn — non géré (hors périmètre padel).
 */
export function siretIsValidFormat(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = siret.charCodeAt(i) - 48; // '0' = 48
    // Luhn : on double un chiffre sur deux en partant de la droite (positions paires depuis la gauche pour 14 chiffres).
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
```

- [ ] **Step 4: Lancer le test (succès attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js siret.service --silent`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/siret.service.ts backend/src/services/__tests__/siret.service.test.ts
git commit -m "feat(club): siret.service — validation de format Luhn"
```

---

## Task 3: `siret.service.ts` — vérification réseau `checkSiret`

**Files:**
- Modify: `backend/src/services/siret.service.ts`
- Test: `backend/src/services/__tests__/siret.service.test.ts`

- [ ] **Step 1: Ajouter les tests réseau (fetch mocké)**

Append to `backend/src/services/__tests__/siret.service.test.ts` :

```typescript
import { checkSiret } from '../siret.service';

describe('checkSiret', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  function mockFetch(body: unknown, ok = true) {
    global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch;
  }

  it('renvoie exists+active+legalName pour un établissement ouvert', async () => {
    mockFetch({ results: [{ nom_complet: 'PADEL ARENA SARL',
      matching_etablissements: [{ siret: '44306184100047', etat_administratif: 'A', libelle_commune: 'PARIS' }] }] });
    const r = await checkSiret('44306184100047');
    expect(r).toEqual({ exists: true, active: true, legalName: 'PADEL ARENA SARL', city: 'PARIS' });
  });

  it('renvoie exists=true, active=false pour un établissement fermé', async () => {
    mockFetch({ results: [{ nom_complet: 'CLUB FERME',
      matching_etablissements: [{ siret: '44306184100047', etat_administratif: 'F', libelle_commune: 'LYON' }] }] });
    const r = await checkSiret('44306184100047');
    expect(r).toEqual({ exists: true, active: false, legalName: 'CLUB FERME', city: 'LYON' });
  });

  it('renvoie exists=false quand aucun établissement ne correspond au SIRET', async () => {
    mockFetch({ results: [] });
    const r = await checkSiret('44306184100047');
    expect(r).toEqual({ exists: false, active: false, legalName: null, city: null });
  });

  it('renvoie null si l\'API répond en erreur HTTP', async () => {
    mockFetch({}, false);
    expect(await checkSiret('44306184100047')).toBeNull();
  });

  it('renvoie null si fetch throw (API injoignable)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    expect(await checkSiret('44306184100047')).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js siret.service --silent`
Expected: FAIL — `checkSiret is not a function` / import manquant.

- [ ] **Step 3: Implémenter `checkSiret`**

Append to `backend/src/services/siret.service.ts` :

```typescript
export interface SiretCheck {
  exists: boolean;       // un établissement correspond EXACTEMENT au SIRET fourni
  active: boolean;       // et son état administratif est « A » (ouvert)
  legalName: string | null;
  city: string | null;
}

interface ApiEtab { siret?: string; etat_administratif?: string; libelle_commune?: string }
interface ApiResult { nom_complet?: string; matching_etablissements?: ApiEtab[] }
interface ApiResponse { results?: ApiResult[] }

/**
 * Interroge recherche-entreprises.api.gouv.fr pour le SIRET donné. Ne throw JAMAIS :
 * renvoie `null` si l'API est injoignable/en erreur (→ le club se crée « non vérifié »).
 * `exists` est vrai seulement si un établissement matche exactement les 14 chiffres.
 */
export async function checkSiret(siret: string): Promise<SiretCheck | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API_URL}?q=${encodeURIComponent(siret)}&per_page=1`, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as ApiResponse;
    const result = data.results?.[0];
    const etab = result?.matching_etablissements?.find((e) => e.siret === siret);
    // Aucun établissement ne matche exactement les 14 chiffres → SIRET introuvable.
    if (!etab) return { exists: false, active: false, legalName: result?.nom_complet ?? null, city: null };
    // Établissement trouvé : `exists` toujours vrai, `active` seulement si état administratif « A » (ouvert).
    // C'est createClub qui distingue SIRET_NOT_FOUND (!exists) de SIRET_INACTIVE (exists && !active).
    const open = etab.etat_administratif === 'A';
    return { exists: true, active: open, legalName: result?.nom_complet ?? null, city: etab.libelle_commune ?? null };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Lancer (succès attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js siret.service --silent`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/siret.service.ts backend/src/services/__tests__/siret.service.test.ts
git commit -m "feat(club): siret.service — checkSiret (API entreprises, jamais throw)"
```

---

## Task 4: Emails de cycle de vie du club (3 builders purs)

**Files:**
- Create: `backend/src/email/templates/clubLifecycle.ts`
- Test: `backend/src/email/__tests__/clubLifecycle.test.ts`

- [ ] **Step 1: Écrire les tests des builders**

Create `backend/src/email/__tests__/clubLifecycle.test.ts` :

```typescript
import { PALOVA_BRAND } from '../templates/layout';
import { buildNewClubEmail, buildClubSetupReminderEmail, buildClubAutoSuspendedEmail } from '../templates/clubLifecycle';

describe('clubLifecycle emails', () => {
  it('buildNewClubEmail : sujet + nom club + badge vérifié + échappement', () => {
    const m = buildNewClubEmail({
      clubName: 'Padel <b>Arena</b>', clubUrl: 'https://arena.palova.fr', city: 'Paris',
      ownerName: 'Jean Test', ownerEmail: 'jean@ex.fr', ownerPhone: '0600000000',
      siret: '44306184100047', legalName: 'ARENA SARL', verified: true,
      url: 'https://palova.fr/superadmin/clubs', brand: PALOVA_BRAND,
    });
    expect(m.subject).toContain('Padel');
    expect(m.html).toContain('&lt;b&gt;Arena&lt;/b&gt;'); // échappé, pas injecté
    expect(m.html).toContain('44306184100047');
    expect(m.text).toContain('vérifié');
    expect(m.text).toContain('0600000000');
  });

  it('buildNewClubEmail : mention « non vérifié » quand verified=false', () => {
    const m = buildNewClubEmail({
      clubName: 'X', clubUrl: 'u', city: null, ownerName: 'O', ownerEmail: 'o@e.fr', ownerPhone: '06',
      siret: '44306184100047', legalName: null, verified: false, url: 'u', brand: PALOVA_BRAND,
    });
    expect(m.text.toLowerCase()).toContain('non vérifié');
  });

  it('buildClubSetupReminderEmail : ton accompagnement + lien admin', () => {
    const m = buildClubSetupReminderEmail({ clubName: 'Mon Club', adminUrl: 'https://c.palova.fr/admin', brand: PALOVA_BRAND });
    expect(m.subject).toContain('Mon Club');
    expect(m.html).toContain('https://c.palova.fr/admin');
  });

  it('buildClubAutoSuspendedEmail : explique la mise en veille', () => {
    const m = buildClubAutoSuspendedEmail({ clubName: 'Mon Club', adminUrl: 'https://c.palova.fr/admin', brand: PALOVA_BRAND });
    expect(m.subject.toLowerCase()).toContain('veille');
    expect(m.text).toContain('Mon Club');
  });
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js clubLifecycle --silent`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter les 3 builders**

Create `backend/src/email/templates/clubLifecycle.ts` :

```typescript
import { Brand, escapeHtml, renderLayout } from './layout';

export interface BuiltEmail { subject: string; html: string; text: string }

export interface NewClubEmailInput {
  clubName: string; clubUrl: string; city: string | null;
  ownerName: string; ownerEmail: string; ownerPhone: string;
  siret: string; legalName: string | null; verified: boolean;
  url: string; brand: Brand;
}

/** Email aux superadmins : un club vient d'être créé en self-service. */
export function buildNewClubEmail(i: NewClubEmailInput): BuiltEmail {
  const badge = i.verified ? '✓ vérifié' : '⚠ non vérifié (API indisponible)';
  const subject = `Nouveau club : ${i.clubName}`;
  const introHtml = `<p style="margin:0;">Un club vient d'être créé sur Palova : <strong>${escapeHtml(i.clubName)}</strong>${i.city ? ` (${escapeHtml(i.city)})` : ''}.</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading: 'Nouveau club créé',
    introHtml,
    infoRows: [
      { label: 'Club', value: i.clubName },
      { label: 'URL', value: i.clubUrl },
      { label: 'Gérant', value: `${i.ownerName} · ${i.ownerEmail} · ${i.ownerPhone}` },
      { label: 'SIRET', value: `${i.siret} — ${badge}` },
      ...(i.legalName ? [{ label: 'Raison sociale', value: i.legalName }] : []),
    ],
    ctaLabel: 'Voir les clubs',
    ctaUrl: i.url,
  });
  const text = [
    'Nouveau club créé', '',
    `Club : ${i.clubName}${i.city ? ` (${i.city})` : ''}`,
    `URL : ${i.clubUrl}`,
    `Gérant : ${i.ownerName} · ${i.ownerEmail} · ${i.ownerPhone}`,
    `SIRET : ${i.siret} — ${badge}`,
    i.legalName ? `Raison sociale : ${i.legalName}` : '',
    '', `Voir les clubs : ${i.url}`,
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}

export interface ClubOwnerEmailInput { clubName: string; adminUrl: string; brand: Brand }

/** Relance J+15 au gérant d'un club encore sans terrain (ton accompagnement). */
export function buildClubSetupReminderEmail(i: ClubOwnerEmailInput): BuiltEmail {
  const subject = `Besoin d'aide pour démarrer ${i.clubName} ?`;
  const introHtml = `<p style="margin:0;">Votre club <strong>${escapeHtml(i.clubName)}</strong> n'a pas encore de terrain. Ajoutez-en un pour ouvrir les réservations — on est là si vous avez besoin d'aide.</p>`;
  const html = renderLayout({
    brand: i.brand, preheader: subject, heading: 'Prêt à démarrer ?',
    introHtml, ctaLabel: 'Configurer mon club', ctaUrl: i.adminUrl,
  });
  const text = [
    'Prêt à démarrer ?', '',
    `Votre club ${i.clubName} n'a pas encore de terrain. Ajoutez-en un pour ouvrir les réservations.`,
    '', `Configurer mon club : ${i.adminUrl}`,
  ].join('\n');
  return { subject, html, text };
}

/** Suspension J+30 au gérant : club mis en veille faute de terrain. */
export function buildClubAutoSuspendedEmail(i: ClubOwnerEmailInput): BuiltEmail {
  const subject = `${i.clubName} a été mis en veille`;
  const introHtml = `<p style="margin:0;">Faute de terrain configuré, <strong>${escapeHtml(i.clubName)}</strong> a été mis en veille. Répondez à cet email ou reconfigurez votre club pour le réactiver.</p>`;
  const html = renderLayout({
    brand: i.brand, preheader: subject, heading: 'Club mis en veille',
    introHtml, ctaLabel: 'Réactiver mon club', ctaUrl: i.adminUrl,
  });
  const text = [
    'Club mis en veille', '',
    `Faute de terrain configuré, ${i.clubName} a été mis en veille. Répondez à cet email pour le réactiver.`,
    '', `Réactiver mon club : ${i.adminUrl}`,
  ].join('\n');
  return { subject, html, text };
}
```

- [ ] **Step 4: Lancer (succès attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js clubLifecycle --silent`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/templates/clubLifecycle.ts backend/src/email/__tests__/clubLifecycle.test.ts
git commit -m "feat(club): emails cycle de vie (nouveau club, relance, mise en veille)"
```

---

## Task 5: `createClub` — SIRET vérifié, téléphone, notification superadmin

**Files:**
- Modify: `backend/src/services/club.service.ts` (interface `CreateClubParams` ~ligne 111 ; méthode `createClub` ~ligne 124 ; imports en tête)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1: Écrire les tests de service**

Add to `backend/src/services/__tests__/club.service.test.ts` un bloc (adapter les mocks au style existant du fichier — `prismaMock`, `jest.mock('../siret.service')`, `jest.mock('../../email/mailer')`) :

```typescript
jest.mock('../siret.service');
jest.mock('../../email/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));

import * as siret from '../siret.service';
import { sendMail } from '../../email/mailer';

const okBody = { ownerId: 'u1', name: 'Padel Arena', siret: '44306184100047', ownerPhone: '0600000000' };

describe('createClub — garde SIRET', () => {
  beforeEach(() => {
    (siret.siretIsValidFormat as jest.Mock).mockReturnValue(true);
    (siret.checkSiret as jest.Mock).mockResolvedValue({ exists: true, active: true, legalName: 'ARENA SARL', city: 'Paris' });
    (sendMail as jest.Mock).mockClear();
    // ... configurer prismaMock.$transaction / club.create / user.findMany superadmins comme dans le fichier
  });

  it('refuse un format SIRET invalide (SIRET_INVALID)', async () => {
    (siret.siretIsValidFormat as jest.Mock).mockReturnValue(false);
    await expect(new ClubService().createClub(okBody)).rejects.toThrow('SIRET_INVALID');
  });

  it('refuse un téléphone manquant (VALIDATION_ERROR)', async () => {
    await expect(new ClubService().createClub({ ...okBody, ownerPhone: '' })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse un SIRET inexistant (SIRET_NOT_FOUND)', async () => {
    (siret.checkSiret as jest.Mock).mockResolvedValue({ exists: false, active: false, legalName: null, city: null });
    await expect(new ClubService().createClub(okBody)).rejects.toThrow('SIRET_NOT_FOUND');
  });

  it('refuse un établissement fermé (SIRET_INACTIVE)', async () => {
    (siret.checkSiret as jest.Mock).mockResolvedValue({ exists: true, active: false, legalName: 'X', city: null });
    await expect(new ClubService().createClub(okBody)).rejects.toThrow('SIRET_INACTIVE');
  });

  it('crée le club « non vérifié » si l\'API est en panne (checkSiret=null)', async () => {
    (siret.checkSiret as jest.Mock).mockResolvedValue(null);
    const club = await new ClubService().createClub(okBody);
    expect(club).toBeDefined(); // pas de throw ; siretVerifiedAt non posé
  });

  it('n\'échoue pas si l\'email superadmin échoue (best-effort)', async () => {
    (sendMail as jest.Mock).mockRejectedValue(new Error('smtp down'));
    await expect(new ClubService().createClub(okBody)).resolves.toBeDefined();
  });
});
```

> Le fichier de test existant a déjà ses helpers de mock Prisma ; réutiliser exactement le même style (ne pas dupliquer un `__mocks__/prisma` s'il est déjà importé en tête du fichier). Le but des assertions : les 3 refus, la création malgré API down, et le best-effort de la notif.

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js club.service --silent -t "garde SIRET"`
Expected: FAIL — `SIRET_INVALID` non levé (params ignorés).

- [ ] **Step 3: Étendre les imports + l'interface de params**

In `backend/src/services/club.service.ts`, ajouter aux imports du haut :

```typescript
import { siretIsValidFormat, checkSiret } from './siret.service';
import { sendMail } from '../email/mailer';
import { buildNewClubEmail } from '../email/templates/clubLifecycle';
import { PALOVA_BRAND } from '../email/templates/layout';
import { clubAppUrl, platformAsset } from '../email/links';
```

Étendre `interface CreateClubParams` :

```typescript
interface CreateClubParams {
  ownerId: string;
  name: string;
  slug?: string;
  address?: string;
  city?: string;
  timezone?: string;
  siret?: string;       // requis en self-service
  ownerPhone?: string;  // requis en self-service
}
```

- [ ] **Step 4: Ajouter les gardes + l'écriture + la notification dans `createClub`**

Dans `createClub`, juste après la validation du slug (`if (RESERVED_SLUGS.has(slug)) throw new Error('SLUG_RESERVED');`) et AVANT le géocodage, insérer :

```typescript
    const siret = (params.siret ?? '').trim();
    const ownerPhone = (params.ownerPhone ?? '').trim();
    if (!siret || !siretIsValidFormat(siret)) throw new Error('SIRET_INVALID');
    if (!ownerPhone) throw new Error('VALIDATION_ERROR');

    // Vérification API d'État HORS transaction. null = API injoignable → club « non vérifié ».
    const siretCheck = await checkSiret(siret);
    if (siretCheck) {
      if (!siretCheck.exists) throw new Error('SIRET_NOT_FOUND');
      if (!siretCheck.active) throw new Error('SIRET_INACTIVE');
    }
```

Restructurer le corps du `try { ... }` de `createClub` : la transaction existante enrichie des nouveaux champs (le club retourné est capturé, puis notifié avant d'être renvoyé). Remplacer le `return await prisma.$transaction(async (tx) => { ... }, { isolationLevel })` par :

```typescript
      const club = await prisma.$transaction(async (tx) => {
        const reserved = await tx.clubSlugAlias.findUnique({ where: { slug }, select: { slug: true } });
        if (reserved) throw new Error('SLUG_TAKEN');

        const created = await tx.club.create({
          data: {
            slug,
            name,
            address: params.address?.trim() || '',
            city: params.city?.trim() || null,
            timezone: params.timezone || 'Europe/Paris',
            siret,
            contactPhone: ownerPhone,
            ...(siretCheck ? { siretVerifiedAt: new Date(), siretLegalName: siretCheck.legalName } : {}),
            ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, department: geo.department, departmentCode: geo.departmentCode, postalCode: geo.postalCode } : {}),
          },
        });
        await tx.clubMember.create({ data: { userId: params.ownerId, clubId: created.id, role: 'OWNER' } });
        await tx.user.update({ where: { id: params.ownerId }, data: { phone: ownerPhone } });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      // Notification superadmin APRÈS commit, best-effort (un échec SMTP n'annule jamais la création).
      await this.notifyNewClub(club, { ownerId: params.ownerId, siret, ownerPhone, verified: !!siretCheck, legalName: siretCheck?.legalName ?? null })
        .catch((e) => console.error('[club] notif nouveau club échouée', (e as Error).message));

      return club;
```

> Le `catch (err)` existant (mapping `P2002` → `SLUG_TAKEN`) reste inchangé après ce bloc.

- [ ] **Step 5: Ajouter la méthode privée `notifyNewClub`**

Ajouter dans la classe `ClubService` (après `createClub`) :

```typescript
  /** Prévient tous les superadmins qu'un club a été créé en self-service (email best-effort). */
  private async notifyNewClub(
    club: { id: string; slug: string; name: string; city: string | null },
    ctx: { ownerId: string; siret: string; ownerPhone: string; verified: boolean; legalName: string | null },
  ): Promise<void> {
    const [owner, admins] = await Promise.all([
      prisma.user.findUnique({ where: { id: ctx.ownerId }, select: { firstName: true, lastName: true, email: true } }),
      prisma.user.findMany({ where: { isSuperAdmin: true, deletedAt: null }, select: { email: true } }),
    ]);
    const recipients = admins.map((a) => a.email).filter(Boolean) as string[];
    if (!recipients.length) return;
    const mail = buildNewClubEmail({
      clubName: club.name,
      clubUrl: clubAppUrl(club.slug),
      city: club.city,
      ownerName: `${owner?.firstName ?? ''} ${owner?.lastName ?? ''}`.trim(),
      ownerEmail: owner?.email ?? '',
      ownerPhone: ctx.ownerPhone,
      siret: ctx.siret,
      legalName: ctx.legalName,
      verified: ctx.verified,
      url: platformAsset('/superadmin/clubs'),
      brand: PALOVA_BRAND,
    });
    for (const to of recipients) {
      await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    }
  }
```

> `city` doit être dans le `select`/retour du `tx.club.create` (ajouter `city` au `select` si `create` en a un ; sinon le club renvoyé contient déjà tous les champs). Vérifier que `club.create` retourne `city` (par défaut Prisma retourne toutes les colonnes scalaires — OK).

- [ ] **Step 6: Lancer (succès attendu) + type-check**

Run: `cd backend && node node_modules/jest/bin/jest.js club.service --silent`
Then: `cd backend && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "club.service" | head`
Expected: tests PASS ; aucune erreur tsc sur `club.service.ts`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(club): createClub exige SIRET verifie + telephone + notif superadmin"
```

---

## Task 6: Route `POST /api/clubs` — passer SIRET/téléphone + codes d'erreur

**Files:**
- Modify: `backend/src/routes/clubs.ts` (route `router.post('/', ...)` ~ligne 136 ; `ERROR_STATUS` ~ligne 62)
- Test: `backend/src/routes/__tests__/clubs.routes.test.ts` (ou fichier de tests de route existant pour clubs)

- [ ] **Step 1: Écrire le test de route**

Add to the clubs route test (mock `clubService.createClub`) :

```typescript
it('POST /api/clubs → 400 SIRET_INVALID', async () => {
  (clubService.createClub as jest.Mock).mockRejectedValue(new Error('SIRET_INVALID'));
  const res = await request(app).post('/api/clubs').set('Authorization', 'Bearer t')
    .send({ name: 'X', siret: 'bad', ownerPhone: '06' });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('SIRET_INVALID');
});

it('POST /api/clubs → transmet siret + ownerPhone au service', async () => {
  (clubService.createClub as jest.Mock).mockResolvedValue({ id: 'c1', slug: 's' });
  await request(app).post('/api/clubs').set('Authorization', 'Bearer t')
    .send({ name: 'X', siret: '44306184100047', ownerPhone: '0600000000' });
  expect(clubService.createClub).toHaveBeenCalledWith(expect.objectContaining({ siret: '44306184100047', ownerPhone: '0600000000' }));
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js clubs.routes --silent -t SIRET`
Expected: FAIL — 400 attendu mais 500 (code non mappé) ou params non transmis.

- [ ] **Step 3: Ajouter les codes SIRET à `ERROR_STATUS`**

In `backend/src/routes/clubs.ts`, dans l'objet `ERROR_STATUS`, après `VALIDATION_ERROR: 400,` :

```typescript
  SIRET_INVALID:         400,
  SIRET_NOT_FOUND:       400,
  SIRET_INACTIVE:        400,
```

- [ ] **Step 4: Transmettre `siret` + `ownerPhone` dans la route**

Remplacer le corps de `router.post('/', ...)` :

```typescript
router.post('/', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, slug, address, city, timezone, siret, ownerPhone } = req.body;
    const club = await clubService.createClub({ ownerId: req.user!.id, name, slug, address, city, timezone, siret, ownerPhone });
    res.status(201).json(club);
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 5: Lancer (succès attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js clubs.routes --silent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.routes.test.ts
git commit -m "feat(club): route POST /api/clubs relaie SIRET + telephone (codes 400)"
```

---

## Task 7: Superadmin — `createClubWithOwner` accepte un SIRET optionnel best-effort

**Files:**
- Modify: `backend/src/services/platform.service.ts` (`CreateClubByPlatformParams` ~ligne 10 ; `createClubWithOwner` ~ligne 277 ; imports)
- Modify: `backend/src/routes/platform.ts` (`ERROR_STATUS` ~ligne 18)
- Test: `backend/src/services/__tests__/platform.service.test.ts`

- [ ] **Step 1: Écrire les tests**

Add to `platform.service.test.ts` (mock `../siret.service`) :

```typescript
it('createClubWithOwner : SIRET absent → club créé (siret null)', async () => {
  // configurer les mocks de création comme les tests existants
  const r = await new PlatformService().createClubWithOwner(baseParams); // sans club.siret
  expect(r.club).toBeDefined();
});

it('createClubWithOwner : SIRET au mauvais format → SIRET_INVALID', async () => {
  (siret.siretIsValidFormat as jest.Mock).mockReturnValue(false);
  await expect(new PlatformService().createClubWithOwner({ ...baseParams, club: { ...baseParams.club, siret: 'bad' } }))
    .rejects.toThrow('SIRET_INVALID');
});

it('createClubWithOwner : SIRET valide mais API inexistante → club créé quand même (best-effort)', async () => {
  (siret.siretIsValidFormat as jest.Mock).mockReturnValue(true);
  (siret.checkSiret as jest.Mock).mockResolvedValue({ exists: false, active: false, legalName: null, city: null });
  const r = await new PlatformService().createClubWithOwner({ ...baseParams, club: { ...baseParams.club, siret: '44306184100047' } });
  expect(r.club).toBeDefined(); // superadmin souverain : ni NOT_FOUND ni INACTIVE
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js platform.service --silent -t SIRET`
Expected: FAIL.

- [ ] **Step 3: Étendre params + imports + logique**

In `platform.service.ts`, ajouter à l'import géo :

```typescript
import { siretIsValidFormat, checkSiret } from './siret.service';
```

Étendre `CreateClubByPlatformParams.club` : `sportKey?: string; siret?: string;`.

Dans `createClubWithOwner`, après le calcul du slug et avant le géocodage :

```typescript
    const siret = (params.club?.siret ?? '').trim();
    let siretLegalName: string | null = null;
    let siretVerifiedAt: Date | null = null;
    if (siret) {
      if (!siretIsValidFormat(siret)) throw new Error('SIRET_INVALID');
      const check = await checkSiret(siret); // best-effort : le superadmin est souverain
      if (check) { siretVerifiedAt = new Date(); siretLegalName = check.legalName; }
    }
```

Dans `tx.club.create({ data: { ... } })`, ajouter :

```typescript
            ...(siret ? { siret, siretLegalName, ...(siretVerifiedAt ? { siretVerifiedAt } : {}) } : {}),
```

- [ ] **Step 4: Ajouter `SIRET_INVALID` au map d'erreurs plateforme**

In `backend/src/routes/platform.ts`, dans `ERROR_STATUS`, après `VALIDATION_ERROR: 400,` :

```typescript
  SIRET_INVALID:    400,
```

- [ ] **Step 5: Lancer (succès attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js platform.service --silent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/platform.service.ts backend/src/routes/platform.ts backend/src/services/__tests__/platform.service.test.ts
git commit -m "feat(club): superadmin createClubWithOwner accepte un SIRET optionnel (best-effort)"
```

---

## Task 8: Job nocturne — ménage des clubs fantômes (relance J+15, suspension J+30)

**Files:**
- Create: `backend/src/jobs/clubJanitor.job.ts`
- Modify: `backend/src/app.ts` (imports ~ligne 22 ; boot ~ligne 116)
- Test: `backend/src/jobs/__tests__/clubJanitor.job.test.ts`

- [ ] **Step 1: Écrire le test du job**

Create `backend/src/jobs/__tests__/clubJanitor.job.test.ts` (mirror `reminders.job.test.ts`) :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../../email/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
import { sendMail } from '../../email/mailer';
import { runClubJanitor, REMINDER_DAYS, SUSPEND_DAYS } from '../clubJanitor.job';

const now = new Date('2026-08-01T04:15:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

describe('runClubJanitor', () => {
  beforeEach(() => {
    (sendMail as jest.Mock).mockClear();
    prismaMock.club.findMany.mockResolvedValue([]);
    prismaMock.club.update.mockResolvedValue({} as any);
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  it('relance un club sans terrain à J+15 (email + setupReminderSentAt)', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      { id: 'c1', slug: 's1', name: 'Club Un', createdAt: daysAgo(16), setupReminderSentAt: null, autoSuspendedAt: null,
        members: [{ user: { email: 'o@e.fr' } }] },
    ] as any);
    await runClubJanitor(now);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'o@e.fr' }));
    expect(prismaMock.club.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1' }, data: expect.objectContaining({ setupReminderSentAt: now }),
    }));
  });

  it('suspend un club relancé il y a plus de 7 j et vieux de 30 j', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      { id: 'c2', slug: 's2', name: 'Club Deux', createdAt: daysAgo(31), setupReminderSentAt: daysAgo(10), autoSuspendedAt: null,
        members: [{ user: { email: 'o2@e.fr' } }] },
    ] as any);
    await runClubJanitor(now);
    expect(prismaMock.club.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c2' }, data: expect.objectContaining({ status: 'SUSPENDED', autoSuspendedAt: now }),
    }));
  });

  it('ne suspend pas un club relancé il y a moins de 7 j', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      { id: 'c3', slug: 's3', name: 'C3', createdAt: daysAgo(31), setupReminderSentAt: daysAgo(3), autoSuspendedAt: null, members: [] },
    ] as any);
    await runClubJanitor(now);
    expect(prismaMock.club.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUSPENDED' }) }));
  });

  it('continue si un email échoue (best-effort)', async () => {
    (sendMail as jest.Mock).mockRejectedValue(new Error('smtp'));
    prismaMock.club.findMany.mockResolvedValue([
      { id: 'c4', slug: 's4', name: 'C4', createdAt: daysAgo(16), setupReminderSentAt: null, autoSuspendedAt: null, members: [{ user: { email: 'o@e.fr' } }] },
    ] as any);
    await expect(runClubJanitor(now)).resolves.not.toThrow();
  });
});
```

> Le `where` du `findMany` filtre déjà `siret: { not: null }`, `status: 'ACTIVE'`, `resources: { none: {} }`, `autoSuspendedAt: null` — donc le test n'a pas à fournir de clubs `siret null`/avec terrain (ils ne remontent jamais). Les assertions portent sur le tri relance vs suspension.

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js clubJanitor --silent`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le job**

Create `backend/src/jobs/clubJanitor.job.ts` :

```typescript
import cron from 'node-cron';
import { prisma } from '../db/prisma';
import { sendMail } from '../email/mailer';
import { buildClubSetupReminderEmail, buildClubAutoSuspendedEmail } from '../email/templates/clubLifecycle';
import { PALOVA_BRAND } from '../email/templates/layout';
import { clubAppUrl } from '../email/links';

export const REMINDER_DAYS = 15; // relance : club sans terrain depuis 15 j
export const SUSPEND_DAYS = 30;  // suspension : depuis 30 j ET relancé il y a ≥ 7 j
const MIN_GAP_DAYS = 7;          // délai plancher garanti entre relance et suspension

const dayMs = 86400000;

/**
 * Ménage des clubs fantômes. Cible : club ACTIVE, avec SIRET (self-service), SANS aucun
 * terrain, jamais auto-suspendu. Relance à J+15, suspend à J+30 (si relancé il y a ≥ 7 j).
 * best-effort par club — un email en échec ne bloque pas les autres. Testable (now injecté).
 */
export async function runClubJanitor(now: Date): Promise<void> {
  const clubs = await prisma.club.findMany({
    where: {
      status: 'ACTIVE',
      siret: { not: null },
      autoSuspendedAt: null,
      resources: { none: {} },
    },
    select: {
      id: true, slug: true, name: true, createdAt: true, setupReminderSentAt: true,
      members: { where: { role: 'OWNER' }, select: { user: { select: { email: true } } } },
    },
  });

  const reminderBefore = new Date(now.getTime() - REMINDER_DAYS * dayMs);
  const suspendBefore = new Date(now.getTime() - SUSPEND_DAYS * dayMs);
  const gapBefore = new Date(now.getTime() - MIN_GAP_DAYS * dayMs);

  for (const club of clubs) {
    const ownerEmail = club.members[0]?.user?.email ?? null;
    const adminUrl = clubAppUrl(club.slug, '/admin');
    try {
      // Suspension : vieux de 30 j ET relancé il y a ≥ 7 j.
      if (club.setupReminderSentAt && club.createdAt < suspendBefore && club.setupReminderSentAt < gapBefore) {
        await prisma.club.update({ where: { id: club.id }, data: { status: 'SUSPENDED', autoSuspendedAt: now } });
        if (ownerEmail) {
          const mail = buildClubAutoSuspendedEmail({ clubName: club.name, adminUrl, brand: PALOVA_BRAND });
          await sendMail({ to: ownerEmail, subject: mail.subject, html: mail.html, text: mail.text });
        }
        continue;
      }
      // Relance : vieux de 15 j et jamais relancé.
      if (!club.setupReminderSentAt && club.createdAt < reminderBefore) {
        await prisma.club.update({ where: { id: club.id }, data: { setupReminderSentAt: now } });
        if (ownerEmail) {
          const mail = buildClubSetupReminderEmail({ clubName: club.name, adminUrl, brand: PALOVA_BRAND });
          await sendMail({ to: ownerEmail, subject: mail.subject, html: mail.html, text: mail.text });
        }
      }
    } catch (err) {
      console.error(`[janitor] club ${club.id} :`, (err as Error).message);
    }
  }
}

export function startClubJanitorJob(): void {
  // 04:15 Europe/Paris chaque nuit (après les autres jobs nocturnes).
  cron.schedule('15 4 * * *', () => {
    runClubJanitor(new Date()).catch((err) => console.error('[janitor] échec:', (err as Error).message));
  }, { timezone: 'Europe/Paris' });
  console.log('[janitor] Job de ménage des clubs démarré (04:15 chaque nuit)');
}
```

> ⚠️ L'ordre suspension-avant-relance dans la boucle est volontaire : un club de 31 j déjà relancé va en suspension ; un club de 16 j jamais relancé va en relance. Le `continue` évite de relancer un club qu'on vient de suspendre.

- [ ] **Step 4: Câbler le job au démarrage**

In `backend/src/app.ts`, ajouter l'import après la ligne `import { startPlatformBillingJob } from './jobs/platformBilling.job';` :

```typescript
import { startClubJanitorJob } from './jobs/clubJanitor.job';
```

Et dans le bloc `app.listen(...)`, après `startPlatformBillingJob();` :

```typescript
        startClubJanitorJob();
```

- [ ] **Step 5: Lancer (succès attendu)**

Run: `cd backend && node node_modules/jest/bin/jest.js clubJanitor --silent`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/jobs/clubJanitor.job.ts backend/src/jobs/__tests__/clubJanitor.job.test.ts backend/src/app.ts
git commit -m "feat(club): job nocturne de menage des clubs fantomes (relance J+15, suspension J+30)"
```

---

## Task 9: Frontend — `lib/siret.ts` (miroir client de la validation Luhn)

**Files:**
- Create: `frontend/lib/siret.ts`
- Test: `frontend/__tests__/siret.test.ts`

- [ ] **Step 1: Écrire le test**

Create `frontend/__tests__/siret.test.ts` :

```typescript
import { siretIsValidFormat } from '@/lib/siret';

describe('siretIsValidFormat (front)', () => {
  it('accepte un SIRET valide', () => { expect(siretIsValidFormat('44306184100047')).toBe(true); });
  it('rejette longueur/format', () => {
    expect(siretIsValidFormat('4430618410004')).toBe(false);
    expect(siretIsValidFormat('4430618410004A')).toBe(false);
  });
  it('rejette clé de Luhn invalide', () => { expect(siretIsValidFormat('44306184100048')).toBe(false); });
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd frontend && node node_modules/jest/bin/jest.js siret --silent`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter (copie exacte du backend)**

Create `frontend/lib/siret.ts` :

```typescript
/**
 * Vrai si `siret` = 14 chiffres avec clé de Luhn valide (validation locale, avant envoi).
 * Miroir de backend/src/services/siret.service.ts `siretIsValidFormat` — garder synchro.
 * La vérification API d'État reste faite côté serveur (seule source de vérité).
 */
export function siretIsValidFormat(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = siret.charCodeAt(i) - 48;
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
```

- [ ] **Step 4: Lancer (succès attendu)**

Run: `cd frontend && node node_modules/jest/bin/jest.js siret --silent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/siret.ts frontend/__tests__/siret.test.ts
git commit -m "feat(club): lib/siret front (miroir validation Luhn)"
```

---

## Task 10: Frontend `/clubs/new` — champs SIRET + téléphone, Luhn live, erreurs

**Files:**
- Modify: `frontend/lib/api.ts` (`CreateClubBody` ~ligne 1611)
- Modify: `frontend/app/clubs/new/page.tsx`
- Test: `frontend/__tests__/NewClubPage.test.tsx`

- [ ] **Step 1: Étendre le type `CreateClubBody`**

In `frontend/lib/api.ts` :

```typescript
export interface CreateClubBody {
  name: string;
  slug?: string;
  address?: string;
  city?: string;
  timezone?: string;
  siret: string;        // requis en self-service
  ownerPhone: string;   // requis en self-service
}
```

- [ ] **Step 2: Écrire/étendre le test de page**

Add to `frontend/__tests__/NewClubPage.test.tsx` (mock `api.createClub`, `api.register`, `@/lib/siret` réel) :

```typescript
it('bloque la soumission tant que le SIRET est invalide', async () => {
  render(<NewClubPage />);
  fireEvent.change(screen.getByLabelText(/club/i), { target: { value: 'X' } });
  fireEvent.change(screen.getByLabelText(/SIRET/i), { target: { value: '123' } });
  fireEvent.change(screen.getByLabelText(/t[ée]l[ée]phone/i), { target: { value: '0600000000' } });
  fireEvent.change(screen.getByLabelText(/mot de passe/i), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: /cr[ée]er/i }));
  expect(await screen.findByText(/SIRET.*invalide/i)).toBeInTheDocument();
  expect(api.register).not.toHaveBeenCalled();
});

it('mappe SIRET_NOT_FOUND renvoyé à la création du club', async () => {
  (api.createClub as jest.Mock).mockRejectedValue(new Error('SIRET_NOT_FOUND'));
  // … dérouler jusqu'à finishClub (après verify) et vérifier le message « n'existe pas »
});
```

> Adapter au style du fichier existant (helpers de rendu, mocks de `VerifyCodeForm`). Le point clé testé : garde Luhn côté client + mapping des messages `SIRET_*`.

- [ ] **Step 3: Ajouter les champs + la garde + le mapping**

In `frontend/app/clubs/new/page.tsx` :

Imports (haut) : `import { siretIsValidFormat } from '@/lib/siret';`

États (après `const [city, setCity] = useState('');`) :

```typescript
  const [siret, setSiret] = useState('');
  const [phone, setPhone] = useState('');
```

Dans `handleSubmit`, après le check du mot de passe :

```typescript
    if (!siretIsValidFormat(siret.trim())) { setError('Le numéro SIRET est invalide (14 chiffres).'); return; }
    if (!phone.trim()) { setError('Le téléphone du gérant est requis.'); return; }
```

Dans `finishClub`, passer les champs à `createClub` :

```typescript
      const club = await api.createClub({ name: clubName, city: city || undefined, siret: siret.trim(), ownerPhone: phone.trim() }, auth.token);
```

Et étendre le `catch` de `finishClub` avec les messages SIRET :

```typescript
        msg === 'SIRET_INVALID' ? 'Le numéro SIRET est invalide (14 chiffres).'
        : msg === 'SIRET_NOT_FOUND' ? "Ce SIRET n'existe pas dans le répertoire des entreprises."
        : msg === 'SIRET_INACTIVE' ? 'Cet établissement est fermé administrativement.'
        : msg === 'SLUG_TAKEN' ? 'Un club porte déjà ce nom. Essayez une variante.'
        : msg === 'VALIDATION_ERROR' ? 'Champs du club invalides.'
        : msg,
```

Dans le JSX du formulaire (près des champs club), ajouter les deux `Field` (avec aide SIRET) :

```tsx
        <Field label="SIRET du club" value={siret} onChange={setSiret} required
          placeholder="14 chiffres — visible sur votre Kbis ou annuaire-entreprises.data.gouv.fr" />
        <Field label="Téléphone du gérant" type="tel" value={phone} onChange={setPhone} required />
```

- [ ] **Step 4: Lancer (succès attendu) + tsc ciblé**

Run: `cd frontend && node node_modules/jest/bin/jest.js NewClubPage --silent`
Then: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -iE "clubs/new|lib/api" | head`
Expected: tests PASS ; pas d'erreur tsc sur ces fichiers.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts frontend/app/clubs/new/page.tsx frontend/__tests__/NewClubPage.test.tsx
git commit -m "feat(club): /clubs/new exige SIRET (Luhn live) + telephone du gerant"
```

---

## Task 11: Frontend superadmin — SIRET optionnel + affichage sur la fiche club

**Files:**
- Modify: `frontend/lib/api.ts` (`CreateClubByPlatformBody`, `PlatformClubDetail` ~ligne 2697)
- Modify: `frontend/app/superadmin/clubs/new/page.tsx`
- Modify: `frontend/app/superadmin/clubs/[id]/page.tsx`
- Modify: `backend/src/services/platform.service.ts` (`getClubDetail` select + retour)
- Test: `frontend/__tests__/SuperAdminClubsNew.test.tsx`

- [ ] **Step 1: Étendre les types front**

In `frontend/lib/api.ts`, dans `CreateClubByPlatformBody.club`, ajouter `siret?: string;`.
Dans `PlatformClubDetail`, ajouter :

```typescript
  siret: string | null;
  siretLegalName: string | null;
  siretVerifiedAt: string | null;
```

- [ ] **Step 2: Exposer les champs dans `getClubDetail` (backend)**

In `backend/src/services/platform.service.ts`, dans le `select` de `getClubDetail` (identité du club), ajouter `siret: true, siretLegalName: true, siretVerifiedAt: true,` et les reporter dans l'objet retourné (`siret: club.siret, siretLegalName: club.siretLegalName, siretVerifiedAt: club.siretVerifiedAt?.toISOString() ?? null`). Adapter la forme au mapping existant de la méthode.

- [ ] **Step 3: Écrire le test du formulaire superadmin**

Create `frontend/__tests__/SuperAdminClubsNew.test.tsx` (mock `api.platformCreateClub`, `useAuth`) :

```typescript
it('transmet un SIRET optionnel si saisi', async () => {
  (api.platformCreateClub as jest.Mock).mockResolvedValue({ club: { id: 'c', slug: 's', name: 'X' }, owner: { id: 'o', email: 'e' } });
  render(<NewClubByPlatform />);
  fireEvent.change(screen.getByLabelText(/Nom du club/i), { target: { value: 'X' } });
  fireEvent.change(screen.getByLabelText(/SIRET/i), { target: { value: '44306184100047' } });
  fireEvent.change(screen.getByLabelText(/Pr[ée]nom/i), { target: { value: 'A' } });
  fireEvent.change(screen.getByLabelText(/^Nom$/i), { target: { value: 'B' } });
  fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'a@b.fr' } });
  fireEvent.change(screen.getByLabelText(/Mot de passe/i), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: /cr[ée]er/i }));
  await waitFor(() => expect(api.platformCreateClub).toHaveBeenCalledWith(
    expect.objectContaining({ club: expect.objectContaining({ siret: '44306184100047' }) }), expect.anything()));
});
```

- [ ] **Step 4: Lancer (échec attendu)**

Run: `cd frontend && node node_modules/jest/bin/jest.js SuperAdminClubsNew --silent`
Expected: FAIL — champ SIRET absent / non transmis.

- [ ] **Step 5: Ajouter le champ SIRET optionnel au formulaire superadmin**

In `frontend/app/superadmin/clubs/new/page.tsx` :

État : `const [siret, setSiret] = useState('');`
Dans `submit`, l'appel devient :

```typescript
      await api.platformCreateClub({
        club: { name, city: city || undefined, sportKey, siret: siret.trim() || undefined },
        owner: { firstName, lastName, email, password },
      }, token);
```

Mapping d'erreur : ajouter `: m === 'SIRET_INVALID' ? 'SIRET invalide (14 chiffres)'` dans la chaîne du `catch`.
JSX (après le champ Ville) :

```tsx
        <Field label="SIRET (optionnel)" value={siret} onChange={setSiret} placeholder="14 chiffres" />
```

- [ ] **Step 6: Afficher le SIRET sur la fiche club superadmin**

In `frontend/app/superadmin/clubs/[id]/page.tsx`, dans la section identité du club, ajouter une ligne (adapter au style d'affichage existant des attributs) :

```tsx
        {club.siret && (
          <div style={{ fontSize: 13, color: th.textMute }}>
            SIRET : {club.siret}{club.siretLegalName ? ` · ${club.siretLegalName}` : ''}
            {' · '}{club.siretVerifiedAt ? 'vérifié' : 'non vérifié'}
          </div>
        )}
```

- [ ] **Step 7: Lancer (succès attendu) + tsc ciblé**

Run: `cd frontend && node node_modules/jest/bin/jest.js SuperAdminClubsNew --silent`
Then: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -iE "superadmin/clubs|lib/api" | head`
Expected: tests PASS ; pas d'erreur tsc sur ces fichiers.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/api.ts frontend/app/superadmin/clubs/ backend/src/services/platform.service.ts frontend/__tests__/SuperAdminClubsNew.test.tsx
git commit -m "feat(club): superadmin — SIRET optionnel a la creation + affichage fiche club"
```

---

## Task 12: Vérification finale (suites ciblées + type-check)

**Files:** aucun (validation).

- [ ] **Step 1: Suites backend touchées**

Run: `cd backend && node node_modules/jest/bin/jest.js siret.service clubLifecycle club.service platform.service clubJanitor clubs.routes --silent`
Expected: toutes PASS.

- [ ] **Step 2: Suites frontend touchées**

Run: `cd frontend && node node_modules/jest/bin/jest.js siret NewClubPage SuperAdminClubsNew --silent`
Expected: toutes PASS.

- [ ] **Step 3: Type-check des deux packages (ciblé sur les fichiers modifiés)**

Run:
```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "siret|club.service|platform.service|clubJanitor|clubLifecycle" | head
cd ../frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -iE "siret|clubs/new|superadmin/clubs|lib/api" | head
```
Expected: aucune ligne (pas d'erreur sur les fichiers du lot ; le repo a du WIP parallèle, ne pas s'alarmer d'erreurs hors périmètre).

- [ ] **Step 4: Commit final éventuel (si des ajustements ont été faits)**

```bash
git add -A && git commit -m "test(club): verification finale garde SIRET + janitor" || echo "rien à committer"
```

---

## Notes d'exécution

- **Migrations** : DEV via `prisma db execute` (jamais `db push`/`migrate dev` — base partagée + dérive) ; prod `migrate deploy`. Après application → `prisma generate` sinon le client typé ignore les nouveaux champs.
- **Shims cassés** : si `node node_modules/jest/bin/jest.js` ou `.../tsc` échouent, tenter `npx jest`/`npx tsc`. La cwd PowerShell se réinitialise entre commandes — préfixer par `cd backend &&` / `cd frontend &&`.
- **WIP parallèle** : le working tree contient d'autres modifications (frontend). Toujours `git add` avec des **chemins explicites**, jamais `git add -A` au milieu du lot.
- **Flake connu** : la suite complète `jest` frontend montre ~6 échecs BookingModal d'isolation pré-existants — vérifier par suites ciblées, pas par run complet.
- **Hors périmètre (spec §7)** : identifiants non-FR, numéro FFT, backfill SIRET des clubs existants, purge des comptes démo prod, rate-limit création. Ne pas les implémenter ici.
