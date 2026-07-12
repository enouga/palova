# Emails admin : éditeur riche WYSIWYG + gabarit « Éditorial épuré » — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le textarea « Corps (HTML) » de `/admin/emails/[type]` par un éditeur riche TipTap (jetons de variables lisibles, photos), redessiner le gabarit HTML des emails (direction « Éditorial épuré ») et ouvrir l'accès au rôle STAFF.

**Architecture:** Le format stocké reste le HTML avec placeholders `{{clé}}` (`ClubEmailTemplate`, aucune migration). La conversion `{{clé}}` ↔ jetons se fait côté client (helpers purs `lib/emailTokens.ts`). Le backend gagne : un `renderLayout` réécrit (Brand étendu avec coordonnées + manageUrl), la balise `img` dans la sanitisation (sources restreintes), une passe de décoration au rendu (absolutisation des `/uploads/`, style images, couleur des liens, blockquotes), une route d'upload d'images d'email, et `requireClubMember('STAFF')` sur les routes emails.

**Tech Stack:** TipTap v3 (`@tiptap/react`, `@tiptap/starter-kit`, extensions image/text-align/text-style/color), sanitize-html (existant), multer (existant), Express 5, Next.js 16 / React 19.

**Spec:** `docs/superpowers/specs/2026-07-12-emails-admin-editeur-riche-design.md`

---

## Notes d'exécution (Windows, ce repo)

- **Shims npm cassés** sur cette machine : ne PAS utiliser `npx jest` / `npx tsc`. Utiliser :
  - jest : `node node_modules/jest/bin/jest.js <chemins>` (depuis `backend/` ou `frontend/`)
  - tsc : `node node_modules/typescript/bin/tsc --noEmit`
- **Aucune migration Prisma** dans ce plan.
- Eric édite parfois le repo en parallèle : à chaque commit, `git add` **uniquement les fichiers listés** dans la tâche, jamais `git add -A`.
- Le full-suite jest frontend a un flake connu (BookingModal) : la porte de validation = suites **scopées** + tsc.
- Sur un doute TipTap v2 vs v3 : ce plan suppose la v3 (`npm install` résout la dernière). Si npm installe une v2.x, installer en plus `@tiptap/extension-underline` et `@tiptap/extension-link` et les ajouter aux extensions (en v2 le StarterKit ne les inclut pas) ; les `configure({ underline: false, link: ... })` sur StarterKit sont alors à retirer.

---

### Task 1 : Gabarit « Éditorial épuré » (`layout.ts`) + Brand étendu

**Files:**
- Modify: `backend/src/email/templates/layout.ts`
- Test (create): `backend/src/email/__tests__/layout.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `backend/src/email/__tests__/layout.test.ts` :

```ts
import { renderLayout, Brand } from '../templates/layout';

const clubBrand: Brand = {
  name: 'Padel Arena Paris',
  logoUrl: 'http://localhost:3001/uploads/logos/x.png',
  accentColor: '#5e93da',
  address: '12 rue du Padel, Paris',
  phone: '01 23 45 67 89',
  email: 'contact@arena.fr',
  manageUrl: 'https://padel-arena-paris.palova.fr/me/profile',
};

const base = { heading: 'Titre', introHtml: '<p>Corps</p>' };

