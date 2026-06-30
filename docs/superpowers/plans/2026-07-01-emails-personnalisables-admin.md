# Emails automatiques personnalisables par club — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à chaque club de personnaliser, depuis `/admin/emails`, le HTML de ses ~17 emails automatiques (objet, titre, corps HTML, bouton), avec variables `{{…}}`, aperçu et envoi de test, repli sur le défaut codé.

**Architecture:** Un **registre de définitions** (`backend/src/email/registry.ts`) décrit chaque type d'email (défauts + variables) et expose un moteur unique `renderClubEmail(type, vars, brand, override?)` qui fusionne défaut + surcharge club, substitue les variables, assainit le corps personnalisé, puis passe par le `renderLayout` existant. Une table `ClubEmailTemplate` stocke les surcharges (repli = défaut). `notifications.ts` passe un objet `vars` au moteur au lieu d'appeler des builders figés. Une page admin (OWNER/ADMIN) édite/aperçoit/teste.

**Tech Stack:** Express 5 + Prisma 7 (Postgres), Jest + ts-jest + supertest + jest-mock-extended (backend) ; Next.js 16 + React 19 + Jest/RTL (frontend) ; nouvelle dép `sanitize-html`.

**Spec:** `docs/superpowers/specs/2026-07-01-emails-personnalisables-admin-design.md`

---

## Rappels de contexte codebase (lire avant de commencer)

- **Migrations** : la base dev a une **dérive** connue → **ne pas** utiliser `prisma migrate dev`. On écrit le SQL additif à la main puis `npx prisma migrate deploy` + `npx prisma generate` (cf. mémoire projet « Prisma: migrate deploy, not migrate dev »). Si OneDrive a amputé `node_modules/.prisma`, couper OneDrive puis `npm install && npx prisma generate`.
- **Prisma 7** : l'adaptateur `PrismaPg` est déjà câblé dans `src/db/prisma.ts` — ne pas y toucher.
- **Tests backend** : mock Prisma global via `import '../../__mocks__/prisma'` + `prismaMock`. Lancer un fichier : `cd backend && npx jest <chemin>`.
- **Tests frontend** : le run complet `npx jest` a un **flake connu** sur `BookingModal` (isolation). Vérifier par **suites ciblées** + `npx tsc --noEmit` (cf. mémoire « Frontend full-suite BookingModal flake »).
- **Next.js 16** : avant d'écrire du code frontend, consulter `frontend/node_modules/next/dist/docs/` (cf. `frontend/AGENTS.md` — « This is NOT the Next.js you know »).
- **Routes admin** : montées sur `/api/clubs/:clubId/admin`, protégées par `authMiddleware, requireClubMember('STAFF')` (niveau routeur). Pour restreindre à OWNER/ADMIN, ajouter `requireClubMember('ADMIN')` comme 2ᵉ middleware sur la route (pattern broadcast, `admin.ts:1049`). `req.membership!.clubId` et `req.user!.id` sont disponibles.
- **`renderLayout(input: LayoutInput)`** et `InfoRow`, `escapeHtml`, `Brand`, `PALOVA_BRAND` sont dans `backend/src/email/templates/layout.ts` (ne pas modifier).
- **`absoluteAsset`, `clubAppUrl`, `formatDateRangeFr`** sont dans `backend/src/email/links.ts`.

## Structure des fichiers

**Backend**
- `prisma/schema.prisma` — + modèle `ClubEmailTemplate`, + relation inverse sur `Club`.
- `prisma/migrations/<ts>_add_club_email_templates/migration.sql` — **nouveau** (SQL additif).
- `src/email/registry.ts` — **nouveau** : types `EmailVar`/`EmailDef`, `EMAIL_DEFS`, helpers de substitution/assainissement, `brandFromClub`, `renderClubEmail`, `sampleVars`.
- `src/services/emailTemplate.service.ts` — **nouveau** : `EmailTemplateService` (+ singleton `emailTemplates`).
- `src/email/notifications.ts` — bascule des call-sites sur `renderClubEmail` + `getOverride`.
- `src/email/templates/emails.ts` — retrait des **builders club**, conservation de `buildVerificationEmail`/`buildPasswordResetEmail`/`buildBroadcastEmail` + `stripTags`.
- `src/routes/admin.ts` — + 6 routes `/emails*`, + `EMAIL_TYPE_UNKNOWN` dans `ERROR_STATUS`.
- `package.json` — + `sanitize-html`, `@types/sanitize-html`.

**Frontend**
- `lib/api.ts` — types `AdminEmailSummary`/`AdminEmailDetail`/`EmailDraft`/`EmailVarDef` + méthodes.
- `app/admin/layout.tsx` — entrée nav « Emails ».
- `app/admin/emails/page.tsx` — **nouveau** : liste groupée.
- `app/admin/emails/[type]/page.tsx` — **nouveau** : éditeur + aperçu + test.
- `components/admin/email/EmailPreview.tsx` — **nouveau** : iframe d'aperçu.
- `__tests__/AdminEmails.test.tsx`, `__tests__/AdminEmailEditor.test.tsx` — **nouveaux**.

---

## Task 1: Dépendance `sanitize-html`

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Installer la dépendance**

Run:
```bash
cd backend && npm install sanitize-html && npm install -D @types/sanitize-html
```
Expected: `package.json` gagne `sanitize-html` (deps) et `@types/sanitize-html` (devDeps), install OK.

- [ ] **Step 2: Vérifier l'import**

Run:
```bash
cd backend && node -e "require('sanitize-html'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore(email): add sanitize-html dependency"
```

---

## Task 2: Modèle Prisma `ClubEmailTemplate` + migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (après `model ClubBroadcast`, ~ligne 1275 ; + relation inverse dans `model Club`)
- Create: `backend/prisma/migrations/<timestamp>_add_club_email_templates/migration.sql`

- [ ] **Step 1: Ajouter le modèle au schéma**

Dans `schema.prisma`, après le bloc `model ClubBroadcast { … }` :

```prisma
/// Surcharge d'un email automatique pour un club (repli = défaut codé si absent).
model ClubEmailTemplate {
  id         String   @id @default(cuid())
  clubId     String   @map("club_id")
  type       String
  subject    String
  heading    String
  bodyHtml   String   @map("body_html") @db.Text
  ctaLabel   String?  @map("cta_label")
  footerNote String?  @map("footer_note")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)

  @@unique([clubId, type])
  @@map("club_email_templates")
}
```

- [ ] **Step 2: Ajouter la relation inverse sur `Club`**

Dans `model Club { … }` (vers la ligne 218), à côté des autres relations inverses (ex. `broadcasts ClubBroadcast[]`), ajouter :

```prisma
  emailTemplates ClubEmailTemplate[]
```

- [ ] **Step 3: Écrire la migration SQL additive**

Créer le dossier `backend/prisma/migrations/20260701120000_add_club_email_templates/` et le fichier `migration.sql` :

```sql
-- CreateTable
CREATE TABLE "club_email_templates" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "cta_label" TEXT,
    "footer_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "club_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "club_email_templates_club_id_type_key" ON "club_email_templates"("club_id", "type");

-- AddForeignKey
ALTER TABLE "club_email_templates" ADD CONSTRAINT "club_email_templates_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

> Le nom de table des clubs est `clubs` (cf. `@@map` sur `model Club`). Adapter le timestamp du dossier si besoin (doit être > dernière migration).

- [ ] **Step 4: Appliquer + régénérer le client**

Run:
```bash
cd backend && npx prisma migrate deploy && npx prisma generate
```
Expected: migration `add_club_email_templates` appliquée, client régénéré, `prisma.clubEmailTemplate` disponible.

- [ ] **Step 5: Vérifier la compilation des types**

Run:
```bash
cd backend && npx tsc --noEmit
```
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(email): add ClubEmailTemplate model + migration"
```

---

## Task 3: Helpers de substitution + assainissement (TDD)

**Files:**
- Create: `backend/src/email/registry.ts`
- Test: `backend/src/email/__tests__/registry.test.ts`

- [ ] **Step 1: Écrire les tests des helpers**

Créer `backend/src/email/__tests__/registry.test.ts` :

```ts
import {
  substituteText,
  substituteHtml,
  sanitizeBodyHtml,
  collectPlaceholders,
} from '../registry';

describe('substituteText', () => {
  it('remplace les variables connues par leur valeur brute', () => {
    expect(substituteText('Bonjour {{prenom}} !', { prenom: 'Léa & Co' }))
      .toBe('Bonjour Léa & Co !');
  });
  it('retire les placeholders inconnus', () => {
    expect(substituteText('A {{x}} B', {})).toBe('A  B');
  });
});

describe('substituteHtml', () => {
  it('échappe la valeur insérée dans le HTML', () => {
    expect(substituteHtml('<p>{{nom}}</p>', { nom: '<b>x</b>' }))
      .toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
  });
  it('retire les placeholders inconnus', () => {
    expect(substituteHtml('<p>{{y}}</p>', {})).toBe('<p></p>');
  });
});

describe('sanitizeBodyHtml', () => {
  it('garde les balises autorisées', () => {
    const out = sanitizeBodyHtml('<p>Salut <strong>toi</strong> <a href="https://x.fr">ici</a></p>');
    expect(out).toContain('<strong>toi</strong>');
    expect(out).toContain('href="https://x.fr"');
  });
  it('supprime script et attributs on*', () => {
    const out = sanitizeBodyHtml('<p onclick="evil()">hi</p><script>alert(1)</script>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
  });
  it('supprime les schémas de lien dangereux', () => {
    const out = sanitizeBodyHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });
});

describe('collectPlaceholders', () => {
  it('liste les clés uniques utilisées', () => {
    expect(collectPlaceholders('{{a}} {{b}} {{a}}').sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `cd backend && npx jest src/email/__tests__/registry.test.ts`
Expected: FAIL — module `../registry` introuvable.

- [ ] **Step 3: Implémenter les helpers dans `registry.ts`**

Créer `backend/src/email/registry.ts` :

```ts
import sanitizeHtml from 'sanitize-html';
import { Brand, InfoRow, PALOVA_BRAND, escapeHtml, renderLayout } from './templates/layout';
import { absoluteAsset } from './links';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Substitution texte : valeur brute, placeholder inconnu → retiré. */
export function substituteText(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(PLACEHOLDER, (_m, k: string) => (k in vars ? vars[k] : ''));
}

/** Substitution dans du HTML : valeur HTML-échappée, placeholder inconnu → retiré. */
export function substituteHtml(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(PLACEHOLDER, (_m, k: string) => (k in vars ? escapeHtml(vars[k]) : ''));
}

/** Clés `{{…}}` uniques présentes dans un gabarit. */
export function collectPlaceholders(tpl: string): string[] {
  const set = new Set<string>();
  for (const m of tpl.matchAll(PLACEHOLDER)) set.add(m[1]);
  return [...set];
}

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'span', 'h2', 'h3', 'blockquote'],
  allowedAttributes: { a: ['href'], p: ['style'], span: ['style'], h2: ['style'], h3: ['style'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(/],
      'font-weight': [/^(normal|bold|[1-9]00)$/],
      'font-style': [/^(normal|italic)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'text-decoration': [/^(none|underline|line-through)$/],
    },
  },
  disallowedTagsMode: 'discard',
};

/** Assainit le corps HTML **personnalisé** d'un club (allowlist serrée). */
export function sanitizeBodyHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTS);
}