describe('renderLayout — gabarit « Éditorial épuré »', () => {
  it('liseré en tête à la couleur du club', () => {
    const html = renderLayout({ brand: clubBrand, ...base });
    expect(html).toContain('background:#5e93da');
    expect(html).toContain('height:5px');
  });

  it('en-tête centré : logo + nom en petites capitales', () => {
    const html = renderLayout({ brand: clubBrand, ...base });
    expect(html).toContain('src="http://localhost:3001/uploads/logos/x.png"');
    expect(html).toContain('text-transform:uppercase');
    expect(html).toContain('Padel Arena Paris');
  });

  it('sans logo : tuile encre avec l\'initiale', () => {
    const html = renderLayout({ brand: { ...clubBrand, logoUrl: null }, ...base });
    expect(html).toContain('>P</td>');
    expect(html).toContain('background:#181d26');
  });

  it('titre en serif centré', () => {
    const html = renderLayout({ brand: clubBrand, ...base });
    expect(html).toMatch(/<h1[^>]*Georgia[^>]*>/);
    expect(html).toMatch(/<h1[^>]*text-align:center[^>]*>/);
  });

  it('CTA = pill sombre', () => {
    const html = renderLayout({ brand: clubBrand, ...base, ctaLabel: 'Voir', ctaUrl: 'https://x.fr' });
    expect(html).toContain('border-radius:999px');
    expect(html).toContain('href="https://x.fr"');
    expect(html).toMatch(/bgcolor="#181d26"/);
  });

  it('pied de page : coordonnées du club + « Gérer mes notifications » + Palova', () => {
    const html = renderLayout({ brand: clubBrand, ...base });
    expect(html).toContain('12 rue du Padel, Paris');
    expect(html).toContain('01 23 45 67 89');
    expect(html).toContain('contact@arena.fr');
    expect(html).toContain('href="https://padel-arena-paris.palova.fr/me/profile"');
    expect(html).toContain('Gérer mes notifications');
    expect(html).toContain('Envoyé avec Palova');
  });

  it('coordonnées absentes : lignes omises proprement', () => {
    const html = renderLayout({ brand: { name: 'Palova', logoUrl: null, accentColor: '#5e93da' }, ...base });
    expect(html).not.toContain('Gérer mes notifications');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
    expect(html).toContain('Envoyé avec Palova');
  });

  it('codeBlock (emails plateforme) toujours rendu', () => {
    const html = renderLayout({ brand: clubBrand, ...base, codeBlock: { code: '123456' } });
    expect(html).toContain('123456');
    expect(html).toContain('Courier');
  });

  it('infoRows entre filets fins, valeur à droite', () => {
    const html = renderLayout({ brand: clubBrand, ...base, infoRows: [{ label: 'Date', value: 'demain' }] });
    expect(html).toContain('border-top:1px solid #e8eaee');
    expect(html).toContain('demain');
  });
});
```

- [ ] **Step 2 : Vérifier qu'ils échouent**

Depuis `backend/` : `node node_modules/jest/bin/jest.js src/email/__tests__/layout.test.ts`
Attendu : FAIL (liseré/pied de page absents de l'ancien gabarit ; les champs `address`… n'existent pas sur `Brand` → erreurs TS).

- [ ] **Step 3 : Réécrire `layout.ts`**

Dans `backend/src/email/templates/layout.ts` : étendre `Brand` et remplacer **intégralement** `renderLayout` (garder `PALOVA_BRAND`, `darken`, `escapeHtml`, `readableTextOn`, `InfoRow`, `LayoutInput` inchangés — `darken`/`readableTextOn` restent exportés car testés/utilisés ailleurs).

```ts
export interface Brand {
  name: string;
  logoUrl: string | null;
  accentColor: string;
  /** Coordonnées du club pour le pied de page (facultatives — lignes omises si absentes). */
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  /** URL « Gérer mes notifications » (profil membre sur le sous-domaine du club). */
  manageUrl?: string | null;
}
```

```ts
export function renderLayout(input: LayoutInput): string {
  const { brand, preheader, heading, introHtml, codeBlock, infoRows = [], ctaLabel, ctaUrl, footerNote } = input;
  const accent = brand.accentColor || PALOVA_BRAND.accentColor;

  // Palette « Éditorial épuré » : encre froide, hairlines, fond neutre.
  const INK = '#181d26';
  const BODY = '#4a5261';
  const MUTE = '#8a93a3';
  const FAINT = '#9aa2b0';
  const HAIR = '#e8eaee';
  const SERIF = "Georgia,'Times New Roman',serif";
  const SANS = 'Helvetica,Arial,sans-serif';

  // En-tête centré : logo (image) ou tuile encre avec l'initiale du club.
  const initial = escapeHtml((brand.name || 'P').trim().charAt(0).toUpperCase());
  const logo = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" height="36" style="display:inline-block;height:36px;width:auto;max-height:36px;border-radius:9px;border:0;outline:none;text-decoration:none;" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td width="36" height="36" style="width:36px;height:36px;background:${INK};border-radius:9px;text-align:center;vertical-align:middle;font-family:${SANS};font-size:17px;font-weight:800;color:#ffffff;">${initial}</td></tr></table>`;

  const codeHtml = codeBlock
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:22px 0 14px;">
        <tr><td align="center" style="background:#f4f6f9;border:1px solid ${HAIR};border-radius:14px;padding:22px 16px;">
          <div style="font-family:${SANS};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTE};margin-bottom:8px;">${escapeHtml(codeBlock.caption || 'Votre code')}</div>
          <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:${INK};font-family:'Courier New',Courier,monospace;">${escapeHtml(codeBlock.code)}</div>
        </td></tr>
      </table>`
    : '';

  const infoTable = infoRows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0 4px;border-collapse:collapse;border-top:1px solid ${HAIR};">
        ${infoRows
          .map(
            (row) => `<tr>
              <td style="padding:9px 0;font-family:${SANS};font-size:13.5px;color:${MUTE};width:38%;vertical-align:top;border-bottom:1px solid ${HAIR};">${escapeHtml(row.label)}</td>
              <td align="right" style="padding:9px 0;font-family:${SANS};font-size:13.5px;color:${INK};font-weight:600;text-align:right;border-bottom:1px solid ${HAIR};">${escapeHtml(row.value)}</td>
            </tr>`,
          )
          .join('')}
      </table>`
    : '';

  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:26px auto 6px;">
          <tr><td bgcolor="${INK}" style="border-radius:999px;background:${INK};">
            <a href="${ctaUrl}" style="display:inline-block;padding:13px 28px;font-family:${SANS};font-size:14.5px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(ctaLabel)}</a>
          </td></tr>
        </table>`
      : '';

  const note = footerNote
    ? `<p style="margin:18px 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${FAINT};text-align:center;">${escapeHtml(footerNote)}</p>`
    : '';

  const coordParts = [brand.address, brand.phone, brand.email].filter(Boolean) as string[];
  const coordLine = `<strong style="color:#5d6675;">${escapeHtml(brand.name)}</strong>${coordParts.length ? ' · ' + coordParts.map(escapeHtml).join(' · ') : ''}`;
  const manageLink = brand.manageUrl
    ? `<a href="${brand.manageUrl}" style="color:${FAINT};text-decoration:underline;">Gérer mes notifications</a> · `
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader || heading)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f5f7;padding:28px 0;font-family:${SANS};">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(24,29,38,0.08);">
        <tr><td bgcolor="${accent}" style="height:5px;line-height:5px;font-size:0;background:${accent};">&nbsp;</td></tr>
        <tr><td align="center" style="padding:28px 30px 0;">
          ${logo}
          <div style="margin-top:12px;font-family:${SANS};font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${INK};">${escapeHtml(brand.name)}</div>
        </td></tr>
        <tr><td style="padding:16px 34px 30px;">
          <h1 style="margin:12px 0 16px;font-family:${SERIF};font-size:26px;line-height:34px;font-weight:400;color:${INK};text-align:center;">${escapeHtml(heading)}</h1>
          <div style="font-family:${SANS};font-size:15px;line-height:24px;color:${BODY};">${introHtml}</div>
          ${codeHtml}
          ${infoTable}
          ${cta}
          ${note}
        </td></tr>
        <tr><td align="center" style="border-top:1px solid ${HAIR};padding:18px 30px 22px;font-family:${SANS};font-size:11.5px;line-height:19px;color:${FAINT};">
          ${coordLine}<br/>
          ${manageLink}Envoyé avec Palova
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
```

⚠️ L'ancienne ligne hors-carte « Envoyé par Palova · Réservez vos terrains de padel » disparaît (remplacée par le pied de page dans la carte).

- [ ] **Step 4 : Lancer les tests du gabarit + les suites email existantes**

Depuis `backend/` :
`node node_modules/jest/bin/jest.js src/email`
Attendu : `layout.test.ts` PASS. Si `emails.test.ts` ou `registry.test.ts` échouent sur des assertions de l'ancien markup (dégradé d'en-tête, fond `#f1eee5`), adapter **ces assertions** au nouveau gabarit (liseré, pied de page) sans affaiblir ce qu'elles testaient (logo présent, code présent, échappement).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/email/templates/layout.ts backend/src/email/__tests__/layout.test.ts backend/src/email/__tests__/emails.test.ts backend/src/email/__tests__/registry.test.ts
git commit -m "feat(emails): gabarit editorial epure (liseré club, titre serif, CTA pill, pied de page complet)"
```

---

### Task 2 : `brandFromClub` enrichi + selects élargis

**Files:**
- Modify: `backend/src/email/registry.ts` (brandFromClub)
- Modify: `backend/src/email/notifications.ts` (constante `EMAIL_CLUB_SELECT` + remplacement des selects club)
- Modify: `backend/src/services/emailTemplate.service.ts` (`loadBrand`)
- Test: `backend/src/email/__tests__/registry.test.ts`

- [ ] **Step 1 : Test qui échoue**

Ajouter dans `registry.test.ts` :

```ts
describe('brandFromClub — coordonnées & manageUrl', () => {
  it('construit adresse jointe, téléphone, email et manageUrl depuis le slug', () => {
    const b = brandFromClub({
      name: 'Arena', logoUrl: null, accentColor: '#5e93da',
      slug: 'arena', address: '12 rue du Padel', city: 'Paris',
      contactPhone: '01 23 45 67 89', contactEmail: 'c@arena.fr',
    });
    expect(b.address).toBe('12 rue du Padel, Paris');
    expect(b.phone).toBe('01 23 45 67 89');
    expect(b.email).toBe('c@arena.fr');
    expect(b.manageUrl).toContain('arena');
    expect(b.manageUrl).toContain('/me/profile');
  });

  it('champs absents → null (jamais undefined dans le rendu)', () => {
    const b = brandFromClub({ name: 'Arena', logoUrl: null, accentColor: '#5e93da' });
    expect(b.address).toBeNull();
    expect(b.phone).toBeNull();
    expect(b.email).toBeNull();
    expect(b.manageUrl).toBeNull();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js src/email/__tests__/registry.test.ts` → FAIL (TS : propriétés inconnues).

- [ ] **Step 3 : Implémenter**

Dans `registry.ts`, remplacer `brandFromClub` (et compléter l'import de links) :

```ts
import { absoluteAsset, clubAppUrl } from './links';

/** Brand email d'un club (logo en URL absolue, coordonnées pour le pied de page, repli Palova). */
export function brandFromClub(club: {
  name: string; logoUrl: string | null; accentColor: string;
  slug?: string | null; address?: string | null; city?: string | null;
  contactPhone?: string | null; contactEmail?: string | null;
}): Brand {
  const address = [club.address, club.city].filter(Boolean).join(', ');
  return {
    name: club.name || PALOVA_BRAND.name,
    logoUrl: absoluteAsset(club.logoUrl),
    accentColor: club.accentColor || PALOVA_BRAND.accentColor,
    address: address || null,
    phone: club.contactPhone || null,
    email: club.contactEmail || null,
    manageUrl: club.slug ? clubAppUrl(club.slug, '/me/profile') : null,
  };
}
```

Dans `notifications.ts`, déclarer près du haut du fichier :

```ts
/** Select club partagé par tous les emails (identité + coordonnées du pied de page). */
const EMAIL_CLUB_SELECT = {
  id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true,
  address: true, city: true, contactPhone: true, contactEmail: true,
} as const;
```

Puis remplacer **chaque** occurrence de
`club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } }`
par `club: { select: EMAIL_CLUB_SELECT }` (≈ 8 occurrences : includes tournoi, event, et les requêtes réservation/partie/chat — les repérer avec `grep -n "accentColor: true" backend/src/email/notifications.ts`).

Dans `emailTemplate.service.ts`, élargir `loadBrand` :

```ts
private async loadBrand(clubId: string): Promise<Brand> {
  const club = await prisma.club.findUniqueOrThrow({
    where: { id: clubId },
    select: { name: true, slug: true, logoUrl: true, accentColor: true, address: true, city: true, contactPhone: true, contactEmail: true },
  });
  return brandFromClub(club);
}
```

- [ ] **Step 4 : Lancer** — `node node_modules/jest/bin/jest.js src/email src/services/__tests__/emailTemplate.service.test.ts` → PASS, puis `node node_modules/typescript/bin/tsc --noEmit` → 0 erreur.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/email/registry.ts backend/src/email/notifications.ts backend/src/services/emailTemplate.service.ts backend/src/email/__tests__/registry.test.ts
git commit -m "feat(emails): coordonnees club + lien notifications dans le pied de page (Brand etendu)"
```

---

### Task 3 : Sanitisation `img` + décoration du corps au rendu + limite 20 000

**Files:**
- Modify: `backend/src/email/registry.ts` (SANITIZE_OPTS, `decorateBodyHtml`, `renderClubEmail`)
- Modify: `backend/src/services/emailTemplate.service.ts` (limite)
- Test: `backend/src/email/__tests__/registry.test.ts`, `backend/src/services/__tests__/emailTemplate.service.test.ts`

- [ ] **Step 1 : Tests qui échouent**

Dans `registry.test.ts` :

```ts
describe('sanitizeBodyHtml — images', () => {
  it('conserve les img /uploads et http(s), rejette les autres sources', () => {
    expect(sanitizeBodyHtml('<img src="/uploads/email-images/a.png" alt="x">')).toContain('/uploads/email-images/a.png');
    expect(sanitizeBodyHtml('<img src="https://exemple.fr/a.png">')).toContain('https://exemple.fr/a.png');
    expect(sanitizeBodyHtml('<img src="javascript:alert(1)">')).not.toContain('<img');
    expect(sanitizeBodyHtml('<img alt="sans src">')).not.toContain('<img');
    expect(sanitizeBodyHtml('<img src="/etc/passwd">')).not.toContain('<img');
  });
});

describe('decorateBodyHtml', () => {
  it('absolutise les /uploads, style les images, colore les liens', () => {
    const out = decorateBodyHtml('<p><img src="/uploads/email-images/a.png" alt="" /><a href="https://x.fr">x</a></p>', '#5e93da');
    expect(out).toContain('/uploads/email-images/a.png');
    expect(out).toMatch(/src="https?:\/\/[^"]+\/uploads\/email-images\/a\.png"/);
    expect(out).toContain('max-width:100%');
    expect(out).toContain('<a style="color:#5e93da;"');
  });

  it('style les blockquotes sans style', () => {
    const out = decorateBodyHtml('<blockquote>citation</blockquote>', '#5e93da');
    expect(out).toContain('border-left:3px solid');
  });
});

it('renderClubEmail : une image uploadée dans un corps personnalisé arrive absolutisée et stylée', () => {
  const mail = renderClubEmail('registration.confirmed', vars, brand, {
    subject: 's', heading: 'h',
    bodyHtml: '<p>ok</p><img src="/uploads/email-images/a.png" alt="affiche">',
    ctaLabel: null, footerNote: null,
  });
  expect(mail.html).toMatch(/src="https?:\/\/[^"]+\/uploads\/email-images\/a\.png"/);
  expect(mail.html).toContain('max-width:100%');
});
```

(Importer `decorateBodyHtml` dans les imports du test.)

Dans `emailTemplate.service.test.ts` :

```ts
it('upsert accepte un corps de 15 000 caractères et refuse au-delà de 20 000', async () => {
  const svc = new EmailTemplateService();
  const ok = { subject: 's', heading: 'h', bodyHtml: '<p>' + 'a'.repeat(15000) + '</p>' };
  await expect(svc.upsert('c1', 'registration.confirmed', ok)).resolves.toBeTruthy();
  const tooBig = { subject: 's', heading: 'h', bodyHtml: '<p>' + 'a'.repeat(20001) + '</p>' };
  await expect(svc.upsert('c1', 'registration.confirmed', tooBig)).rejects.toThrow('VALIDATION_ERROR');
});
```

(S'aligner sur la façon dont la suite existante instancie le service et mocke prisma — reprendre le même harnais.)

- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js src/email/__tests__/registry.test.ts src/services/__tests__/emailTemplate.service.test.ts` → FAIL.

- [ ] **Step 3 : Implémenter dans `registry.ts`**

Étendre `SANITIZE_OPTS` :

```ts
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'span', 'h2', 'h3', 'blockquote', 'img'],
  allowedAttributes: { a: ['href'], p: ['style'], span: ['style'], h2: ['style'], h3: ['style'], img: ['src', 'alt'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  // Une image n'est gardée que si sa source est http(s) ou un chemin /uploads/ de Palova.
  exclusiveFilter: (frame) =>
    frame.tag === 'img' &&
    !(/^https?:\/\//i.test(frame.attribs.src || '') || (frame.attribs.src || '').startsWith('/uploads/')),
  allowedStyles: { /* inchangé */ },
  disallowedTagsMode: 'discard',
};
```

Ajouter la passe de décoration (après `sanitizeBodyHtml`) :

```ts
/**
 * Décore le corps AU RENDU (jamais au stockage) : sources /uploads absolutisées,
 * style des images, liens à l'accent, blockquotes/h2/h3 sans style → style du gabarit.
 * Limitation assumée : un h2/h3 déjà stylé (ex. text-align de l'éditeur) garde son style
 * et ne reçoit pas la police serif.
 */
export function decorateBodyHtml(html: string, accent: string): string {
  return html
    .replace(/(<img\b[^>]*\bsrc=")(\/uploads\/[^"]+)"/gi, (_m, pre: string, p: string) => `${pre}${absoluteAsset(p)}"`)
    .replace(/<img\b/gi, '<img style="max-width:100%;height:auto;border-radius:12px;"')
    .replace(/<a\b(?![^>]*\bstyle=)/gi, `<a style="color:${accent};"`)
    .replace(/<blockquote\b(?![^>]*\bstyle=)/gi, '<blockquote style="margin:14px 0;padding:8px 16px;border-left:3px solid #d8dce3;color:#5d6675;font-style:italic;"')
    .replace(/<h2\b(?![^>]*\bstyle=)/gi, `<h2 style="font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:26px;font-weight:600;color:#181d26;margin:18px 0 8px;"`)
    .replace(/<h3\b(?![^>]*\bstyle=)/gi, `<h3 style="font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:24px;font-weight:600;color:#181d26;margin:16px 0 6px;"`);
}
```

Dans `renderClubEmail`, décorer l'intro juste avant `renderLayout` :

```ts
const accent = brand.accentColor || PALOVA_BRAND.accentColor;
const decoratedIntro = decorateBodyHtml(introHtml, accent);
const html = renderLayout({ brand, preheader: subject, heading, introHtml: decoratedIntro, infoRows, ctaLabel, ctaUrl, footerNote });
```

Dans `emailTemplate.service.ts`, la garde de longueur passe de `10000` à `20000` :

```ts
if (subject.length > 200 || heading.length > 200 || bodyRaw.length > 20000) throw new Error('VALIDATION_ERROR');
```

- [ ] **Step 4 : Lancer** — mêmes suites que Step 2 → PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/email/registry.ts backend/src/services/emailTemplate.service.ts backend/src/email/__tests__/registry.test.ts backend/src/services/__tests__/emailTemplate.service.test.ts
git commit -m "feat(emails): images dans le corps (sanitisation restreinte + absolutisation + style au rendu)"
```

---

### Task 4 : Défauts réaccordés (encadrés gris → blockquote)

**Files:**
- Modify: `backend/src/email/registry.ts` (4 défauts dans `EMAIL_DEFS`)
- Test: `backend/src/email/__tests__/registry.test.ts` (adapter si besoin)

- [ ] **Step 1 : Remplacer les 4 corps par défaut** qui portent l'encadré gris daté (`background:#f4f4f5`) :

- `open_match.message` → `bodyHtml: '<p>Bonjour {{prenom}},</p><p>Un nouveau message a été posté dans ta partie :</p><blockquote><strong>{{auteur}}</strong> : {{message}}</blockquote>'`
- `dm.message` → `bodyHtml: '<p>Bonjour {{prenom}},</p><p>Vous avez reçu un message privé :</p><blockquote><strong>{{auteur}}</strong> : {{message}}</blockquote>'`
- `match.disputed` → `bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{auteur}}</strong> a contesté le résultat (<strong>{{score}}</strong>) et a laissé un message :</p><blockquote>{{extrait}}</blockquote>'`
- `match.comment` → `bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{auteur}}</strong> a écrit dans la discussion du litige (<strong>{{score}}</strong>) :</p><blockquote>{{extrait}}</blockquote>'`

(Le style du blockquote vient de `decorateBodyHtml` — Task 3.)

- [ ] **Step 2 : Lancer** — `node node_modules/jest/bin/jest.js src/email` ; si un test assertait `#f4f4f5` ou la structure de l'ancien encadré, l'adapter (le contenu `{{extrait}}`/auteur doit toujours être présent).

- [ ] **Step 3 : Commit**

```bash
git add backend/src/email/registry.ts backend/src/email/__tests__/registry.test.ts
git commit -m "refactor(emails): defauts chat/dm/litige en blockquote (style du gabarit)"
```

---

### Task 5 : Accès STAFF + route d'upload `POST /emails/images`

**Files:**
- Modify: `backend/src/routes/admin.ts` (6 routes emails + nouvelle route upload)
- Modify: `backend/src/utils/uploads.ts` (`EMAIL_IMAGES_DIR`)
- Test: `backend/src/routes/__tests__/admin.emails.routes.test.ts`

- [ ] **Step 1 : Tests qui échouent**

Dans `admin.emails.routes.test.ts` : ajouter `import fs from 'fs';` en tête, **remplacer** le test « 403 pour STAFF » par :

```ts
it('200 pour STAFF (accès élargi à toute l\'équipe)', async () => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
  expect((await request(app).get(base).set(auth)).status).toBe(200);
});
```

et ajouter :

```ts
describe('POST /emails/images', () => {
  it('200 pour STAFF : écrit le fichier et renvoie une URL /uploads/email-images/', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    const write = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);
    const res = await request(app).post(`${base}/images`).set(auth)
      .attach('image', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\/email-images\/club-demo-\d+\.png$/);
    expect(write).toHaveBeenCalled();
    write.mockRestore();
  });

  it('400 pour un format non supporté', async () => {
    const res = await request(app).post(`${base}/images`).set(auth)
      .attach('image', Buffer.from('x'), { filename: 'a.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
  });

  it('401 sans token', async () => {
    expect((await request(app).post(`${base}/images`)).status).toBe(401);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.emails.routes.test.ts` → FAIL (403 pour STAFF, 404 sur /images).

- [ ] **Step 3 : Implémenter**

`backend/src/utils/uploads.ts` : ajouter

```ts
export const EMAIL_IMAGES_DIR = path.join(UPLOADS_DIR, 'email-images'); // images insérées dans les emails personnalisés
```

et `fs.mkdirSync(EMAIL_IMAGES_DIR, { recursive: true });` dans `ensureUploadDirs()`.

`backend/src/routes/admin.ts` :
1. Sur les **6 routes** `/emails*` existantes : `requireClubMember('ADMIN')` → `requireClubMember('STAFF')` et mettre à jour le commentaire de section (`--- Emails automatiques personnalisables (STAFF et +) ---`).
2. Ajouter `EMAIL_IMAGES_DIR` à l'import depuis `../utils/uploads`.
3. Ajouter après la route `/emails/:type/test` (même pattern que l'upload d'affiche d'annonce) :

```ts
const emailImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Image insérée dans le corps d'un email personnalisé (JPEG/PNG/WebP, 5 Mo max) → { url }.
router.post('/emails/images', requireClubMember('STAFF'), (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  emailImageUpload.single('image')(req, res, async (err: unknown) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return void res.status(400).json({ error: 'Image trop lourde (5 Mo max)' });
        }
        return next(err as Error);
      }
      const file = req.file;
      const ext = file && EXT_BY_MIME[file.mimetype];
      if (!file || !ext) return void res.status(400).json({ error: 'Format d’image non supporté (JPEG, PNG ou WebP)' });
      ensureUploadDirs();
      const filename = `${req.membership!.clubId}-${Date.now()}.${ext}`;
      await fs.promises.writeFile(path.join(EMAIL_IMAGES_DIR, filename), file.buffer);
      res.json({ url: `/uploads/email-images/${filename}` });
    } catch (e) { handleError(e, res, next); }
  });
});
```

⚠️ Vérifier que les autres routes `/emails/:type` sont déclarées avec des **méthodes** différentes de POST (c'est le cas : GET/PUT/DELETE) — pas de collision avec `/emails/images`.

ℹ️ Côté frontend, **rien à changer pour la sidebar** : la nav de `frontend/app/admin/layout.tsx` n'est pas gatée par rôle — l'entrée « Emails » est déjà visible pour un STAFF (seule l'API renvoyait 403 jusqu'ici).

- [ ] **Step 4 : Lancer** — même suite → PASS, puis `node node_modules/typescript/bin/tsc --noEmit` → 0 erreur.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/utils/uploads.ts backend/src/routes/__tests__/admin.emails.routes.test.ts
git commit -m "feat(emails): acces STAFF aux emails + upload d'images de corps (uploads/email-images)"
```

---

### Task 6 : Helpers purs `frontend/lib/emailTokens.ts`

**Files:**
- Create: `frontend/lib/emailTokens.ts`
- Test (create): `frontend/__tests__/emailTokens.test.ts`

- [ ] **Step 1 : Tests qui échouent**

```ts
import { storedToEditorHtml, editorHtmlToStored, plainToEditorHtml, editorHtmlToPlain } from '@/lib/emailTokens';

const vars = [
  { key: 'prenom', label: 'Prénom' },
  { key: 'activite', label: 'Activité' },
];

describe('emailTokens', () => {
  it('storedToEditorHtml : {{clé}} connue → span data-var avec libellé', () => {
    expect(storedToEditorHtml('<p>Bonjour {{prenom}}</p>', vars))
      .toBe('<p>Bonjour <span data-var="prenom">Prénom</span></p>');
  });

  it('storedToEditorHtml : clé inconnue laissée telle quelle (visible)', () => {
    expect(storedToEditorHtml('<p>{{mystere}}</p>', vars)).toBe('<p>{{mystere}}</p>');
  });

  it('editorHtmlToStored : les spans data-var (même enrichis par TipTap) redeviennent {{clé}}', () => {
    expect(editorHtmlToStored('<p>Salut <span class="email-var" data-var="prenom">Prénom</span> !</p>'))
      .toBe('<p>Salut {{prenom}} !</p>');
  });

  it('round-trip HTML riche : gras + jeton', () => {
    const stored = '<p><strong>Bonjour {{prenom}}</strong>, votre place à {{activite}} est confirmée.</p>';
    expect(editorHtmlToStored(storedToEditorHtml(stored, vars))).toBe(stored);
  });

  it('plainToEditorHtml : texte échappé + jetons, une seule ligne <p>', () => {
    expect(plainToEditorHtml('Confirmé & bienvenue {{prenom}}', vars))
      .toBe('<p>Confirmé &amp; bienvenue <span data-var="prenom">Prénom</span></p>');
  });

  it('editorHtmlToPlain : balises retirées, entités décodées, jetons → {{clé}}', () => {
    expect(editorHtmlToPlain('<p>Confirmé &amp; bienvenue <span data-var="prenom">Prénom</span></p>'))
      .toBe('Confirmé & bienvenue {{prenom}}');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — depuis `frontend/` : `node node_modules/jest/bin/jest.js __tests__/emailTokens.test.ts` → FAIL (module absent).

- [ ] **Step 3 : Implémenter `frontend/lib/emailTokens.ts`**

```ts
// Conversion entre le format STOCKÉ des gabarits d'email ({{clé}} dans du HTML ou du texte)
// et le format ÉDITEUR (jetons <span data-var="clé">Libellé</span> pour TipTap).
// Helpers purs — le backend continue de recevoir exactement le format historique.

export interface EmailVarLite { key: string; label: string }

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const VAR_SPAN = /<span\b[^>]*\bdata-var="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function tokenSpan(key: string, label: string): string {
  return `<span data-var="${esc(key)}">${esc(label)}</span>`;
}

/** HTML stocké → HTML éditeur : chaque {{clé}} déclarée devient un jeton ; clé inconnue laissée visible. */
export function storedToEditorHtml(stored: string, vars: EmailVarLite[]): string {
  const byKey = new Map(vars.map((v) => [v.key, v.label]));
  return stored.replace(PLACEHOLDER, (m, k: string) => (byKey.has(k) ? tokenSpan(k, byKey.get(k)!) : m));
}

/** HTML éditeur → HTML stocké : les jetons redeviennent {{clé}}. */
export function editorHtmlToStored(html: string): string {
  return html.replace(VAR_SPAN, (_m, k: string) => `{{${k}}}`);
}

/** Texte stocké (objet/titre/CTA) → HTML une ligne pour l'éditeur. */
export function plainToEditorHtml(text: string, vars: EmailVarLite[]): string {
  return `<p>${storedToEditorHtml(esc(text), vars)}</p>`;
}

/** HTML une ligne de l'éditeur → texte stocké : jetons → {{clé}}, balises retirées, entités décodées. */
export function editorHtmlToPlain(html: string): string {
  return editorHtmlToStored(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}
```

(⚠️ `&amp;` décodé en **dernier** pour ne pas double-décoder `&amp;lt;`.)

- [ ] **Step 4 : Lancer** — même commande → PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/emailTokens.ts frontend/__tests__/emailTokens.test.ts
git commit -m "feat(emails): helpers purs de conversion {{cle}} <-> jetons d'editeur"
```

---

### Task 7 : Dépendances TipTap + composant `RichEmailEditor`

**Files:**
- Modify: `frontend/package.json` (via npm install)
- Create: `frontend/components/admin/email/RichEmailEditor.tsx`
- Test (create): `frontend/__tests__/RichEmailEditor.test.tsx`

- [ ] **Step 1 : Installer les dépendances**

Depuis `frontend/` :

```bash
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-image @tiptap/extension-text-align @tiptap/extension-text-style @tiptap/extension-color
```

Vérifier la version installée (`npm ls @tiptap/react`) : si c'est une **v2.x**, appliquer la note d'exécution en tête de plan (underline/link séparés).

- [ ] **Step 2 : Test qui échoue**

Créer `frontend/__tests__/RichEmailEditor.test.tsx` :

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RichEmailEditor } from '@/components/admin/email/RichEmailEditor';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { fontUI: '', text: '#000', textMute: '#555', textFaint: '#999', bg: '#fff', bgElev: '#fff', surface2: '#f4f4f4', line: '#eee', accent: '#06c' } }),
}));

// Stubs jsdom requis par ProseMirror (positions/mesures absentes de jsdom).
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: Array.prototype[Symbol.iterator] }) as unknown as DOMRectList;
  (document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
});

const vars = [{ key: 'prenom', label: 'Prénom', sample: 'Marie' }];

describe('RichEmailEditor', () => {
  it('rend un jeton lisible pour {{prenom}}', async () => {
    render(<RichEmailEditor value="<p>Bonjour {{prenom}}</p>" vars={vars} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('Prénom')).toBeInTheDocument());
  });

  it('insère une variable via le menu et émet le format stocké', async () => {
    const onChange = jest.fn();
    render(<RichEmailEditor value="<p>Bonjour</p>" vars={vars} onChange={onChange} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Insérer une info/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Insérer une info/ }));
    fireEvent.click(screen.getByRole('button', { name: /Prénom/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0]).toContain('{{prenom}}');
  });

  it('une ligne : sérialise en texte brut sans balises', async () => {
    const onChange = jest.fn();
    render(<RichEmailEditor singleLine value="Objet {{prenom}}" vars={vars} onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('Prénom')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Insérer une info/ }));
    fireEvent.click(screen.getByRole('button', { name: /Prénom/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const out = onChange.mock.calls.at(-1)![0] as string;
    expect(out).not.toMatch(/</);
    expect(out).toContain('{{prenom}}');
  });
});
```

Lancer : `node node_modules/jest/bin/jest.js __tests__/RichEmailEditor.test.tsx` → FAIL (composant absent).

- [ ] **Step 3 : Implémenter `RichEmailEditor.tsx`**

```tsx
'use client';
import { CSSProperties, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import ImageExt from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { useTheme } from '@/lib/ThemeProvider';
import { EmailVarDef } from '@/lib/api';
import { storedToEditorHtml, editorHtmlToStored, plainToEditorHtml, editorHtmlToPlain } from '@/lib/emailTokens';

// Jeton de variable : nœud inline ATOMIQUE — insécable, supprimé d'un coup, jamais scindé.
const EmailVar = Node.create({
  name: 'emailVar',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { key: { default: '' }, label: { default: '' } };
  },
  parseHTML() {
    return [{
      tag: 'span[data-var]',
      getAttrs: (el) => {
        const e = el as HTMLElement;
        return { key: e.getAttribute('data-var') || '', label: e.textContent || e.getAttribute('data-var') || '' };
      },
    }];
  },
  renderHTML({ node }) {
    return ['span', mergeAttributes({ 'data-var': node.attrs.key, class: 'email-var' }), node.attrs.label || node.attrs.key];
  },
});

// Une seule ligne : Enter avalé (objet / titre / libellé de bouton).
const SingleLine = Extension.create({
  name: 'singleLine',
  addKeyboardShortcuts() {
    return { Enter: () => true };
  },
});

const TEXT_COLORS = ['#c2543c', '#3a7a3a', '#b8860b', '#2c4668', '#5e93da'];

interface Props {
  /** Valeur au format stocké : HTML+{{clé}} (corps) ou texte+{{clé}} (une ligne). */
  value: string;
  vars: EmailVarDef[];
  onChange: (stored: string) => void;
  singleLine?: boolean;
  /** Upload d'une image insérée dans le corps ; renvoie l'URL /uploads/… */
  onUploadImage?: (file: File) => Promise<string>;
}

export function RichEmailEditor({ value, vars, onChange, singleLine = false, onUploadImage }: Props) {
  const { th } = useTheme();
  const lastEmitted = useRef<string | null>(null);
  const [varsOpen, setVarsOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toEditor = (stored: string) => (singleLine ? plainToEditorHtml(stored, vars) : storedToEditorHtml(stored, vars));
  const fromEditor = (html: string) => (singleLine ? editorHtmlToPlain(html) : editorHtmlToStored(html));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: singleLine
      ? [
          StarterKit.configure({
            heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false,
            horizontalRule: false, bold: false, italic: false, strike: false, code: false,
            underline: false, link: false,
          } as never),
          SingleLine,
          EmailVar,
        ]
      : [
          StarterKit.configure({
            heading: { levels: [2, 3] }, codeBlock: false, horizontalRule: false, strike: false, code: false,
            link: { openOnClick: false },
          } as never),
          ImageExt,
          TextAlign.configure({ types: ['heading', 'paragraph'] }),
          TextStyle,
          Color,
          EmailVar,
        ],
    content: toEditor(value),
    onUpdate: ({ editor: ed }) => {
      const stored = fromEditor(ed.getHTML());
      lastEmitted.current = stored;
      onChange(stored);
    },
  });

  // Resynchronise l'éditeur quand la valeur change de l'extérieur (chargement, reset).
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    editor.commands.setContent(toEditor(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  function insertVar(v: EmailVarDef) {
    editor?.chain().focus().insertContent({ type: 'emailVar', attrs: { key: v.key, label: v.label } }).run();
    setVarsOpen(false);
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onUploadImage || !editor) return;
    setUploadError(null);
    try {
      const url = await onUploadImage(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      setUploadError((err as Error).message);
    }
  }

  function setLink() {
    if (!editor) return;
    const prev = (editor.getAttributes('link').href as string) || '';
    const url = window.prompt('URL du lien (vide pour retirer)', prev);
    if (url === null) return;
    if (!url) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  }

  const tbtn = (active = false): CSSProperties => ({
    minWidth: 30, height: 30, padding: '0 8px', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${active ? th.accent : th.line}`,
    background: active ? `${th.accent}22` : th.bgElev, color: th.text,
    fontFamily: th.fontUI, fontSize: 13, fontWeight: 700,
  });

  return (
    <div>
      <style>{`
        .pl-rte .ProseMirror { min-height: ${singleLine ? 0 : 170}px; outline: none; font-size: ${singleLine ? 15 : 14.5}px; line-height: 1.6; }
        .pl-rte .ProseMirror p { margin: 0 0 ${singleLine ? 0 : 10}px; }
        .pl-rte .email-var { background: #e3edf9; color: #2c4668; border-radius: 6px; padding: 1px 7px; font-weight: 600; font-size: .92em; white-space: nowrap; }
        .pl-rte .ProseMirror img { max-width: 100%; height: auto; border-radius: 12px; }
      `}</style>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        {!singleLine && editor && (
          <>
            <button type="button" title="Gras" style={{ ...tbtn(editor.isActive('bold')) }} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
            <button type="button" title="Italique" style={{ ...tbtn(editor.isActive('italic')), fontStyle: 'italic' }} onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
            <button type="button" title="Souligné" style={{ ...tbtn(editor.isActive('underline')), textDecoration: 'underline' }} onClick={() => editor.chain().focus().toggleUnderline().run()}>U</button>
            <button type="button" title="Liste à puces" style={tbtn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}>• Liste</button>
            <button type="button" title="Liste numérotée" style={tbtn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. Liste</button>
            <button type="button" title="Lien" style={tbtn(editor.isActive('link'))} onClick={setLink}>🔗</button>
            <button type="button" title="Sous-titre" style={tbtn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>T2</button>
            <button type="button" title="Petit sous-titre" style={tbtn(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>T3</button>
            <button type="button" title="Aligner à gauche" style={tbtn(editor.isActive({ textAlign: 'left' }))} onClick={() => editor.chain().focus().setTextAlign('left').run()}>⬅</button>
            <button type="button" title="Centrer" style={tbtn(editor.isActive({ textAlign: 'center' }))} onClick={() => editor.chain().focus().setTextAlign('center').run()}>↔</button>
            {TEXT_COLORS.map((c) => (
              <button key={c} type="button" title={`Couleur ${c}`} onClick={() => editor.chain().focus().setColor(c).run()}
                style={{ width: 20, height: 20, borderRadius: 10, border: `1px solid ${th.line}`, background: c, cursor: 'pointer', padding: 0 }} aria-label={`Couleur ${c}`} />
            ))}
            <button type="button" title="Couleur par défaut" style={tbtn()} onClick={() => editor.chain().focus().unsetColor().run()}>A̶</button>
            {onUploadImage && (
              <>
                <button type="button" title="Insérer une photo" style={tbtn()} onClick={() => fileRef.current?.click()}>🖼 Photo</button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickImage} />
              </>
            )}
          </>
        )}
        <div style={{ position: 'relative', marginLeft: singleLine ? 0 : 'auto' }}>
          <button type="button" style={{ ...tbtn(varsOpen), borderStyle: 'dashed', color: th.accent }} onClick={() => setVarsOpen((o) => !o)}>
            ＠ Insérer une info ▾
          </button>
          {varsOpen && (
            <div style={{ position: 'absolute', right: 0, top: 34, zIndex: 30, background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 12, boxShadow: '0 8px 26px rgba(0,0,0,.14)', padding: 6, minWidth: 250 }}>
              {vars.map((v) => (
                <button key={v.key} type="button" onClick={() => insertVar(v)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>
                  <strong>{v.label}</strong> <span style={{ color: th.textFaint }}>— ex. {v.sample}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="pl-rte" style={{ border: `1px solid ${th.line}`, borderRadius: 12, background: th.bg, color: th.text, padding: singleLine ? '10px 14px' : '12px 14px', fontFamily: th.fontUI }}>
        <EditorContent editor={editor} />
      </div>
      {uploadError && <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: '#e55', margin: '6px 0 0' }}>{uploadError}</p>}
    </div>
  );
}
```

- [ ] **Step 4 : Lancer** — `node node_modules/jest/bin/jest.js __tests__/RichEmailEditor.test.tsx` → PASS.
Si ProseMirror lève encore une API jsdom manquante, ajouter le stub correspondant dans le `beforeAll` du test (jamais dans `jest.setup.ts` global).

- [ ] **Step 5 : Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/components/admin/email/RichEmailEditor.tsx frontend/__tests__/RichEmailEditor.test.tsx
git commit -m "feat(emails): editeur riche TipTap (jetons de variables, toolbar complete, photos)"
```

---

### Task 8 : `api.adminUploadEmailImage` + bascule d'aperçu mobile/desktop

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/components/admin/email/EmailPreview.tsx`

- [ ] **Step 1 : Ajouter la méthode API** (dans le bloc « Emails automatiques personnalisables (admin) » de `api.ts`, après `adminTestEmail`) :

```ts
/** Upload d'une image insérée dans un email personnalisé : fetch dédié (FormData). */
adminUploadEmailImage: async (clubId: string, file: File, token: string): Promise<{ url: string }> => {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/emails/images`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
},
```

- [ ] **Step 2 : Réécrire `EmailPreview.tsx`** (garde `title="Aperçu de l'email"` — contrat de test) :

```tsx
'use client';
import { useState } from 'react';

export function EmailPreview({ html }: { html: string }) {
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop');
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {(['desktop', 'mobile'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
            style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid #d5d5d5', background: mode === m ? '#e3edf9' : '#fff', color: '#2c4668', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
            {m === 'desktop' ? 'Desktop' : 'Mobile'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', border: '1px solid #e5e5e5', borderRadius: 12, background: '#f4f5f7', padding: mode === 'mobile' ? '12px 0' : 0 }}>
        <iframe
          title="Aperçu de l'email"
          srcDoc={html}
          style={{ width: mode === 'mobile' ? 380 : '100%', maxWidth: '100%', height: 560, border: 'none', borderRadius: 12, background: '#fff' }}
          sandbox=""
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3 : Vérifier** — `node node_modules/typescript/bin/tsc --noEmit` (frontend) → 0 erreur.

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts frontend/components/admin/email/EmailPreview.tsx
git commit -m "feat(emails): api upload image d'email + apercu mobile/desktop"
```

---

### Task 9 : Page éditeur `/admin/emails/[type]` réécrite

**Files:**
- Modify: `frontend/app/admin/emails/[type]/page.tsx`
- Modify (rewrite): `frontend/__tests__/AdminEmailEditor.test.tsx`

- [ ] **Step 1 : Réécrire les tests (échouent d'abord)**

Remplacer le contenu de `frontend/__tests__/AdminEmailEditor.test.tsx` par :

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EmailEditorPage from '@/app/admin/emails/[type]/page';

jest.mock('next/navigation', () => ({ useParams: () => ({ type: 'registration.confirmed' }), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { fontUI: '', fontDisplay: '', text: '#000', textMute: '#555', textFaint: '#999', bg: '#fff', bgElev: '#fff', line: '#eee', accent: '#06c' } }) }));

// Double léger de l'éditeur riche : textarea contrôlée qui parle le format stocké.
jest.mock('@/components/admin/email/RichEmailEditor', () => ({
  RichEmailEditor: ({ value, onChange }: { value: string; onChange: (s: string) => void }) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const detail = {
  type: 'registration.confirmed', group: 'inscriptions', title: 'Inscription confirmée', description: 'd', hasCta: true,
  vars: [{ key: 'prenom', label: 'Prénom', sample: 'Marie' }, { key: 'activite', label: 'Activité', sample: 'Tournoi' }],
  defaults: { subject: 'Inscription confirmée — {{activite}}', heading: 'Inscription confirmée', bodyHtml: '<p>Bonjour {{prenom}}</p>', ctaLabel: 'Voir' },
  override: null,
};
const saveMock = jest.fn().mockResolvedValue({ unknownVars: [] });
const previewMock = jest.fn().mockResolvedValue({ subject: 's', html: '<html><body>aperçu</body></html>' });
jest.mock('@/lib/api', () => ({
  api: {
    adminGetEmail: jest.fn(() => Promise.resolve(detail)),
    adminSaveEmail: (...a: unknown[]) => saveMock(...a),
    adminResetEmail: jest.fn().mockResolvedValue({ ok: true }),
    adminPreviewEmail: (...a: unknown[]) => previewMock(...a),
    adminTestEmail: jest.fn().mockResolvedValue({ ok: true }),
    adminUploadEmailImage: jest.fn().mockResolvedValue({ url: '/uploads/email-images/x.png' }),
  },
}));

describe('EmailEditorPage', () => {
  beforeEach(() => { saveMock.mockClear(); previewMock.mockClear(); });

  it('charge les défauts (format stocké) et enregistre le brouillon', async () => {
    render(<EmailEditorPage />);
    await waitFor(() => expect(screen.getByDisplayValue('Inscription confirmée — {{activite}}')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const draft = saveMock.mock.calls[0][2];
    expect(draft.subject).toBe('Inscription confirmée — {{activite}}');
    expect(draft.bodyHtml).toBe('<p>Bonjour {{prenom}}</p>');
  });

  it('une modification du corps part au format stocké et déclenche l\'aperçu', async () => {
    render(<EmailEditorPage />);
    const body = await screen.findByDisplayValue('<p>Bonjour {{prenom}}</p>');
    fireEvent.change(body, { target: { value: '<p>Salut {{prenom}} !</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][2].bodyHtml).toBe('<p>Salut {{prenom}} !</p>');
    await waitFor(() => expect(previewMock).toHaveBeenCalled());
  });
});
```

Lancer : `node node_modules/jest/bin/jest.js __tests__/AdminEmailEditor.test.tsx` → FAIL (la page rend encore inputs + textarea HTML).

- [ ] **Step 2 : Réécrire la page**

Remplacer le contenu de `frontend/app/admin/emails/[type]/page.tsx` par :

```tsx
'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, AdminEmailDetail, EmailDraft } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { EmailPreview } from '@/components/admin/email/EmailPreview';
import { RichEmailEditor } from '@/components/admin/email/RichEmailEditor';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoadError(null);
    try {
      const d = await api.adminGetEmail(clubId, type, token);
      setDetail(d);
      const src = d.override ?? d.defaults;
      setDraft({ subject: src.subject, heading: src.heading, bodyHtml: src.bodyHtml, ctaLabel: src.ctaLabel ?? '', footerNote: src.footerNote ?? '' });
    } catch (e) { setLoadError((e as Error).message); }
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

  const setField = (f: keyof EmailDraft) => (stored: string) => setDraft((d) => ({ ...d, [f]: stored }));

  const uploadImage = useCallback(async (file: File) => {
    if (!token || !clubId) throw new Error('Non connecté');
    return (await api.adminUploadEmailImage(clubId, file, token)).url;
  }, [token, clubId]);

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

  if (!detail) {
    if (loadError) return <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: '#e55' }}>{loadError}</p>;
    return <p style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</p>;
  }

  return (
    <div style={{ maxWidth: 1120, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <button onClick={() => router.push('/admin/emails')} style={{ ...labelStyle, background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'start' }}>← Tous les emails</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, margin: 0, color: th.text }}>{detail.title}</h1>
        <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, padding: '3px 11px', borderRadius: 99, background: detail.override ? `${th.accent}22` : th.bgElev, color: detail.override ? th.accent : th.textFaint, border: `1px solid ${detail.override ? th.accent : th.line}` }}>
        {detail.override ? 'Personnalisé' : 'Défaut'}
        </span>
      </div>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '-8px 0 0' }}>{detail.description}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, alignItems: 'start' }}>
        {/* Colonne édition */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={labelStyle}>Objet
            <RichEmailEditor singleLine value={draft.subject} vars={detail.vars} onChange={setField('subject')} />
          </div>
          <div style={labelStyle}>Titre
            <RichEmailEditor singleLine value={draft.heading} vars={detail.vars} onChange={setField('heading')} />
          </div>
          <div style={labelStyle}>Message
            <RichEmailEditor value={draft.bodyHtml} vars={detail.vars} onChange={setField('bodyHtml')} onUploadImage={uploadImage} />
          </div>
          {detail.hasCta && (
            <div style={labelStyle}>Libellé du bouton
              <RichEmailEditor singleLine value={draft.ctaLabel ?? ''} vars={detail.vars} onChange={setField('ctaLabel')} />
            </div>
          )}
          {msg && <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.accent, margin: 0 }}>{msg}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Btn variant="primary" disabled={busy} onClick={save}>Enregistrer</Btn>
            <Btn variant="ghost" disabled={busy} onClick={sendTest}>Envoyer un test</Btn>
            <Btn variant="ghost" disabled={busy || !detail.override} onClick={reset}>Réinitialiser</Btn>
          </div>
        </div>

        {/* Colonne aperçu (collante en desktop) */}
        <div style={{ position: 'sticky', top: 12, minWidth: 0 }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, marginBottom: 6 }}>Aperçu</div>
          <EmailPreview html={previewHtml} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3 : Lancer** — `node node_modules/jest/bin/jest.js __tests__/AdminEmailEditor.test.tsx __tests__/RichEmailEditor.test.tsx` → PASS.

- [ ] **Step 4 : Commit**

```bash
git add frontend/app/admin/emails/[type]/page.tsx frontend/__tests__/AdminEmailEditor.test.tsx
git commit -m "feat(emails): page editeur sans HTML (TipTap, jetons, upload photo, apercu sticky)"
```

---

### Task 10 : Face-lift de la liste `/admin/emails`

**Files:**
- Modify: `frontend/app/admin/emails/page.tsx`
- Test: `frontend/__tests__/AdminEmails.test.tsx` (adapter si structure assertée)

- [ ] **Step 1 : Implémenter le face-lift**

Dans `frontend/app/admin/emails/page.tsx` : remplacer `GROUP_LABEL`/`GROUP_ORDER` par un méta enrichi + tuiles d'icônes, et le badge par une pill. Vérifier d'abord la signature du composant Icon (`grep -n "export function Icon" frontend/components/ui/Icon.tsx`) — usage attendu : `<Icon name="trophy" size={17} color="#..." />`.

```tsx
import { Icon, IconName } from '@/components/ui/Icon';

const GROUP_META: Record<string, { label: string; icon: IconName; color: string }> = {
  inscriptions: { label: 'Inscriptions', icon: 'trophy', color: '#e8b04b' },
  organisateur: { label: 'Organisateur', icon: 'users', color: '#2bb6a3' },
  parties: { label: 'Parties ouvertes', icon: 'ball', color: '#5e93da' },
  messages: { label: 'Messagerie', icon: 'mail', color: '#8e7cc3' },
  matchs: { label: 'Matchs', icon: 'bolt', color: '#e0705a' },
  paiement: { label: 'Paiement', icon: 'euro', color: '#5bbd6e' },
};
const GROUP_ORDER = ['inscriptions', 'organisateur', 'parties', 'messages', 'matchs', 'paiement'];
```

Rendu d'une section (remplace l'actuel `<h2>` + cartes) :

```tsx
<section key={g} style={{ marginBottom: 32 }}>
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 14px' }}>
    <span style={{ width: 34, height: 34, borderRadius: 10, background: `${meta.color}22`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={meta.icon} size={17} color={meta.color} />
    </span>
    <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: 0 }}>{meta.label}</h2>
  </div>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {groupItems.map((it) => (
      <Link key={it.type} href={`/admin/emails/${it.type}`} style={{ textDecoration: 'none' }}>
        <div style={{ background: th.bgElev, borderRadius: 14, padding: '14px 18px', border: `1px solid ${th.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>{it.title}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{it.description}</div>
          </div>
          <span style={{ flexShrink: 0, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, padding: '3px 11px', borderRadius: 99, background: it.customized ? `${th.accent}22` : 'transparent', color: it.customized ? th.accent : th.textFaint, border: `1px solid ${it.customized ? th.accent : th.line}` }}>
            {it.customized ? 'Personnalisé' : 'Défaut'}
          </span>
        </div>
      </Link>
    ))}
  </div>
</section>
```

(`const meta = GROUP_META[g];` en tête de la boucle ; sous-titre de page : remplacer la phrase par « Personnalisez le contenu de chaque email automatique — texte, mise en forme et photos, sans aucune technique. »)

- [ ] **Step 2 : Lancer** — `node node_modules/jest/bin/jest.js __tests__/AdminEmails.test.tsx` ; adapter la suite si elle assertait la structure exacte des titres de groupes (les libellés « Personnalisé »/« Défaut » et les titres d'emails sont conservés).

- [ ] **Step 3 : Commit**

```bash
git add frontend/app/admin/emails/page.tsx frontend/__tests__/AdminEmails.test.tsx
git commit -m "feat(emails): face-lift liste admin (tuiles de groupe, badge pill)"
```

---

### Task 11 : Portes finales

- [ ] **Step 1 : Backend** — depuis `backend/` :
  - `node node_modules/typescript/bin/tsc --noEmit` → 0 erreur
  - `node node_modules/jest/bin/jest.js src/email src/routes/__tests__/admin.emails.routes.test.ts src/services/__tests__/emailTemplate.service.test.ts` → tout PASS
  - Suites notifications (elles consomment brandFromClub/renderClubEmail) : `node node_modules/jest/bin/jest.js src/email/__tests__` et les suites `notifications` si distinctes (`node node_modules/jest/bin/jest.js notifications`) → PASS

- [ ] **Step 2 : Frontend** — depuis `frontend/` :
  - `node node_modules/typescript/bin/tsc --noEmit` → 0 erreur (scoper la lecture des erreurs aux fichiers touchés si du WIP parallèle existe)
  - `node node_modules/jest/bin/jest.js __tests__/emailTokens.test.ts __tests__/RichEmailEditor.test.tsx __tests__/AdminEmailEditor.test.tsx __tests__/AdminEmails.test.tsx` → tout PASS

- [ ] **Step 3 : Vérification visuelle (manuelle ou skill verify)**
  - Démarrer la stack (`start.ps1` ou backend+frontend), ouvrir `http://padel-arena-paris.localhost:3000/admin/emails` (compte staff/owner), ouvrir « Inscription confirmée » :
    - les jetons « Prénom »/« Activité » s'affichent en chips (jamais `{{…}}`),
    - gras/couleur/liste/photo fonctionnent et l'aperçu (nouveau gabarit : liseré, titre serif, CTA pill, pied de page avec coordonnées) suit,
    - « Envoyer un test » arrive (fallback console dev) avec le nouveau gabarit,
    - la bascule Desktop/Mobile de l'aperçu fonctionne.
  - Vérifier qu'un compte **STAFF** accède à la page (plus de 403).

- [ ] **Step 4 : Commit final éventuel** (ajustements de la vérification) puis relecture du diff complet :

```bash
git log --oneline -12
git diff main@{u} --stat   # ou le point de départ de la branche
```

---

## Couverture spec → tâches

| Spec | Tâche |
|---|---|
| Éditeur TipTap (toolbar complète, jetons atomiques, menu ＠) | 7, 9 |
| Objet/Titre/CTA une ligne, texte brut stocké | 6, 7, 9 |
| Conversion `{{clé}}` ↔ jetons (backend inchangé) | 6 |
| Photos dans le corps (upload immédiat, insertion) | 5, 7, 8, 9 |
| Accès STAFF | 5 |
| Gabarit « Éditorial épuré » (liseré, serif, pill, pied de page) | 1 |
| Brand étendu + coordonnées + manageUrl | 1, 2 |
| Sanitisation img restreinte + absolutisation + styles au rendu | 3 |
| Limite corps 20 000 | 3 |
| Défauts chat/DM/litige réaccordés | 4 |
| Aperçu mobile/desktop | 8 |
| Face-lift liste | 10 |
| Tests front + back | toutes |