/** Brand email d'un club (logo en URL absolue, repli Palova). */
export function brandFromClub(club: { name: string; logoUrl: string | null; accentColor: string }): Brand {
  return {
    name: club.name || PALOVA_BRAND.name,
    logoUrl: absoluteAsset(club.logoUrl),
    accentColor: club.accentColor || PALOVA_BRAND.accentColor,
  };
}
```

- [ ] **Step 4: Lancer le test (passe)**

Run: `cd backend && npx jest src/email/__tests__/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/registry.ts backend/src/email/__tests__/registry.test.ts
git commit -m "feat(email): substitution + sanitize helpers"
```

---

## Task 4: Le registre `EMAIL_DEFS` (données des 17 gabarits)

**Files:**
- Modify: `backend/src/email/registry.ts`
- Test: `backend/src/email/__tests__/registry.test.ts`

- [ ] **Step 1: Ajouter les tests d'invariants du registre**

Ajouter à `registry.test.ts` :

```ts
import { EMAIL_DEFS, sampleVars } from '../registry';

describe('EMAIL_DEFS', () => {
  const entries = Object.entries(EMAIL_DEFS);

  it('contient 17 définitions et la clé == type', () => {
    expect(entries).toHaveLength(17);
    for (const [key, def] of entries) expect(def.type).toBe(key);
  });

  it('chaque défaut ne référence que des variables déclarées', () => {
    for (const [, def] of entries) {
      const declared = new Set(def.vars.map((v) => v.key));
      const used = new Set<string>([
        ...collectPlaceholders(def.defaults.subject),
        ...collectPlaceholders(def.defaults.heading),
        ...collectPlaceholders(def.defaults.bodyHtml),
        ...collectPlaceholders(def.defaults.ctaLabel ?? ''),
        ...collectPlaceholders(def.defaults.footerNote ?? ''),
      ]);
      for (const k of used) expect(declared.has(k)).toBe(true);
    }
  });

  it('champs requis non vides', () => {
    for (const [, def] of entries) {
      expect(def.defaults.subject.trim()).not.toBe('');
      expect(def.defaults.heading.trim()).not.toBe('');
      expect(def.defaults.bodyHtml.trim()).not.toBe('');
      expect(def.title.trim()).not.toBe('');
    }
  });

  it('sampleVars renvoie une valeur par variable déclarée', () => {
    const def = EMAIL_DEFS['registration.confirmed'];
    const s = sampleVars(def);
    for (const v of def.vars) expect(s[v.key]).toBe(v.sample);
  });
});
```

- [ ] **Step 2: Lancer (échoue)**

Run: `cd backend && npx jest src/email/__tests__/registry.test.ts -t EMAIL_DEFS`
Expected: FAIL — `EMAIL_DEFS`/`sampleVars` indéfinis.

- [ ] **Step 3: Ajouter les types + le registre à `registry.ts`**

Ajouter dans `registry.ts` (avant `renderClubEmail`, qui sera ajouté à la Task 5) :

```ts
export interface EmailVar { key: string; label: string; sample: string; }

export interface EmailDef {
  type: string;
  group: 'inscriptions' | 'organisateur' | 'parties' | 'matchs' | 'paiement';
  title: string;
  description: string;
  vars: EmailVar[];
  defaults: { subject: string; heading: string; bodyHtml: string; ctaLabel?: string; footerNote?: string };
  infoRows?: (v: Record<string, string>) => InfoRow[];
  hasCta: boolean;
}

/** Valeurs d'exemple (pour l'aperçu admin), une par variable déclarée. */
export function sampleVars(def: EmailDef): Record<string, string> {
  return Object.fromEntries(def.vars.map((v) => [v.key, v.sample]));
}

// Helpers infoRows réutilisables (les valeurs sont rendues échappées par renderLayout).
const row = (label: string, value: string): InfoRow => ({ label, value });
const terrainRows = (v: Record<string, string>): InfoRow[] =>
  [row('Terrain', v.terrain), row('Date', v.date), row('Club', v.club)];

export const EMAIL_DEFS: Record<string, EmailDef> = {
  // ----------------------------------------------------------- Inscriptions
  'registration.confirmed': {
    type: 'registration.confirmed', group: 'inscriptions',
    title: 'Inscription confirmée',
    description: 'Au joueur (et son coéquipier) quand son inscription est validée.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom du destinataire', sample: 'Marie' },
      { key: 'activite', label: "Nom de l'activité", sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: "Référence (le tournoi / l'événement / le cours)", sample: 'le tournoi' },
      { key: 'club', label: 'Nom du club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date lisible', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'coequipier', label: 'Coéquipier (tournoi, sinon vide)', sample: 'Lucas Martin' },
      { key: 'phrase_coequipier', label: 'Phrase coéquipier (auto)', sample: ' Vous êtes inscrit·e en binôme avec Lucas Martin.' },
      { key: 'lien', label: 'Lien vers l\'activité', sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: 'Inscription confirmée — {{activite}}',
      heading: 'Inscription confirmée ✅',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Votre inscription à <strong>{{activite}}</strong> est confirmée.{{phrase_coequipier}}</p>',
      ctaLabel: 'Voir {{ref_activite}}',
    },
    infoRows: (v) => [row('Date', v.date), row('Club', v.club), ...(v.coequipier ? [row('Coéquipier', v.coequipier)] : [])],
  },

  'registration.waitlisted': {
    type: 'registration.waitlisted', group: 'inscriptions',
    title: "Inscription en liste d'attente",
    description: "Au joueur quand l'épreuve est complète : mise en liste d'attente.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'coequipier', label: 'Coéquipier', sample: 'Lucas Martin' },
      { key: 'phrase_position', label: "Position d'attente (auto)", sample: ' (position 3)' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: "Liste d'attente — {{activite}}",
      heading: "Vous êtes en liste d'attente",
      bodyHtml: "<p>Bonjour {{prenom}},</p><p>C'est complet pour le moment : votre inscription à <strong>{{activite}}</strong> est enregistrée en <strong>liste d'attente</strong>{{phrase_position}}.</p>",
      ctaLabel: 'Voir {{ref_activite}}',
      footerNote: 'Vous serez prévenu·e par email dès qu’une place se libère.',
    },
    infoRows: (v) => [row('Date', v.date), row('Club', v.club), ...(v.coequipier ? [row('Coéquipier', v.coequipier)] : [])],
  },

  'registration.cancelled': {
    type: 'registration.cancelled', group: 'inscriptions',
    title: 'Désinscription confirmée',
    description: 'Au joueur après sa désinscription.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: 'Désinscription confirmée — {{activite}}',
      heading: 'Désinscription confirmée',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Votre inscription à <strong>{{activite}}</strong> a bien été annulée.</p>',
      ctaLabel: 'Voir {{ref_activite}}',
      footerNote: 'Vous pouvez vous réinscrire tant que les inscriptions sont ouvertes.',
    },
    infoRows: (v) => [row('Date', v.date), row('Club', v.club)],
  },

  'registration.promoted': {
    type: 'registration.promoted', group: 'inscriptions',
    title: 'Place libérée (promotion)',
    description: "Au joueur promu de la liste d'attente à confirmé.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'coequipier', label: 'Coéquipier', sample: 'Lucas Martin' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: "Une place s'est libérée — {{activite}}",
      heading: 'Bonne nouvelle, une place s’est libérée 🎉',
      bodyHtml: "<p>Bonjour {{prenom}},</p><p>Une place vient de se libérer : vous passez de la liste d'attente à <strong>inscrit·e confirmé·e</strong> à <strong>{{activite}}</strong> !</p>",
      ctaLabel: 'Voir {{ref_activite}}',
    },
    infoRows: (v) => [row('Date', v.date), row('Club', v.club), ...(v.coequipier ? [row('Coéquipier', v.coequipier)] : [])],
  },

  'activity.cancelled_by_club': {
    type: 'activity.cancelled_by_club', group: 'inscriptions',
    title: 'Activité annulée par le club',
    description: "À tous les inscrits quand le club annule l'activité.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: 'Activité annulée — {{activite}}',
      heading: 'Activité annulée',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{activite}}</strong> a été annulé par le club.</p>',
      ctaLabel: 'Voir {{ref_activite}}',
    },
    infoRows: (v) => [row('Date', v.date), row('Club', v.club)],
  },

  // ----------------------------------------------------------- Organisateur
  'organizer.registration': {
    type: 'organizer.registration', group: 'organisateur',
    title: 'Organisateur — nouvelle inscription',
    description: 'Au staff (OWNER/ADMIN) à chaque nouvelle inscription.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom du staff', sample: 'Éric' },
      { key: 'joueurs', label: 'Joueur(s) inscrit(s)', sample: 'Marie Durand & Lucas Martin' },
      { key: 'statut', label: 'Statut', sample: 'confirmée' },
      { key: 'nb_inscrits', label: 'Inscriptions confirmées', sample: '12' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'lien', label: 'Lien admin', sample: 'https://club.palova.fr/admin/tournaments' },
    ],
    defaults: {
      subject: 'Nouvelle inscription — {{activite}}',
      heading: 'Nouvelle inscription',
      bodyHtml: "<p>Bonjour {{prenom}},</p><p><strong>{{joueurs}}</strong> vient de s'inscrire ({{statut}}) à <strong>{{activite}}</strong>.</p>",
      ctaLabel: 'Gérer {{ref_activite}}',
    },
    infoRows: (v) => (v.nb_inscrits ? [row('Inscriptions confirmées', v.nb_inscrits)] : []),
  },

  'organizer.cancellation': {
    type: 'organizer.cancellation', group: 'organisateur',
    title: 'Organisateur — désinscription',
    description: 'Au staff (OWNER/ADMIN) à chaque désinscription.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom du staff', sample: 'Éric' },
      { key: 'joueurs', label: 'Joueur(s)', sample: 'Marie Durand & Lucas Martin' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'lien', label: 'Lien admin', sample: 'https://club.palova.fr/admin/tournaments' },
    ],
    defaults: {
      subject: 'Désinscription — {{activite}}',
      heading: 'Désinscription',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{joueurs}}</strong> vient de se désinscrire de <strong>{{activite}}</strong>.</p>',
      ctaLabel: 'Gérer {{ref_activite}}',
    },
  },

  // -------------------------------------------------------- Parties ouvertes
  'open_match.joined': {
    type: 'open_match.joined', group: 'parties',
    title: 'Partie — un joueur a rejoint',
    description: "À l'organisateur quand un joueur rejoint sa partie ouverte.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom organisateur', sample: 'Éric' },
      { key: 'joueur', label: 'Joueur qui rejoint', sample: 'Marie Durand' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'phrase_places', label: 'Places restantes (auto)', sample: 'Il reste 2 places.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties' },
    ],
    defaults: {
      subject: '{{joueur}} a rejoint votre partie',
      heading: 'Un joueur a rejoint votre partie 🎾',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{joueur}}</strong> a rejoint votre partie ouverte. {{phrase_places}}</p>',
      ctaLabel: 'Voir la partie',
    },
    infoRows: terrainRows,
  },

  'open_match.added': {
    type: 'open_match.added', group: 'parties',
    title: 'Partie — vous avez été ajouté·e',
    description: "Au membre ajouté à une partie (partenaire, ajout organisateur ou rattachement club).",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'phrase_par', label: 'Phrase « ajouté par » (auto)', sample: 'Éric Nougayrède vous a ajouté·e à une partie de padel.' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/reservations' },
    ],
    defaults: {
      subject: 'Vous avez été ajouté·e à une partie — {{club}}',
      heading: 'Vous jouez ! 🎾',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>{{phrase_par}}</p>',
      ctaLabel: 'Voir mes parties',
    },
    infoRows: terrainRows,
  },

  'open_match.removed': {
    type: 'open_match.removed', group: 'parties',
    title: 'Partie — vous avez été retiré·e',
    description: "Au joueur retiré d'une partie par l'organisateur.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties' },
    ],
    defaults: {
      subject: "Vous avez été retiré·e d'une partie — {{club}}",
      heading: 'Changement dans une partie',
      bodyHtml: "<p>Bonjour {{prenom}},</p><p>L'organisateur vous a retiré·e de cette partie de padel.</p>",
      ctaLabel: 'Voir les parties ouvertes',
    },
    infoRows: terrainRows,
  },

  'open_match.left': {
    type: 'open_match.left', group: 'parties',
    title: 'Partie — un joueur a quitté',
    description: "À l'organisateur quand un joueur quitte sa partie ouverte.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom organisateur', sample: 'Éric' },
      { key: 'joueur', label: 'Joueur qui quitte', sample: 'Marie Durand' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'phrase_places', label: 'Places restantes (auto)', sample: 'Il reste 1 place.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties' },
    ],
    defaults: {
      subject: '{{joueur}} a quitté votre partie',
      heading: 'Un joueur a quitté votre partie',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{joueur}}</strong> a quitté votre partie ouverte. {{phrase_places}}</p>',
      ctaLabel: 'Voir la partie',
    },
    infoRows: terrainRows,
  },

  'open_match.proposed': {
    type: 'open_match.proposed', group: 'parties',
    title: 'Partie — proposée à ton niveau',
    description: "Aux membres opt-in « à mon niveau » dont le niveau correspond.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'niveau', label: 'Fourchette de niveau', sample: 'Niveau 2 à 5' },
      { key: 'phrase_places', label: 'Places restantes (auto)', sample: 'Il reste 2 places.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties' },
    ],
    defaults: {
      subject: 'Une partie à ton niveau — {{club}}',
      heading: 'Une partie pour toi ! 🎾',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Une partie ouverte correspond à ton niveau et cherche des joueurs. {{phrase_places}}</p>',
      ctaLabel: 'Voir la partie',
    },
    infoRows: (v) => [row('Terrain', v.terrain), row('Date', v.date), row('Niveau', v.niveau), row('Club', v.club)],
  },

  'open_match.message': {
    type: 'open_match.message', group: 'parties',
    title: 'Partie — nouveau message (chat)',
    description: 'Aux membres du chat absents quand un message est posté.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'auteur', label: 'Auteur du message', sample: 'Éric Nougayrède' },
      { key: 'message', label: 'Extrait du message', sample: 'On se retrouve à 17h45 ?' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties' },
    ],
    defaults: {
      subject: 'Nouveau message — {{terrain}}',
      heading: 'Nouveau message dans ta partie 💬',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p style="margin:0 0 12px;">Un nouveau message a été posté dans ta partie :</p><p style="margin:0;padding:12px 14px;background:#f4f4f5;border-radius:8px;font-style:italic;"><strong>{{auteur}}</strong> : {{message}}</p>',
      ctaLabel: 'Voir la discussion',
    },
    infoRows: (v) => [row('Terrain', v.terrain), row('Club', v.club)],
  },

  // ---------------------------------------------------------------- Matchs
  'match.pending_confirmation': {
    type: 'match.pending_confirmation', group: 'matchs',
    title: 'Match — confirme le résultat',
    description: 'Aux 3 autres joueurs quand un résultat est saisi.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'auteur', label: 'Auteur de la saisie', sample: 'Éric Nougayrède' },
      { key: 'score', label: 'Score', sample: '6-4 / 6-3' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/matches' },
    ],
    defaults: {
      subject: 'Confirme le résultat de ton match',
      heading: 'Résultat en attente de confirmation',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{auteur}}</strong> a saisi le résultat de votre match : <strong>{{score}}</strong>. Confirmez ou contestez ce résultat depuis votre espace.</p>',
      ctaLabel: 'Voir mes matchs',
    },
  },

  'match.disputed': {
    type: 'match.disputed', group: 'matchs',
    title: 'Match — résultat contesté',
    description: 'Aux participants quand le résultat est contesté (1er message).',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'auteur', label: 'Auteur', sample: 'Éric Nougayrède' },
      { key: 'score', label: 'Score', sample: '6-4 / 6-3' },
      { key: 'extrait', label: 'Message', sample: 'Le 2ᵉ set était 6-4 pour nous.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/matches' },
    ],
    defaults: {
      subject: '{{auteur}} a contesté le résultat de votre match',
      heading: 'Résultat contesté',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{auteur}}</strong> a contesté le résultat (<strong>{{score}}</strong>) et a laissé un message :</p><p style="margin:0;padding:12px 14px;background:#f4f4f5;border-radius:8px;font-style:italic;">{{extrait}}</p>',
      ctaLabel: 'Voir la discussion',
    },
  },

  'match.comment': {
    type: 'match.comment', group: 'matchs',
    title: 'Match — message sur litige',
    description: 'Aux participants à chaque nouveau message sur un litige.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'auteur', label: 'Auteur', sample: 'Éric Nougayrède' },
      { key: 'score', label: 'Score', sample: '6-4 / 6-3' },
      { key: 'extrait', label: 'Message', sample: 'D’accord, on valide alors.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/matches' },
    ],
    defaults: {
      subject: 'Nouveau message sur le litige de votre match',
      heading: 'Nouveau message',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{auteur}}</strong> a écrit dans la discussion du litige (<strong>{{score}}</strong>) :</p><p style="margin:0;padding:12px 14px;background:#f4f4f5;border-radius:8px;font-style:italic;">{{extrait}}</p>',
      ctaLabel: 'Voir la discussion',
    },
  },

  // -------------------------------------------------------------- Paiement
  'payment.refunded': {
    type: 'payment.refunded', group: 'paiement',
    title: 'Remboursement',
    description: "Au joueur quand sa réservation annulée est remboursée.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'montant', label: 'Montant remboursé', sample: '20,00 €' },
      { key: 'support_solde', label: 'Mention solde (auto)', sample: ' recrédité sur votre solde (carnet / porte-monnaie)' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/reservations' },
    ],
    defaults: {
      subject: 'Remboursement de votre réservation — {{club}}',
      heading: 'Réservation remboursée 💶',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Votre réservation annulée a été remboursée : <strong>{{montant}}</strong>{{support_solde}}.</p>',
      ctaLabel: 'Voir mes réservations',
    },
    infoRows: (v) => [row('Terrain', v.terrain), row('Date', v.date), row('Club', v.club), row('Remboursé', v.montant)],
  },
};
```

- [ ] **Step 4: Lancer (passe)**

Run: `cd backend && npx jest src/email/__tests__/registry.test.ts`
Expected: PASS (helpers + EMAIL_DEFS).

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/registry.ts backend/src/email/__tests__/registry.test.ts
git commit -m "feat(email): EMAIL_DEFS registry (17 types)"
```

---

## Task 5: Le moteur `renderClubEmail` (TDD)

**Files:**
- Modify: `backend/src/email/registry.ts`
- Test: `backend/src/email/__tests__/registry.test.ts`

- [ ] **Step 1: Écrire les tests du moteur**

Ajouter à `registry.test.ts` :

```ts
import { renderClubEmail, brandFromClub } from '../registry';

const brand = brandFromClub({ name: 'Padel Arena', logoUrl: null, accentColor: '#1a2b3c' });

describe('renderClubEmail', () => {
  const vars = {
    prenom: 'Marie', activite: 'Tournoi P100', ref_activite: 'le tournoi',
    club: 'Padel Arena', date: 'dim. 6 juil. 14h00', coequipier: '', phrase_coequipier: '',
    lien: 'https://x.fr/t/1',
  };

  it('utilise les défauts quand pas de surcharge', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, null);
    expect(mail.subject).toBe('Inscription confirmée — Tournoi P100');
    expect(mail.html).toContain('Inscription confirmée ✅');
    expect(mail.html).toContain('<strong>Tournoi P100</strong>');
    expect(mail.html).toContain('href="https://x.fr/t/1"');
    expect(mail.text).toContain('Marie');
    expect(mail.text).toContain('Club : Padel Arena');
  });

  it('applique la surcharge club', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, {
      subject: 'Bienvenue {{prenom}} !', heading: 'Yes', bodyHtml: '<p>OK {{activite}}</p>',
      ctaLabel: null, footerNote: null,
    } as any);
    expect(mail.subject).toBe('Bienvenue Marie !');
    expect(mail.html).toContain('OK Tournoi P100');
  });

  it('échappe les valeurs et retire les placeholders inconnus dans le corps', () => {
    const mail = renderClubEmail('registration.confirmed', { ...vars, activite: '<b>x</b>' }, brand, {
      subject: 's', heading: 'h', bodyHtml: '<p>{{activite}} {{inconnu}}</p>', ctaLabel: null, footerNote: null,
    } as any);
    expect(mail.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(mail.html).not.toContain('{{inconnu}}');
  });

  it('assainit le corps personnalisé', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, {
      subject: 's', heading: 'h', bodyHtml: '<p>hi<script>alert(1)</script></p>', ctaLabel: null, footerNote: null,
    } as any);
    expect(mail.html).not.toContain('<script');
  });

  it('lève EMAIL_TYPE_UNKNOWN pour un type inconnu', () => {
    expect(() => renderClubEmail('nope', {}, brand, null)).toThrow('EMAIL_TYPE_UNKNOWN');
  });
});
```

- [ ] **Step 2: Lancer (échoue)**

Run: `cd backend && npx jest src/email/__tests__/registry.test.ts -t renderClubEmail`
Expected: FAIL — `renderClubEmail` indéfini.

- [ ] **Step 3: Implémenter `renderClubEmail` + `buildText`**

Ajouter à `registry.ts` :

```ts
/** Surcharge club minimale (sous-ensemble du modèle ClubEmailTemplate). */
export interface EmailOverride {
  subject: string; heading: string; bodyHtml: string;
  ctaLabel: string | null; footerNote: string | null;
}

export interface BuiltEmail { subject: string; html: string; text: string; }

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function buildText(introHtml: string, infoRows: InfoRow[], ctaLabel: string | undefined, ctaUrl: string | undefined, footerNote: string | undefined): string {
  const lines = [stripTags(introHtml).replace(/\s+/g, ' ').trim(), ''];
  for (const r of infoRows) lines.push(`${r.label} : ${r.value}`);
  if (ctaLabel && ctaUrl) { lines.push('', `${ctaLabel} : ${ctaUrl}`); }
  if (footerNote) { lines.push('', footerNote); }
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join('\n').trim();
}

/**
 * Construit un email club : surcharge si fournie, sinon défaut du registre.
 * Le corps PAR DÉFAUT est de confiance (non assaini, styles préservés) ; le corps
 * PERSONNALISÉ est assaini. Les valeurs de variables sont HTML-échappées dans le corps.
 */
export function renderClubEmail(
  type: string,
  vars: Record<string, string>,
  brand: Brand,
  override?: EmailOverride | null,
): BuiltEmail {
  const def = EMAIL_DEFS[type];
  if (!def) throw new Error('EMAIL_TYPE_UNKNOWN');

  const usingCustomBody = override?.bodyHtml != null;
  const subjectTpl = override?.subject ?? def.defaults.subject;
  const headingTpl = override?.heading ?? def.defaults.heading;
  const bodyTpl = override?.bodyHtml ?? def.defaults.bodyHtml;
  const ctaTpl = (override?.ctaLabel ?? def.defaults.ctaLabel) || undefined;
  const footerTpl = (override?.footerNote ?? def.defaults.footerNote) || '';

  const subject = substituteText(subjectTpl, vars);
  const heading = substituteText(headingTpl, vars);
  const substitutedBody = substituteHtml(bodyTpl, vars);
  const introHtml = usingCustomBody ? sanitizeBodyHtml(substitutedBody) : substitutedBody;
  const ctaLabel = ctaTpl ? substituteText(ctaTpl, vars) : undefined;
  const footerNote = substituteText(footerTpl, vars) || undefined;
  const infoRows = def.infoRows ? def.infoRows(vars) : [];
  const ctaUrl = def.hasCta ? vars.lien : undefined;

  const html = renderLayout({ brand, preheader: subject, heading, introHtml, infoRows, ctaLabel, ctaUrl, footerNote });
  const text = buildText(introHtml, infoRows, ctaLabel, ctaUrl, footerNote);
  return { subject, html, text };
}
```

- [ ] **Step 4: Lancer (passe)**

Run: `cd backend && npx jest src/email/__tests__/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/registry.ts backend/src/email/__tests__/registry.test.ts
git commit -m "feat(email): renderClubEmail engine"
```

---

## Task 6: `EmailTemplateService` — lecture (TDD)

**Files:**
- Create: `backend/src/services/emailTemplate.service.ts`
- Test: `backend/src/services/__tests__/emailTemplate.service.test.ts`

- [ ] **Step 1: Écrire les tests de lecture**

Créer `backend/src/services/__tests__/emailTemplate.service.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { EmailTemplateService } from '../emailTemplate.service';

describe('EmailTemplateService (lecture)', () => {
  const service = new EmailTemplateService();

  describe('listForAdmin', () => {
    it('renvoie 17 entrées avec le flag customized', async () => {
      prismaMock.clubEmailTemplate.findMany.mockResolvedValue([{ type: 'payment.refunded' }] as any);
      const items = await service.listForAdmin('club-1');
      expect(items).toHaveLength(17);
      const refunded = items.find((i) => i.type === 'payment.refunded');
      expect(refunded!.customized).toBe(true);
      const confirmed = items.find((i) => i.type === 'registration.confirmed');
      expect(confirmed!.customized).toBe(false);
      expect(confirmed!.group).toBe('inscriptions');
    });
  });

  describe('getForAdmin', () => {
    it('renvoie def + override (null si absent)', async () => {
      prismaMock.clubEmailTemplate.findUnique.mockResolvedValue(null as any);
      const d = await service.getForAdmin('club-1', 'registration.confirmed');
      expect(d.type).toBe('registration.confirmed');
      expect(d.vars.length).toBeGreaterThan(0);
      expect(d.defaults.subject).toContain('{{activite}}');
      expect(d.override).toBeNull();
    });
    it('lève EMAIL_TYPE_UNKNOWN pour un type inexistant', async () => {
      await expect(service.getForAdmin('club-1', 'nope')).rejects.toThrow('EMAIL_TYPE_UNKNOWN');
    });
  });

  describe('getOverride', () => {
    it('renvoie la ligne si présente', async () => {
      prismaMock.clubEmailTemplate.findUnique.mockResolvedValue({ subject: 's' } as any);
      const o = await service.getOverride('club-1', 'registration.confirmed');
      expect(o).toEqual({ subject: 's' });
    });
    it('renvoie null si la requête échoue (résilience)', async () => {
      prismaMock.clubEmailTemplate.findUnique.mockRejectedValue(new Error('db down'));
      const o = await service.getOverride('club-1', 'registration.confirmed');
      expect(o).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Lancer (échoue)**

Run: `cd backend && npx jest src/services/__tests__/emailTemplate.service.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter la lecture**

Créer `backend/src/services/emailTemplate.service.ts` :

```ts
import { prisma } from '../db/prisma';
import { EMAIL_DEFS, EmailDef, EmailOverride } from '../email/registry';

export interface EmailSummary {
  type: string; group: EmailDef['group']; title: string; description: string; customized: boolean;
}

export interface EmailDetail {
  type: string; group: EmailDef['group']; title: string; description: string; hasCta: boolean;
  vars: { key: string; label: string; sample: string }[];
  defaults: { subject: string; heading: string; bodyHtml: string; ctaLabel?: string; footerNote?: string };
  override: EmailOverride | null;
}

function toOverride(row: { subject: string; heading: string; bodyHtml: string; ctaLabel: string | null; footerNote: string | null } | null): EmailOverride | null {
  if (!row) return null;
  return { subject: row.subject, heading: row.heading, bodyHtml: row.bodyHtml, ctaLabel: row.ctaLabel, footerNote: row.footerNote };
}

export class EmailTemplateService {
  async listForAdmin(clubId: string): Promise<EmailSummary[]> {
    const rows = await prisma.clubEmailTemplate.findMany({ where: { clubId }, select: { type: true } });
    const customized = new Set(rows.map((r) => r.type));
    return Object.values(EMAIL_DEFS).map((def) => ({
      type: def.type, group: def.group, title: def.title, description: def.description,
      customized: customized.has(def.type),
    }));
  }

  async getForAdmin(clubId: string, type: string): Promise<EmailDetail> {
    const def = EMAIL_DEFS[type];
    if (!def) throw new Error('EMAIL_TYPE_UNKNOWN');
    const row = await prisma.clubEmailTemplate.findUnique({ where: { clubId_type: { clubId, type } } });
    return {
      type: def.type, group: def.group, title: def.title, description: def.description, hasCta: def.hasCta,
      vars: def.vars, defaults: def.defaults, override: toOverride(row as any),
    };
  }

  /** Surcharge brute pour le rendu (résilient : null si erreur DB → repli défaut). */
  async getOverride(clubId: string, type: string): Promise<EmailOverride | null> {
    try {
      const row = await prisma.clubEmailTemplate.findUnique({ where: { clubId_type: { clubId, type } } });
      return toOverride(row as any);
    } catch {
      return null;
    }
  }
}

export const emailTemplates = new EmailTemplateService();
```

- [ ] **Step 4: Lancer (passe)**

Run: `cd backend && npx jest src/services/__tests__/emailTemplate.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/emailTemplate.service.ts backend/src/services/__tests__/emailTemplate.service.test.ts
git commit -m "feat(email): EmailTemplateService read side"
```

---

## Task 7: `EmailTemplateService` — écriture (upsert/remove) (TDD)

**Files:**
- Modify: `backend/src/services/emailTemplate.service.ts`
- Test: `backend/src/services/__tests__/emailTemplate.service.test.ts`

- [ ] **Step 1: Écrire les tests d'écriture**

Ajouter à `emailTemplate.service.test.ts` :

```ts
describe('EmailTemplateService (écriture)', () => {
  const service = new EmailTemplateService();
  const draft = { subject: 'Salut {{prenom}}', heading: 'Hello', bodyHtml: '<p>Yo <script>x</script></p>', ctaLabel: '', footerNote: '' };

  it('upsert assainit le corps et renvoie unknownVars', async () => {
    prismaMock.clubEmailTemplate.upsert.mockImplementation(async (args: any) => args.create);
    const res = await service.upsert('club-1', 'registration.confirmed', { ...draft, bodyHtml: '<p>{{prenom}} {{inconnu}}<script>x</script></p>' });
    expect(res.unknownVars).toContain('inconnu');
    const call = prismaMock.clubEmailTemplate.upsert.mock.calls[0][0] as any;
    expect(call.create.bodyHtml).not.toContain('<script');
    expect(call.create.ctaLabel).toBeNull(); // '' → null
  });

  it('upsert refuse un type inconnu', async () => {
    await expect(service.upsert('club-1', 'nope', draft)).rejects.toThrow('EMAIL_TYPE_UNKNOWN');
  });

  it('upsert refuse un champ requis vide', async () => {
    await expect(service.upsert('club-1', 'registration.confirmed', { ...draft, subject: '   ' }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('remove supprime la surcharge (idempotent)', async () => {
    prismaMock.clubEmailTemplate.deleteMany.mockResolvedValue({ count: 1 } as any);
    await service.remove('club-1', 'registration.confirmed');
    expect(prismaMock.clubEmailTemplate.deleteMany).toHaveBeenCalledWith({
      where: { clubId: 'club-1', type: 'registration.confirmed' },
    });
  });
});
```

- [ ] **Step 2: Lancer (échoue)**

Run: `cd backend && npx jest src/services/__tests__/emailTemplate.service.test.ts -t écriture`
Expected: FAIL — `upsert`/`remove` indéfinis.

- [ ] **Step 3: Implémenter upsert + remove + unknownVars**

Ajouter les imports en tête de `emailTemplate.service.ts` :

```ts
import { EMAIL_DEFS, EmailDef, EmailOverride, sanitizeBodyHtml, collectPlaceholders } from '../email/registry';
```

Ajouter dans la classe `EmailTemplateService` :

```ts
  /** Variables `{{…}}` du brouillon non déclarées par la définition. */
  private unknownVarsFor(def: EmailDef, draft: { subject: string; heading: string; bodyHtml: string; ctaLabel?: string; footerNote?: string }): string[] {
    const declared = new Set(def.vars.map((v) => v.key));
    const used = new Set<string>([
      ...collectPlaceholders(draft.subject),
      ...collectPlaceholders(draft.heading),
      ...collectPlaceholders(draft.bodyHtml),
      ...collectPlaceholders(draft.ctaLabel ?? ''),
      ...collectPlaceholders(draft.footerNote ?? ''),
    ]);
    return [...used].filter((k) => !declared.has(k));
  }

  async upsert(
    clubId: string,
    type: string,
    draft: { subject: string; heading: string; bodyHtml: string; ctaLabel?: string | null; footerNote?: string | null },
  ): Promise<{ override: EmailOverride; unknownVars: string[] }> {
    const def = EMAIL_DEFS[type];
    if (!def) throw new Error('EMAIL_TYPE_UNKNOWN');

    const subject = (draft.subject ?? '').trim();
    const heading = (draft.heading ?? '').trim();
    const bodyRaw = (draft.bodyHtml ?? '').trim();
    if (!subject || !heading || !bodyRaw) throw new Error('VALIDATION_ERROR');
    if (subject.length > 200 || heading.length > 200 || bodyRaw.length > 10000) throw new Error('VALIDATION_ERROR');

    const bodyHtml = sanitizeBodyHtml(bodyRaw);
    const ctaLabel = (draft.ctaLabel ?? '').trim() || null;
    const footerNote = (draft.footerNote ?? '').trim() || null;

    const data = { subject, heading, bodyHtml, ctaLabel, footerNote };
    await prisma.clubEmailTemplate.upsert({
      where: { clubId_type: { clubId, type } },
      create: { clubId, type, ...data },
      update: data,
    });
    return { override: { subject, heading, bodyHtml, ctaLabel, footerNote }, unknownVars: this.unknownVarsFor(def, { subject, heading, bodyHtml, ctaLabel: ctaLabel ?? '', footerNote: footerNote ?? '' }) };
  }

  async remove(clubId: string, type: string): Promise<void> {
    await prisma.clubEmailTemplate.deleteMany({ where: { clubId, type } });
  }
```

- [ ] **Step 4: Lancer (passe)**

Run: `cd backend && npx jest src/services/__tests__/emailTemplate.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/emailTemplate.service.ts backend/src/services/__tests__/emailTemplate.service.test.ts
git commit -m "feat(email): EmailTemplateService upsert/remove + unknownVars"
```

---

## Task 8: `EmailTemplateService` — aperçu + test (TDD)

**Files:**
- Modify: `backend/src/services/emailTemplate.service.ts`
- Test: `backend/src/services/__tests__/emailTemplate.service.test.ts`

- [ ] **Step 1: Écrire les tests aperçu/test**

En tête de `emailTemplate.service.test.ts`, ajouter le mock de `sendMail` (avant l'import du service — placer ces lignes juste après les imports prisma) :

```ts
jest.mock('../../email/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
const { sendMail } = require('../../email/mailer') as { sendMail: jest.Mock };
```

Ajouter le bloc de tests :

```ts
describe('EmailTemplateService (aperçu/test)', () => {
  const service = new EmailTemplateService();
  const club = { name: 'Padel Arena', logoUrl: null, accentColor: '#1a2b3c' };
  const draft = { subject: 'Salut {{prenom}}', heading: 'Hello', bodyHtml: '<p>Yo {{activite}}</p>', ctaLabel: '', footerNote: '' };

  beforeEach(() => sendMail.mockClear());

  it('renderPreview rend avec les valeurs d\'exemple', async () => {
    prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
    const res = await service.renderPreview('club-1', 'registration.confirmed', draft);
    expect(res.subject).toBe('Salut Marie'); // sample prenom = Marie
    expect(res.html).toContain('Yo Tournoi P100 du dimanche');
  });

  it('sendTest envoie au destinataire fourni', async () => {
    prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
    await service.sendTest('club-1', 'registration.confirmed', draft, 'admin@x.fr');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@x.fr', subject: 'Salut Marie' }));
  });
});
```

- [ ] **Step 2: Lancer (échoue)**

Run: `cd backend && npx jest src/services/__tests__/emailTemplate.service.test.ts -t "aperçu/test"`
Expected: FAIL — `renderPreview`/`sendTest` indéfinis.

- [ ] **Step 3: Implémenter renderPreview + sendTest + loadBrand**

Mettre à jour les imports en tête de `emailTemplate.service.ts` :

```ts
import { EMAIL_DEFS, EmailDef, EmailOverride, sanitizeBodyHtml, collectPlaceholders, renderClubEmail, brandFromClub, sampleVars } from '../email/registry';
import { sendMail } from '../email/mailer';
import { Brand } from '../email/templates/layout';
```

Ajouter dans la classe :

```ts
  private async loadBrand(clubId: string): Promise<Brand> {
    const club = await prisma.club.findUniqueOrThrow({
      where: { id: clubId }, select: { name: true, logoUrl: true, accentColor: true },
    });
    return brandFromClub(club);
  }

  /** Rend l'email avec les valeurs d'exemple du registre, en appliquant le brouillon. */
  async renderPreview(clubId: string, type: string, draft: EmailOverride): Promise<{ subject: string; html: string }> {
    const def = EMAIL_DEFS[type];
    if (!def) throw new Error('EMAIL_TYPE_UNKNOWN');
    const brand = await this.loadBrand(clubId);
    const mail = renderClubEmail(type, sampleVars(def), brand, draft);
    return { subject: mail.subject, html: mail.html };
  }

  async sendTest(clubId: string, type: string, draft: EmailOverride, to: string): Promise<void> {
    const def = EMAIL_DEFS[type];
    if (!def) throw new Error('EMAIL_TYPE_UNKNOWN');
    if (!to) throw new Error('VALIDATION_ERROR');
    const brand = await this.loadBrand(clubId);
    const mail = renderClubEmail(type, sampleVars(def), brand, draft);
    await sendMail({ to, subject: `[Test] ${mail.subject}`, html: mail.html, text: mail.text });
  }
```

> `renderPreview`/`sendTest` reçoivent un `EmailOverride` (le brouillon non sauvegardé) avec `ctaLabel`/`footerNote` éventuellement `''` — `renderClubEmail` traite `''` comme « pas de surcharge de ce champ » via `|| undefined`. Pour forcer le défaut sur un champ vide c'est le comportement voulu.

- [ ] **Step 4: Lancer (passe)**

Run: `cd backend && npx jest src/services/__tests__/emailTemplate.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/emailTemplate.service.ts backend/src/services/__tests__/emailTemplate.service.test.ts
git commit -m "feat(email): EmailTemplateService preview + test send"
```

---

## Task 9: Routes admin `/emails*` (TDD)

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/src/routes/__tests__/admin.emails.routes.test.ts`

- [ ] **Step 1: Écrire les tests de routes**

Créer `backend/src/routes/__tests__/admin.emails.routes.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

let listImpl = jest.fn();
let getImpl = jest.fn();
let upsertImpl = jest.fn();
let removeImpl = jest.fn();
let previewImpl = jest.fn();
let testImpl = jest.fn();

jest.mock('../../services/emailTemplate.service', () => ({
  EmailTemplateService: jest.fn().mockImplementation(() => ({
    listForAdmin: (...a: any[]) => listImpl(...a),
    getForAdmin: (...a: any[]) => getImpl(...a),
    upsert: (...a: any[]) => upsertImpl(...a),
    remove: (...a: any[]) => removeImpl(...a),
    renderPreview: (...a: any[]) => previewImpl(...a),
    sendTest: (...a: any[]) => testImpl(...a),
  })),
}));

import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const auth = { Authorization: `Bearer ${jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!)}` };
const base = '/api/clubs/club-demo/admin/emails';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'ADMIN' } as any);
  prismaMock.user.findUnique.mockResolvedValue({ email: 'owner@x.fr' } as any);
  listImpl.mockReset().mockResolvedValue([{ type: 'registration.confirmed', group: 'inscriptions', title: 'X', description: 'd', customized: false }]);
  getImpl.mockReset().mockResolvedValue({ type: 'registration.confirmed', vars: [], defaults: {}, override: null });
  upsertImpl.mockReset().mockResolvedValue({ override: {}, unknownVars: [] });
  removeImpl.mockReset().mockResolvedValue(undefined);
  previewImpl.mockReset().mockResolvedValue({ subject: 's', html: '<html></html>' });
  testImpl.mockReset().mockResolvedValue(undefined);
});

describe('GET /emails', () => {
  it('401 sans token', async () => {
    expect((await request(app).get(base)).status).toBe(401);
  });
  it('403 pour STAFF', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    expect((await request(app).get(base).set(auth)).status).toBe(403);
  });
  it('200 items pour ADMIN', async () => {
    const res = await request(app).get(base).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('GET /emails/:type', () => {
  it('404 EMAIL_TYPE_UNKNOWN', async () => {
    getImpl.mockRejectedValue(new Error('EMAIL_TYPE_UNKNOWN'));
    const res = await request(app).get(`${base}/nope`).set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('EMAIL_TYPE_UNKNOWN');
  });
  it('200 detail', async () => {
    const res = await request(app).get(`${base}/registration.confirmed`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('registration.confirmed');
  });
});

describe('PUT /emails/:type', () => {
  it('200 + unknownVars', async () => {
    upsertImpl.mockResolvedValue({ override: { subject: 's' }, unknownVars: ['x'] });
    const res = await request(app).put(`${base}/registration.confirmed`).set(auth)
      .send({ subject: 's', heading: 'h', bodyHtml: '<p>b</p>' });
    expect(res.status).toBe(200);
    expect(res.body.unknownVars).toEqual(['x']);
  });
  it('400 VALIDATION_ERROR', async () => {
    upsertImpl.mockRejectedValue(new Error('VALIDATION_ERROR'));
    const res = await request(app).put(`${base}/registration.confirmed`).set(auth).send({ subject: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /emails/:type', () => {
  it('200 ok', async () => {
    const res = await request(app).delete(`${base}/registration.confirmed`).set(auth);
    expect(res.status).toBe(200);
    expect(removeImpl).toHaveBeenCalledWith('club-demo', 'registration.confirmed');
  });
});

describe('POST /emails/:type/preview', () => {
  it('200 subject+html', async () => {
    const res = await request(app).post(`${base}/registration.confirmed/preview`).set(auth)
      .send({ subject: 's', heading: 'h', bodyHtml: '<p>b</p>' });
    expect(res.status).toBe(200);
    expect(res.body.html).toContain('<html');
  });
});

describe('POST /emails/:type/test', () => {
  it('200 ok et envoie à l\'email de l\'admin', async () => {
    const res = await request(app).post(`${base}/registration.confirmed/test`).set(auth)
      .send({ subject: 's', heading: 'h', bodyHtml: '<p>b</p>' });
    expect(res.status).toBe(200);
    expect(testImpl).toHaveBeenCalledWith('club-demo', 'registration.confirmed', expect.any(Object), 'owner@x.fr');
  });
});
```

- [ ] **Step 2: Lancer (échoue)**

Run: `cd backend && npx jest src/routes/__tests__/admin.emails.routes.test.ts`
Expected: FAIL — routes absentes (404 sur tout).

- [ ] **Step 3: Ajouter le code des routes**

Dans `backend/src/routes/admin.ts` :

(a) ajouter l'import (vers la ligne 30) :
```ts
import { EmailTemplateService } from '../services/emailTemplate.service';
```
(b) instancier (vers la ligne 49) :
```ts
const emailTemplateService = new EmailTemplateService();
```
(c) ajouter dans `ERROR_STATUS` :
```ts
  EMAIL_TYPE_UNKNOWN:     404,
```
(d) ajouter les routes juste **avant** `export default router;` (fin de fichier) :
```ts
// --- Emails automatiques personnalisables (OWNER/ADMIN) ---

router.get('/emails', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const items = await emailTemplateService.listForAdmin(req.membership!.clubId);
    res.json({ items });
  } catch (err) { handleError(err, res, next); }
});

router.get('/emails/:type', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await emailTemplateService.getForAdmin(req.membership!.clubId, asString(req.params.type)));
  } catch (err) { handleError(err, res, next); }
});

router.put('/emails/:type', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { subject, heading, bodyHtml, ctaLabel, footerNote } = req.body;
    const result = await emailTemplateService.upsert(req.membership!.clubId, asString(req.params.type), {
      subject, heading, bodyHtml, ctaLabel, footerNote,
    });
    res.json(result);
  } catch (err) { handleError(err, res, next); }
});

router.delete('/emails/:type', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    await emailTemplateService.remove(req.membership!.clubId, asString(req.params.type));
    res.json({ ok: true });
  } catch (err) { handleError(err, res, next); }
});

router.post('/emails/:type/preview', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { subject, heading, bodyHtml, ctaLabel, footerNote } = req.body;
    res.json(await emailTemplateService.renderPreview(req.membership!.clubId, asString(req.params.type), {
      subject, heading, bodyHtml, ctaLabel: ctaLabel ?? null, footerNote: footerNote ?? null,
    }));
  } catch (err) { handleError(err, res, next); }
});

router.post('/emails/:type/test', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { subject, heading, bodyHtml, ctaLabel, footerNote } = req.body;
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { email: true } });
    if (!me?.email) throw new Error('VALIDATION_ERROR');
    await emailTemplateService.sendTest(req.membership!.clubId, asString(req.params.type), {
      subject, heading, bodyHtml, ctaLabel: ctaLabel ?? null, footerNote: footerNote ?? null,
    }, me.email);
    res.json({ ok: true });
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4: Lancer (passe)**

Run: `cd backend && npx jest src/routes/__tests__/admin.emails.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

Run: `cd backend && npx tsc --noEmit`
Expected: aucune erreur.
```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.emails.routes.test.ts
git commit -m "feat(email): admin email template routes"
```

---

## Task 10: Brancher `notifications.ts` — inscriptions & organisateur

**Files:**
- Modify: `backend/src/email/notifications.ts`

> Objectif : remplacer chaque `buildXxxEmail({...})` par `renderClubEmail(type, vars, brand, override)`, en chargeant `override` **une fois** par type via `emailTemplates.getOverride(clubId, type)`. Les données (`firstName`, `activityName`, `dateLabel`, `url`…) sont déjà calculées dans chaque fonction : on les remappe en objet `vars`.

- [ ] **Step 1: Mettre à jour les imports**

En tête de `notifications.ts`, remplacer l'import des builders club par le moteur, et garder `brandFromClub` (= ex-`brandOf`). Remplacer :
```ts
import { Brand, PALOVA_BRAND } from './templates/layout';
import { ActivityType, OrganizerKind, PlayerAction, buildOrganizerEmail, buildPlayerEmail, buildMatchJoinEmail, buildMatchInviteEmail, buildMatchRemovedEmail, buildMatchLeftEmail, buildRefundEmail, buildMatchConfirmEmail, buildMatchCommentEmail, buildOpenMatchProposedEmail, buildOpenMatchChatEmail } from './templates/emails';
```
par :
```ts
import { Brand } from './templates/layout';
import { renderClubEmail, brandFromClub } from './registry';
import { emailTemplates } from '../services/emailTemplate.service';
```
Garder les types locaux `ActivityType`/`OrganizerKind`/`PlayerAction` : les redéfinir en haut de `notifications.ts` (ils ne viennent plus de `emails.ts`) :
```ts
type ActivityType = 'tournament' | 'event' | 'lesson';
type PlayerAction = 'confirmed' | 'waitlisted' | 'cancelled' | 'promoted';
type OrganizerKind = 'registration' | 'cancellation';
```

- [ ] **Step 2: Remplacer `brandOf` par `brandFromClub`**

Supprimer la fonction locale `brandOf(...)` et remplacer ses appels par `brandFromClub(club)` (même signature : `{ name, logoUrl, accentColor }`). Ajouter des helpers de vocabulaire en haut du fichier :
```ts
function refActivite(t: ActivityType): string { return t === 'tournament' ? 'le tournoi' : t === 'lesson' ? 'le cours' : "l'événement"; }
function typeActivite(t: ActivityType): string { return t === 'tournament' ? 'tournoi' : t === 'lesson' ? 'cours' : 'événement'; }
function placesPhrase(spotsLeft: number): string {
  return spotsLeft <= 0 ? 'La partie est désormais complète.' : `Il reste ${spotsLeft} place${spotsLeft > 1 ? 's' : ''}.`;
}
```

- [ ] **Step 3: Réécrire `sendTournamentPlayerEmails`, `sendEventPlayerEmail`, `sendLessonPlayerEmail`**

Ces 3 fonctions partagent la forme. Pour le **tournoi** (les autres sont identiques mutatis mutandis) :

```ts
async function sendTournamentPlayerEmails(reg, action: PlayerAction): Promise<void> {
  const t = reg.tournament;
  const brand = brandFromClub(t.club);
  const dateLabel = formatDateRangeFr(t.startTime, t.endTime, t.club.timezone);
  const url = clubAppUrl(t.club.slug, `/tournois/${t.id}`);
  const emailType = `registration.${action}`; // confirmed|waitlisted|cancelled|promoted
  const override = await emailTemplates.getOverride(t.club.id, emailType);
  const recipients = [
    { user: reg.captain, partner: reg.partner },
    { user: reg.partner, partner: reg.captain },
  ];
  for (const { user, partner } of recipients) {
    if (!user.email) continue;
    const coequipier = fullName(partner);
    const vars: Record<string, string> = {
      prenom: user.firstName, activite: t.name, ref_activite: refActivite('tournament'),
      type_activite: typeActivite('tournament'), club: t.club.name, date: dateLabel, lien: url,
      coequipier, phrase_coequipier: coequipier ? ` Vous êtes inscrit·e en binôme avec ${coequipier}.` : '',
    };
    const mail = renderClubEmail(emailType, vars, brand, override);
    const notifType = action === 'confirmed' ? 'registration.confirmed' : action === 'waitlisted' ? 'registration.waitlisted' : action === 'promoted' ? 'registration.promoted' : 'registration.cancelled';
    const { title, body } = playerNotifContent(action, t.name);
    await dispatch({ userId: user.id, clubId: t.club.id, category: 'MY_REGISTRATIONS', type: notifType, title, body, url, email: { to: user.email, subject: mail.subject, html: mail.html, text: mail.text } });
  }
}
```

Pour l'**event** : même chose avec `emailType = registration.${action}`, `vars` sans `coequipier`/`phrase_coequipier`, `ref_activite('event')`, url `/events/${e.id}`. Pour le **cours** : `ref_activite('lesson')`, `activite = ctx.activityName`, url `ctx.url`, `phrase_position`/`coequipier` non utilisés (les laisser à `''`).

> Pour `waitlisted`, ajouter `phrase_position` dans `vars` : `phrase_position: i.waitlistPosition ? ` (position ${i.waitlistPosition})` : ''`. La position est dans `reg.status === 'WAITLISTED'` ? Le code actuel ne passe pas de position au builder waitlisted joueur dans `sendTournamentPlayerEmails` (il ne l'a pas) → mettre `phrase_position: ''`. (La position reste hors v1 sur ce chemin, comportement actuel inchangé.)

- [ ] **Step 4: Réécrire `notifyOrganizers`**

```ts
async function notifyOrganizers(opts): Promise<void> {
  const staff = await organizers(opts.clubId);
  if (staff.length === 0) return;
  const adminUrl = clubAppUrl(opts.slug, opts.activityType === 'tournament' ? '/admin/tournaments' : opts.activityType === 'lesson' ? '/admin/lessons' : '/admin/events');
  const emailType = opts.kind === 'registration' ? 'organizer.registration' : 'organizer.cancellation';
  const override = await emailTemplates.getOverride(opts.clubId, emailType);
  for (const s of staff) {
    const vars: Record<string, string> = {
      prenom: s.firstName, joueurs: opts.playerNames, statut: opts.statusLabel,
      nb_inscrits: opts.confirmedCount != null ? String(opts.confirmedCount) : '',
      activite: opts.activityName, ref_activite: refActivite(opts.activityType), lien: adminUrl,
    };
    const mail = renderClubEmail(emailType, vars, opts.brand, override);
    const notifType = opts.kind === 'registration' ? 'organizer.registration' : 'organizer.cancellation';
    const notifTitle = opts.kind === 'registration' ? 'Nouvelle inscription' : 'Désinscription';
    const notifBody = opts.kind === 'registration' ? `${opts.playerNames} — ${opts.activityName} (${opts.statusLabel}).` : `${opts.playerNames} s'est désinscrit de « ${opts.activityName} ».`;
    await dispatch({ userId: s.id, clubId: opts.clubId, category: 'ORGANIZER', type: notifType, title: notifTitle, body: notifBody, url: adminUrl, email: { to: s.email, subject: mail.subject, html: mail.html, text: mail.text } });
  }
}
```

- [ ] **Step 5: Réécrire `notifyActivityCancelledByClub`**

Pour chacune des 3 branches (tournament/event/lesson), remplacer `buildPlayerEmail({... action:'cancelled' ...})` par :
```ts
const override = await emailTemplates.getOverride(club.id, 'activity.cancelled_by_club');
// … dans la boucle destinataires :
const vars = { prenom: user.firstName, activite: <nom>, ref_activite: refActivite(<type>), type_activite: typeActivite(<type>), club: club.name, date: dateLabel, lien: url };
const mail = renderClubEmail('activity.cancelled_by_club', vars, brand, override);
// email: user.email ? { to: user.email, subject: mail.subject, html: mail.html, text: mail.text } : undefined
```
(charger `override` une fois avant la boucle de chaque branche).

- [ ] **Step 6: Vérifier les suites de notifications**

Run:
```bash
cd backend && npx jest src/email/__tests__/notifications.registrations.test.ts src/email/__tests__/notifications.newevents.test.ts
```
Expected: PASS. Si une assertion vérifie un **subject** exact, il doit correspondre au défaut du registre (identique). Corriger toute assertion qui importait un builder supprimé.

- [ ] **Step 7: Commit**

```bash
git add backend/src/email/notifications.ts
git commit -m "feat(email): wire registry for registrations + organizer emails"
```

---

## Task 11: Brancher `notifications.ts` — parties ouvertes

**Files:**
- Modify: `backend/src/email/notifications.ts`

> Mapping par fonction (charger `override = await emailTemplates.getOverride(club.id, <type>)` avant l'envoi, puis `renderClubEmail(<type>, vars, brandFromClub(club), override)`). `lien` = même URL qu'aujourd'hui.

- [ ] **Step 1: Remapper chaque fonction**

| Fonction | type | vars (clé : source) |
|---|---|---|
| `notifyOpenMatchJoin` | `open_match.joined` | prenom: organizer.firstName · joueur: fullName(joiner) · terrain: resa.resource.name · date: dateLabel · club: club.name · phrase_places: placesPhrase(spotsLeft) · lien: url |
| `notifyMatchPartnersInvited` | `open_match.added` | prenom: p.user.firstName · phrase_par: byName ? `${byName} vous a ajouté·e à une partie de padel.` : 'Vous avez été ajouté·e à une partie de padel.' · terrain · date · club · lien |
| `notifyOpenMatchAdded` | `open_match.added` | prenom: added.firstName · phrase_par: organizer ? `${fullName(organizer)} vous a ajouté·e à une partie de padel.` : 'Vous avez été ajouté·e à une partie de padel.' · terrain · date · club · lien |
| `notifyReservationMemberAssigned` | `open_match.added` | prenom: member.firstName · phrase_par: 'Vous avez été ajouté·e à une réservation par le club.' · terrain · date: dateLabel · club · lien |
| `notifyOpenMatchRemoved` | `open_match.removed` | prenom: member.firstName · terrain · date · club · lien |
| `notifyOpenMatchLeft` | `open_match.left` | prenom: organizerP.user.firstName · joueur: fullName(leaver) · terrain · date · club · phrase_places: placesPhrase(spotsLeft) · lien |
| `notifyOpenMatchProposed` | `open_match.proposed` | prenom: c.user.firstName · terrain · date: dateLabel · club · niveau: levelLabel · phrase_places: placesPhrase(spotsLeft) · lien |
| `notifyOpenMatchChatMessage` | `open_match.message` | prenom: u.firstName · auteur: authorName · message: snippet · terrain · club · lien |

Exemple complet (`notifyOpenMatchJoin`) — remplacer le bloc `buildMatchJoinEmail({...})` :
```ts
const override = await emailTemplates.getOverride(club.id, 'open_match.joined');
const spotsLeft = Math.max(0, maxPlayers - resa.participants.length);
const mail = renderClubEmail('open_match.joined', {
  prenom: organizer.firstName, joueur: fullName(joiner), terrain: resa.resource.name,
  date: dateLabel, club: club.name, phrase_places: placesPhrase(spotsLeft), lien: url,
}, brandFromClub(club), override);
await dispatch({ userId: organizerP.userId, clubId: club.id, category: 'MY_GAMES', type: 'open_match.joined',
  title: 'Nouveau joueur dans ta partie', body: `${fullName(joiner)} a rejoint ta partie du ${dateLabel}.`,
  url, email: { to: organizer.email, subject: mail.subject, html: mail.html, text: mail.text } });
```
Pour `notifyOpenMatchChatMessage` et `notifyOpenMatchProposed` (boucles sur destinataires), charger `override` **une fois avant** la boucle.

- [ ] **Step 2: Vérifier les suites parties ouvertes**

Run:
```bash
cd backend && npx jest src/email/__tests__/notifications.openmatch.test.ts src/email/__tests__/notifications.openmatch-proposed.test.ts src/email/__tests__/notifications.openmatch-chat.test.ts src/email/__tests__/notifications.match.test.ts src/email/__tests__/match-emails.test.ts
```
Expected: PASS (corriger toute assertion liée à un builder supprimé / subject).

- [ ] **Step 3: Commit**

```bash
git add backend/src/email/notifications.ts
git commit -m "feat(email): wire registry for open-match emails"
```

---

## Task 12: Brancher `notifications.ts` — matchs & remboursement, puis purge `emails.ts`

**Files:**
- Modify: `backend/src/email/notifications.ts`
- Modify: `backend/src/email/templates/emails.ts`
- Modify: `backend/src/email/__tests__/emails.test.ts`

- [ ] **Step 1: Remapper matchs + remboursement**

| Fonction | type | vars |
|---|---|---|
| `notifyMatchPendingConfirmation` | `match.pending_confirmation` | prenom: mp.user.firstName · auteur: authorName · score: scoreLine · lien: matchUrl |
| `notifyNewMatchComment` (opts.isFirst) | `match.disputed` | prenom: r.firstName · auteur: authorName · score: scoreLine · extrait: excerpt · lien: matchUrl |
| `notifyNewMatchComment` (sinon) | `match.comment` | idem |
| `notifyReservationRefunded` | `payment.refunded` | prenom: resa.user.firstName · terrain: resa.resource.name · date: dateLabel · club: club.name · montant: amountLabel · support_solde: prepaid ? ' recrédité sur votre solde (carnet / porte-monnaie)' : '' · lien: url |

Pour `notifyNewMatchComment`, choisir le type avec `const emailType = opts.isFirst ? 'match.disputed' : 'match.comment';` puis `const override = await emailTemplates.getOverride(match.club.id, emailType);` avant la boucle destinataires.

- [ ] **Step 2: Supprimer les builders club de `emails.ts`**

Dans `backend/src/email/templates/emails.ts`, supprimer les fonctions et interfaces **club** désormais inutilisées : `buildPlayerEmail`, `buildOrganizerEmail`, `buildMatchJoinEmail`, `buildMatchInviteEmail`, `buildMatchRemovedEmail`, `buildMatchLeftEmail`, `buildOpenMatchProposedEmail`, `buildRefundEmail`, `buildMatchConfirmEmail`, `buildOpenMatchChatEmail`, `buildMatchCommentEmail` (+ leurs interfaces `*Input`, et les types `ActivityType`/`PlayerAction`/`OrganizerKind` qui vivent maintenant dans `notifications.ts`).
**Conserver** : `BuiltEmail`, `stripTags`, `buildBroadcastEmail` (+ `BroadcastEmailInput`), `buildVerificationEmail`, `buildPasswordResetEmail`.

- [ ] **Step 3: Nettoyer `emails.test.ts`**

Dans `backend/src/email/__tests__/emails.test.ts`, supprimer les `describe`/`it` qui testaient les builders supprimés. **Garder** les tests de `buildVerificationEmail`, `buildPasswordResetEmail`, `buildBroadcastEmail` (+ échappement/contraste/liens/date FR s'ils portent sur ces builders conservés). Si un util testé (ex. `escapeHtml`, `readableTextOn`) vient de `layout.ts`, le test reste valide.

- [ ] **Step 4: Compiler + suite email complète**

Run:
```bash
cd backend && npx tsc --noEmit && npx jest src/email
```
Expected: aucune erreur TS ; toutes les suites `src/email/**` PASS.

- [ ] **Step 5: Suite backend complète (détecte les call-sites oubliés)**

Run: `cd backend && npx jest`
Expected: PASS. Corriger toute suite (`tournament.service.test.ts`, `event.service.test.ts`, `lesson.service.test.ts`, etc.) qui importait un builder supprimé ou asserte un subject — les subjects par défaut sont identiques.

- [ ] **Step 6: Commit**

```bash
git add backend/src/email
git commit -m "feat(email): wire registry for match/refund emails; remove club builders"
```

---

## Task 13: Frontend — types & méthodes API

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Ajouter les types (près des autres types admin)**

```ts
// --- Emails automatiques personnalisables (admin) ---
export interface EmailVarDef { key: string; label: string; sample: string; }
export interface AdminEmailSummary { type: string; group: string; title: string; description: string; customized: boolean; }
export interface EmailDraft { subject: string; heading: string; bodyHtml: string; ctaLabel?: string; footerNote?: string; }
export interface AdminEmailDetail {
  type: string; group: string; title: string; description: string; hasCta: boolean;
  vars: EmailVarDef[];
  defaults: { subject: string; heading: string; bodyHtml: string; ctaLabel?: string; footerNote?: string };
  override: { subject: string; heading: string; bodyHtml: string; ctaLabel: string | null; footerNote: string | null } | null;
}
```

- [ ] **Step 2: Ajouter les méthodes (dans l'objet `api`, près de `getClubBroadcasts`)**

```ts
  adminListEmails: (clubId: string, token: string) =>
    request<{ items: AdminEmailSummary[] }>(`/api/clubs/${clubId}/admin/emails`, {}, token),
  adminGetEmail: (clubId: string, type: string, token: string) =>
    request<AdminEmailDetail>(`/api/clubs/${clubId}/admin/emails/${type}`, {}, token),
  adminSaveEmail: (clubId: string, type: string, draft: EmailDraft, token: string) =>
    request<{ unknownVars: string[] }>(`/api/clubs/${clubId}/admin/emails/${type}`, { method: 'PUT', body: JSON.stringify(draft) }, token),
  adminResetEmail: (clubId: string, type: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/emails/${type}`, { method: 'DELETE' }, token),
  adminPreviewEmail: (clubId: string, type: string, draft: EmailDraft, token: string) =>
    request<{ subject: string; html: string }>(`/api/clubs/${clubId}/admin/emails/${type}/preview`, { method: 'POST', body: JSON.stringify(draft) }, token),
  adminTestEmail: (clubId: string, type: string, draft: EmailDraft, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/emails/${type}/test`, { method: 'POST', body: JSON.stringify(draft) }, token),
```

- [ ] **Step 3: tsc + commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.
```bash
git add frontend/lib/api.ts
git commit -m "feat(email): frontend api types + methods"
```

---

## Task 14: Frontend — entrée nav + page liste `/admin/emails` (TDD)

**Files:**
- Modify: `frontend/app/admin/layout.tsx`
- Create: `frontend/app/admin/emails/page.tsx`
- Test: `frontend/__tests__/AdminEmails.test.tsx`

- [ ] **Step 1: Écrire le test de la page liste**

Créer `frontend/__tests__/AdminEmails.test.tsx` :

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import AdminEmailsPage from '@/app/admin/emails/page';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { fontUI: '', fontDisplay: '', text: '#000', textMute: '#555', textFaint: '#999', bg: '#fff', bgElev: '#fff', line: '#eee', accent: '#06c' } }) }));
jest.mock('@/lib/api', () => ({
  api: {
    adminListEmails: jest.fn().mockResolvedValue({ items: [
      { type: 'registration.confirmed', group: 'inscriptions', title: 'Inscription confirmée', description: 'd', customized: true },
      { type: 'payment.refunded', group: 'paiement', title: 'Remboursement', description: 'd', customized: false },
    ] }),
  },
}));

describe('AdminEmailsPage', () => {
  it('affiche les gabarits groupés avec badge Personnalisé/Défaut', async () => {
    render(<AdminEmailsPage />);
    await waitFor(() => expect(screen.getByText('Inscription confirmée')).toBeInTheDocument());
    expect(screen.getByText('Remboursement')).toBeInTheDocument();
    expect(screen.getByText('Personnalisé')).toBeInTheDocument();
    expect(screen.getByText('Défaut')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer (échoue)**

Run: `cd frontend && npx jest __tests__/AdminEmails.test.tsx`
Expected: FAIL — page inexistante.

- [ ] **Step 3: Créer la page liste**

> Avant d'écrire : consulter `frontend/node_modules/next/dist/docs/` si un doute sur les conventions Next 16. La page est un client component (`'use client'`), modèle calqué sur `app/admin/broadcast/page.tsx`.

Créer `frontend/app/admin/emails/page.tsx` :

```tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api, AdminEmailSummary } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';

const GROUP_LABEL: Record<string, string> = {
  inscriptions: 'Inscriptions', organisateur: 'Organisateur', parties: 'Parties ouvertes',
  matchs: 'Matchs', paiement: 'Paiement',
};
const GROUP_ORDER = ['inscriptions', 'organisateur', 'parties', 'matchs', 'paiement'];

export default function AdminEmailsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const [items, setItems] = useState<AdminEmailSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setItems((await api.adminListEmails(clubId, token)).items); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 6px', color: th.text }}>Emails</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 28px' }}>
        Personnalisez le contenu de chaque email automatique envoyé à vos membres.
      </p>
      {loading && <p style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</p>}
      {GROUP_ORDER.map((g) => {
        const groupItems = items.filter((i) => i.group === g);
        if (groupItems.length === 0) return null;
        return (
          <section key={g} style={{ marginBottom: 32 }}>
            <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 14px' }}>{GROUP_LABEL[g]}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groupItems.map((it) => (
                <Link key={it.type} href={`/admin/emails/${it.type}`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: th.bgElev, borderRadius: 14, padding: '14px 18px', border: `1px solid ${th.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>{it.title}</div>
                      <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{it.description}</div>
                    </div>
                    <span style={{ flexShrink: 0, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: it.customized ? th.accent : th.textFaint }}>
                      {it.customized ? 'Personnalisé' : 'Défaut'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Ajouter l'entrée nav**

Dans `frontend/app/admin/layout.tsx`, à côté de l'entrée Messages (broadcast, ~ligne 113) ajouter :
```ts
      { href: '/admin/emails', label: 'Emails', icon: 'mail' },
```

- [ ] **Step 5: Lancer (passe)**

Run: `cd frontend && npx jest __tests__/AdminEmails.test.tsx`
Expected: PASS.

- [ ] **Step 6: tsc + commit**

Run: `cd frontend && npx tsc --noEmit`
```bash
git add frontend/app/admin/emails/page.tsx frontend/app/admin/layout.tsx frontend/__tests__/AdminEmails.test.tsx
git commit -m "feat(email): admin emails list page + nav"
```

---

## Task 15: Frontend — éditeur `/admin/emails/[type]` (TDD)

**Files:**
- Create: `frontend/components/admin/email/EmailPreview.tsx`
- Create: `frontend/app/admin/emails/[type]/page.tsx`
- Test: `frontend/__tests__/AdminEmailEditor.test.tsx`

- [ ] **Step 1: Écrire le test de l'éditeur**

Créer `frontend/__tests__/AdminEmailEditor.test.tsx` :

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EmailEditorPage from '@/app/admin/emails/[type]/page';

jest.mock('next/navigation', () => ({ useParams: () => ({ type: 'registration.confirmed' }), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { fontUI: '', fontDisplay: '', text: '#000', textMute: '#555', textFaint: '#999', bg: '#fff', bgElev: '#fff', line: '#eee', accent: '#06c' } }) }));

const detail = {
  type: 'registration.confirmed', group: 'inscriptions', title: 'Inscription confirmée', description: 'd', hasCta: true,
  vars: [{ key: 'prenom', label: 'Prénom', sample: 'Marie' }, { key: 'activite', label: 'Activité', sample: 'Tournoi' }],
  defaults: { subject: 'Inscription confirmée — {{activite}}', heading: 'Inscription confirmée', bodyHtml: '<p>Bonjour {{prenom}}</p>', ctaLabel: 'Voir' },
  override: null,
};
const saveMock = jest.fn().mockResolvedValue({ unknownVars: [] });
jest.mock('@/lib/api', () => ({
  api: {
    adminGetEmail: jest.fn().mockResolvedValue(detail),
    adminSaveEmail: (...a: any[]) => saveMock(...a),
    adminResetEmail: jest.fn().mockResolvedValue({ ok: true }),
    adminPreviewEmail: jest.fn().mockResolvedValue({ subject: 's', html: '<html><body>aperçu</body></html>' }),
    adminTestEmail: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

describe('EmailEditorPage', () => {
  it('charge les défauts et permet d\'insérer une variable et de sauver', async () => {
    render(<EmailEditorPage />);
    await waitFor(() => expect(screen.getByDisplayValue('Inscription confirmée — {{activite}}')).toBeInTheDocument());
    // chip variable présent
    expect(screen.getByRole('button', { name: '{{prenom}}' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Lancer (échoue)**

Run: `cd frontend && npx jest __tests__/AdminEmailEditor.test.tsx`
Expected: FAIL — page inexistante.

- [ ] **Step 3: Créer le composant d'aperçu**

Créer `frontend/components/admin/email/EmailPreview.tsx` :

```tsx
'use client';
export function EmailPreview({ html }: { html: string }) {
  return (
    <iframe
      title="Aperçu de l'email"
      srcDoc={html}
      style={{ width: '100%', height: 520, border: '1px solid #e5e5e5', borderRadius: 12, background: '#fff' }}
      sandbox=""
    />
  );
}
```

- [ ] **Step 4: Créer la page éditeur**

> Client component. Champs contrôlés ; insertion de variable au curseur via une ref sur le champ actif ; aperçu via endpoint serveur (débounce 400 ms) ; test + reset. Consulter `frontend/node_modules/next/dist/docs/` au moindre doute sur `useParams`/routing Next 16.

Créer `frontend/app/admin/emails/[type]/page.tsx` :

```tsx
'use client';
import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, AdminEmailDetail, EmailDraft, EmailVarDef } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { EmailPreview } from '@/components/admin/email/EmailPreview';

type Field = 'subject' | 'heading' | 'bodyHtml' | 'ctaLabel';

export default function EmailEditorPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const router = useRouter();
  const clubId = club?.id;
  const type = String((useParams() as { type: string }).type);

  const [detail, setDetail] = useState<AdminEmailDetail | null>(null);
  const [draft, setDraft] = useState<EmailDraft>({ subject: '', heading: '', bodyHtml: '', ctaLabel: '', footerNote: '' });
  const [previewHtml, setPreviewHtml] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const focused = useRef<Field>('bodyHtml');
  const refs = {
    subject: useRef<HTMLInputElement>(null), heading: useRef<HTMLInputElement>(null),
    bodyHtml: useRef<HTMLTextAreaElement>(null), ctaLabel: useRef<HTMLInputElement>(null),
  };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    const d = await api.adminGetEmail(clubId, type, token);
    setDetail(d);
    const src = d.override ?? d.defaults;
    setDraft({ subject: src.subject, heading: src.heading, bodyHtml: src.bodyHtml, ctaLabel: src.ctaLabel ?? '', footerNote: src.footerNote ?? '' });
  }, [token, clubId, type]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  // Aperçu serveur débouncé.
  useEffect(() => {
    if (!token || !clubId || !detail) return;
    const h = setTimeout(async () => {
      try { setPreviewHtml((await api.adminPreviewEmail(clubId, type, draft, token)).html); } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(h);
  }, [token, clubId, type, draft, detail]);

  function insertVar(v: EmailVarDef) {
    const f = focused.current;
    const el = refs[f].current;
    const token2 = `{{${v.key}}}`;
    setDraft((d) => {
      const cur = (d[f] ?? '') as string;
      const start = el?.selectionStart ?? cur.length;
      const end = el?.selectionEnd ?? cur.length;
      return { ...d, [f]: cur.slice(0, start) + token2 + cur.slice(end) };
    });
  }

  async function save() {
    if (!token || !clubId) return;
    setBusy(true); setMsg(null);
    try {
      const res = await api.adminSaveEmail(clubId, type, draft, token);
      setMsg(res.unknownVars.length ? `Enregistré. Variables inconnues ignorées : ${res.unknownVars.map((v) => `{{${v}}}`).join(', ')}` : 'Enregistré ✅');
      await load();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function reset() {
    if (!token || !clubId) return;
    setBusy(true); setMsg(null);
    try { await api.adminResetEmail(clubId, type, token); await load(); setMsg('Réinitialisé au défaut.'); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function sendTest() {
    if (!token || !clubId) return;
    setBusy(true); setMsg(null);
    try { await api.adminTestEmail(clubId, type, draft, token); setMsg('Email de test envoyé.'); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  const labelStyle: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 6 };
  const inputStyle: CSSProperties = { height: 44, padding: '0 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 15 };
  const areaStyle: CSSProperties = { padding: '12px 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: 'monospace', fontSize: 14, minHeight: 150, resize: 'vertical' };

  if (!detail) return <p style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</p>;

  return (
    <div style={{ maxWidth: 1080, display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
      <button onClick={() => router.push('/admin/emails')} style={{ ...labelStyle, background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'start' }}>← Tous les emails</button>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, margin: 0, color: th.text }}>{detail.title}</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '-12px 0 0' }}>{detail.description}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 24 }}>
        {/* Colonne édition */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {detail.vars.map((v) => (
              <button key={v.key} type="button" title={v.label} onClick={() => insertVar(v)}
                style={{ fontFamily: 'monospace', fontSize: 12, padding: '4px 8px', borderRadius: 8, border: `1px solid ${th.line}`, background: th.bgElev, color: th.text, cursor: 'pointer' }}>
                {`{{${v.key}}}`}
              </button>
            ))}
          </div>
          <label style={labelStyle}>Objet
            <input ref={refs.subject} style={inputStyle} value={draft.subject} onFocus={() => (focused.current = 'subject')} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
          </label>
          <label style={labelStyle}>Titre
            <input ref={refs.heading} style={inputStyle} value={draft.heading} onFocus={() => (focused.current = 'heading')} onChange={(e) => setDraft((d) => ({ ...d, heading: e.target.value }))} />
          </label>
          <label style={labelStyle}>Corps (HTML)
            <textarea ref={refs.bodyHtml} style={areaStyle} value={draft.bodyHtml} onFocus={() => (focused.current = 'bodyHtml')} onChange={(e) => setDraft((d) => ({ ...d, bodyHtml: e.target.value }))} />
          </label>
          {detail.hasCta && (
            <label style={labelStyle}>Libellé du bouton
              <input ref={refs.ctaLabel} style={inputStyle} value={draft.ctaLabel} onFocus={() => (focused.current = 'ctaLabel')} onChange={(e) => setDraft((d) => ({ ...d, ctaLabel: e.target.value }))} />
            </label>
          )}
          {msg && <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.accent, margin: 0 }}>{msg}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Btn variant="primary" disabled={busy} onClick={save}>Enregistrer</Btn>
            <Btn variant="ghost" disabled={busy} onClick={sendTest}>Envoyer un test</Btn>
            <Btn variant="ghost" disabled={busy || !detail.override} onClick={reset}>Réinitialiser</Btn>
          </div>
        </div>

        {/* Colonne aperçu */}
        <div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, marginBottom: 6 }}>Aperçu</div>
          <EmailPreview html={previewHtml} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Lancer (passe)**

Run: `cd frontend && npx jest __tests__/AdminEmailEditor.test.tsx`
Expected: PASS.

- [ ] **Step 6: tsc + commit**

Run: `cd frontend && npx tsc --noEmit`
```bash
git add frontend/app/admin/emails/[type]/page.tsx frontend/components/admin/email/EmailPreview.tsx frontend/__tests__/AdminEmailEditor.test.tsx
git commit -m "feat(email): admin email editor page (fields, variables, preview, test, reset)"
```

---

## Task 16: Vérification finale & nettoyage

**Files:** (aucun nouveau ; runs de vérif)

- [ ] **Step 1: Suite backend complète + tsc**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: tout PASS, aucune erreur TS.

- [ ] **Step 2: Suites frontend ciblées + tsc**

Run:
```bash
cd frontend && npx jest __tests__/AdminEmails.test.tsx __tests__/AdminEmailEditor.test.tsx __tests__/AdminLayout.test.tsx && npx tsc --noEmit
```
Expected: PASS. (Ne pas se fier au run complet `npx jest` : flake BookingModal connu.)

- [ ] **Step 3: Smoke manuel (optionnel mais recommandé)**

Démarrer backend + frontend (cf. `CLAUDE.md`), se connecter en OWNER d'un club, ouvrir `/admin/emails`, éditer « Inscription confirmée », vérifier l'aperçu live, « Envoyer un test » (vérifier la console mailer en dev), « Réinitialiser ».

- [ ] **Step 4: Mettre à jour `CLAUDE.md`**

Ajouter une section « Emails personnalisables par club (admin) » résumant : registre `EMAIL_DEFS` + `renderClubEmail`, table `ClubEmailTemplate` (repli défaut), routes `/admin/emails*` (OWNER/ADMIN), assainissement `sanitize-html`, périmètre (canal email seulement, plateforme exclue), spec & plan.

- [ ] **Step 5: Commit final**

```bash
git add CLAUDE.md
git commit -m "docs(email): document customizable club emails"
```

---

## Self-Review (rempli)

**Spec coverage**
- §1 Modèle `ClubEmailTemplate` → Task 2. ✅
- §2 Registre `EmailDef`/`EMAIL_DEFS` → Tasks 3-4. ✅
- §3 `renderClubEmail` (substitution/échappement/assainissement/infoRows/text) → Task 5. ✅
- §4 Intégration `notifications.ts` (getOverride + vars) → Tasks 10-12. ✅
- Catalogue 17 types → Task 4 (data) + tests d'invariant. ✅
- §5 UI `/admin/emails` (liste + éditeur + chips + aperçu + test + reset) → Tasks 14-15 ; routes → Task 9. ✅
- §6 Sécurité (sanitize allowlist, échappement, validation, unknownVars) → Tasks 1,3,5,7. ✅
- §8 Tests → présents à chaque task. ✅
- §9 Fichiers touchés → couverts. ✅

**Placeholder scan** : pas de « TODO/TBD » ; les tables de mapping (Tasks 11-12) donnent des expressions concrètes ; tous les blocs de code sont complets.

**Type consistency** : `EmailOverride { subject, heading, bodyHtml, ctaLabel: string|null, footerNote: string|null }` utilisé identiquement dans registry/service/routes ; `renderClubEmail(type, vars, brand, override?)` signature stable ; clé Prisma composite `clubId_type` (du `@@unique([clubId, type])`) cohérente entre service et routes ; méthodes API (`adminListEmails`/`adminGetEmail`/`adminSaveEmail`/`adminResetEmail`/`adminPreviewEmail`/`adminTestEmail`) cohérentes entre `lib/api.ts` et les pages.

**Risque connu** : Tasks 10-12 modifient un fichier chargé (`notifications.ts`) ; le filet est `cd backend && npx jest` (Task 12 Step 5) qui exécute toutes les suites de services consommatrices et révèle tout call-site oublié.
