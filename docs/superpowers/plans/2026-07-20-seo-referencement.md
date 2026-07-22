# SEO — robots/sitemap, métadonnées par page, image OG de marque — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL : `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans`. Étapes en syntaxe checkbox.

**Spec validée** : `docs/superpowers/specs/2026-07-20-seo-referencement-design.md` (committée, `2837303`).

**Goal** : donner à Palova un `robots.txt`/`sitemap.xml` par hôte, des titres/descriptions propres à chaque page publique à fort trafic, et une image Open Graph de marque par club — pour que les pages club soient indexées correctement et partagées avec un aperçu riche.

**Architecture** : 3 briques additives, aucune migration. (1) `app/robots.ts`/`app/sitemap.ts` résolvent l'hôte via `clubSlugFromHost` (comme `app/manifest.ts`) et délèguent à des builders **purs** (`lib/robotsRules.ts`/`lib/sitemapEntries.ts`) testables sans mocker `next/headers`. (2) 6 pages `'use client'` (structurellement incompatibles avec `generateMetadata`) sont scindées en un `page.tsx` **serveur** mince + un `*Client.tsx` co-localisé qui porte le contenu actuel tel quel ; le helper `lib/seo.ts` uniformise les formules de titre/description/canonical. (3) `icon.service.ts` (backend) gagne une variante non carrée `og.png` (logo + nom sur fond `accentColor`, 1200×630), servie par la route d'icônes existante.

**Tech Stack** : Next.js 16 (App Router, `MetadataRoute`), Prisma/sharp côté backend (extension d'un service existant), Jest des deux côtés.

---

## Règles transverses (IMPÉRATIVES pour chaque tâche)

- **TDD** : test AVANT le code (quand la tâche introduit une nouvelle logique testable), le voir ÉCHOUER, puis implémenter.
- **Commandes** (shims `.bin` cassés sous Windows, cf. mémoire projet) :
  - Frontend : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath <fichiers>` puis `node node_modules/typescript/bin/tsc --noEmit`.
  - Backend : `cd backend && node node_modules/jest/bin/jest.js --runTestsByPath <fichiers>` puis `node node_modules/typescript/bin/tsc --noEmit`.
  - ⚠️ Jest traite un chemin comme un motif (Windows insensible à la casse) : toujours `--runTestsByPath` avec le(s) chemin(s) exact(s), jamais un nom court ambigu.
- **Git** : le working tree porte du WIP parallèle sans rapport (`.env.prod.example`, `deploy/backup-db.sh`, `docs/sauvegardes.md`, `frontend/__tests__/OpenMatches.test.tsx`, `frontend/components/openmatch/OpenMatchCard.tsx`, `frontend/components/openmatch/OpenMatches.tsx`). **Ne jamais y toucher.** Commits **par chemins explicites** uniquement — jamais `git add -A`, jamais `git stash`.
- **Jamais de `new Date()` au rendu React** — sans objet ici (aucune des pages touchées n'en ajoute).
- Aucune migration Prisma dans ce plan — uniquement du code applicatif.

---

### Tâche 1 : Branche de travail + sauvegarde du plan

**Files** : Create `docs/superpowers/plans/2026-07-20-seo-referencement.md` (copie de ce plan).

Le dépôt est sur `feat/dupliquer-tournoi-event` avec du WIP non lié non committé (cf. « Règles transverses »). On branche **depuis cet état courant** (pas depuis `main`) pour ne pas perturber ce WIP — l'intégration finale (ordre de merge des deux branches) se décidera en fin de feature.

- [ ] `git status --short` — confirmer que seuls les 6 fichiers listés ci-dessus sont modifiés (rien d'autre à préserver par surprise).
- [ ] `git switch -c feat/seo-referencement`
- [ ] Sauvegarder ce plan dans `docs/superpowers/plans/2026-07-20-seo-referencement.md`.
- [ ] `git add docs/superpowers/plans/2026-07-20-seo-referencement.md` puis commit :
  ```bash
  git commit -m "docs(plan): SEO -- robots/sitemap, metadonnees par page, image OG de marque"
  ```

---

### Tâche 2 : `lib/seo.ts` — helpers purs partagés

**Files** :
- Create : `frontend/lib/seo.ts`
- Test : `frontend/__tests__/seo.test.ts`

- [ ] **Test d'abord** — `frontend/__tests__/seo.test.ts` :
  ```ts
  import { clubTitle, platformTitle, canonicalFor, clubOgImage, PLATFORM_OG_IMAGE } from '../lib/seo';

  describe('clubTitle', () => {
    it('joint la page et le nom du club avec " · "', () => {
      expect(clubTitle('Le club', 'Padel Arena Paris')).toBe('Le club · Padel Arena Paris');
    });
  });

  describe('platformTitle', () => {
    it('ajoute le suffixe " | Palova"', () => {
      expect(platformTitle('Tarifs')).toBe('Tarifs | Palova');
    });
  });

  describe('canonicalFor', () => {
    it('construit l\'URL du sous-domaine club pour le chemin donné', () => {
      expect(canonicalFor('demo', '/club')).toBe('https://demo.localhost/club');
    });
    it('undefined sans slug (hôte plateforme)', () => {
      expect(canonicalFor(null, '/tarifs')).toBeUndefined();
    });
  });

  describe('clubOgImage', () => {
    it('pointe vers la route icône og.png du club', () => {
      expect(clubOgImage('demo')).toBe('http://localhost:3001/api/clubs/demo/icon/og.png');
    });
  });

  it('PLATFORM_OG_IMAGE est un asset statique local', () => {
    expect(PLATFORM_OG_IMAGE).toBe('/og-default.png');
  });
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/seo.test.ts`
  Expected : FAIL — `Cannot find module '../lib/seo'`.
- [ ] **Implémenter** — `frontend/lib/seo.ts` :
  ```ts
  import { CANONICAL_ROOT } from './roots';
  import { API_BASE_URL } from './api';

  /** Titre d'une page club : "{page} · {nom du club}". */
  export function clubTitle(page: string, clubName: string): string {
    return `${page} · ${clubName}`;
  }

  /** Titre d'une page plateforme : "{page} | Palova". */
  export function platformTitle(page: string): string {
    return `${page} | Palova`;
  }

  /**
   * URL canonique d'une page club — même règle que app/layout.tsx, mais autonome :
   * chaque page la calcule elle-même plutôt que de compter sur la fusion de
   * métadonnées Next parent/enfant.
   */
  export function canonicalFor(slug: string | null, path: string): string | undefined {
    return slug ? `https://${slug}.${CANONICAL_ROOT}${path}` : undefined;
  }

  /** Image Open Graph de marque d'un club (logo + couleur, 1200×630, backend icon.service). */
  export function clubOgImage(slug: string): string {
    return `${API_BASE_URL}/api/clubs/${slug}/icon/og.png`;
  }

  /** Image Open Graph par défaut de la plateforme (asset statique, aucun contexte club). */
  export const PLATFORM_OG_IMAGE = '/og-default.png';
  ```
- [ ] Run : même commande. Expected : PASS (6 tests).
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/lib/seo.ts frontend/__tests__/seo.test.ts` puis commit :
  ```bash
  git commit -m "feat(seo): helpers purs titre/canonical/image OG (lib/seo.ts)"
  ```

---

### Tâche 3 : `robots.txt` par hôte

**Files** :
- Create : `frontend/lib/robotsRules.ts`, `frontend/__tests__/robotsRules.test.ts`, `frontend/app/robots.ts`

- [ ] **Test d'abord** — `frontend/__tests__/robotsRules.test.ts` :
  ```ts
  import { buildRobots } from '../lib/robotsRules';

  function rule(r: ReturnType<typeof buildRobots>) {
    return Array.isArray(r.rules) ? r.rules[0] : r.rules;
  }

  describe('buildRobots — hôte club', () => {
    const r = () => rule(buildRobots('demo', 'demo.localhost:3000'));

    it('autorise la vitrine publique', () => {
      expect(r().allow).toEqual(expect.arrayContaining(['/', '/club', '/events', '/events/*', '/tournois/*', '/parties']));
    });

    it('bloque les pages privées', () => {
      expect(r().disallow).toEqual(expect.arrayContaining(['/reserver', '/cours', '/me', '/admin', '/superadmin', '/login', '/forgot-password', '/session-bridge', '/clubs']));
    });

    it('bloque les pages à gabarit de repli dupliqué entre clubs (CGU/CGV/mentions/confidentialité/offres/aide/FAQ)', () => {
      expect(r().disallow).toEqual(expect.arrayContaining(['/cgu', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/aide', '/faq']));
    });

    it('ne bloque pas /parties/:id (unfurling social) ni /tournois (redirection interne, ignorée)', () => {
      expect(r().disallow).not.toContain('/parties');
      expect(r().disallow).not.toContain('/tournois');
    });
  });

  describe('buildRobots — hôte plateforme', () => {
    const r = () => rule(buildRobots(null, 'palova.fr'));

    it('autorise les pages légales (copie canonique unique) et le FAQ', () => {
      expect(r().allow).toEqual(expect.arrayContaining(['/', '/decouvrir', '/tarifs', '/offres', '/faq', '/cgu', '/cgv', '/mentions-legales', '/confidentialite']));
      expect(r().disallow).not.toContain('/faq');
    });

    it('bloque /aide (pure redirection vers /faq ici) et les pages privées', () => {
      expect(r().disallow).toEqual(expect.arrayContaining(['/aide', '/login', '/forgot-password', '/clubs', '/me', '/admin', '/superadmin', '/session-bridge']));
    });
  });

  describe('buildRobots — sitemap', () => {
    it('pointe toujours vers le sitemap du même hôte', () => {
      expect(buildRobots('demo', 'demo.palova.fr').sitemap).toBe('https://demo.palova.fr/sitemap.xml');
      expect(buildRobots(null, 'palova.fr').sitemap).toBe('https://palova.fr/sitemap.xml');
    });
  });
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/robotsRules.test.ts`
  Expected : FAIL — module introuvable.
- [ ] **Implémenter** — `frontend/lib/robotsRules.ts` :
  ```ts
  import type { MetadataRoute } from 'next';

  // Chemins de repli dupliqué entre clubs (gabarit Palova générique quand le club n'a rien
  // personnalisé — cf. spec) : jamais indexés côté club, la copie plateforme reste canonique.
  const FALLBACK_TEMPLATE_PATHS = ['/cgu', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/aide', '/faq'];

  function clubRules(): NonNullable<MetadataRoute.Robots['rules']> {
    return [{
      userAgent: '*',
      allow: ['/', '/club', '/events', '/events/*', '/tournois/*', '/parties', '/register', '/clubs/new'],
      disallow: [
        '/reserver', '/cours', '/me', '/admin', '/superadmin', '/login', '/forgot-password',
        '/session-bridge', '/clubs',
        ...FALLBACK_TEMPLATE_PATHS,
      ],
    }];
  }

  function platformRules(): NonNullable<MetadataRoute.Robots['rules']> {
    return [{
      userAgent: '*',
      allow: ['/', '/decouvrir', '/tarifs', '/offres', '/faq', '/cgu', '/cgv', '/mentions-legales', '/confidentialite', '/register', '/clubs/new'],
      disallow: ['/login', '/forgot-password', '/clubs', '/me', '/admin', '/superadmin', '/session-bridge', '/tournois', '/aide'],
    }];
  }

  /** Règles robots.txt pour l'hôte donné — pur, testable sans mocker next/headers. */
  export function buildRobots(slug: string | null, host: string): MetadataRoute.Robots {
    return {
      rules: slug ? clubRules() : platformRules(),
      sitemap: `https://${host}/sitemap.xml`,
    };
  }
  ```
- [ ] Run : même commande. Expected : PASS (7 tests).
- [ ] **Glue de route** — `frontend/app/robots.ts` :
  ```ts
  import type { MetadataRoute } from 'next';
  import { headers } from 'next/headers';
  import { clubSlugFromHost } from '@/lib/host';
  import { ROOT_DOMAINS } from '@/lib/roots';
  import { buildRobots } from '@/lib/robotsRules';

  // robots.txt par hôte (club vs plateforme). Le proxy ne réécrit pas ce chemin (extension
  // .txt exclue de son matcher, comme app/manifest.ts) : le slug se résout depuis Host.
  export default async function robots(): Promise<MetadataRoute.Robots> {
    const host = (await headers()).get('host') || '';
    const slug = clubSlugFromHost(host, ROOT_DOMAINS);
    return buildRobots(slug, host);
  }
  ```
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/lib/robotsRules.ts frontend/__tests__/robotsRules.test.ts frontend/app/robots.ts` puis commit :
  ```bash
  git commit -m "feat(seo): robots.txt par hote (club vs plateforme)"
  ```

---

### Tâche 4 : `sitemap.xml` par hôte

**Files** :
- Create : `frontend/lib/sitemapEntries.ts`, `frontend/__tests__/sitemapEntries.test.ts`, `frontend/app/sitemap.ts`, `frontend/__tests__/SitemapRoute.test.ts`

- [ ] **Test d'abord (builders purs)** — `frontend/__tests__/sitemapEntries.test.ts` :
  ```ts
  import { clubStaticEntries, clubDynamicEntries, platformEntries } from '../lib/sitemapEntries';
  import type { Tournament, ClubEvent } from '../lib/api';

  describe('clubStaticEntries', () => {
    it('liste les pages statiques du club sur le bon hôte', () => {
      const urls = clubStaticEntries('demo.palova.fr').map((e) => e.url);
      expect(urls).toEqual([
        'https://demo.palova.fr/',
        'https://demo.palova.fr/club',
        'https://demo.palova.fr/events',
        'https://demo.palova.fr/parties',
      ]);
    });
  });

  describe('clubDynamicEntries', () => {
    it('ne garde que les tournois/events PUBLISHED', () => {
      const tournaments = [
        { id: 't1', status: 'PUBLISHED' } as Tournament,
        { id: 't2', status: 'DRAFT' } as Tournament,
      ];
      const events = [
        { id: 'e1', status: 'PUBLISHED' } as ClubEvent,
        { id: 'e2', status: 'CANCELLED' } as ClubEvent,
      ];
      const urls = clubDynamicEntries('demo.palova.fr', tournaments, events).map((e) => e.url);
      expect(urls).toEqual(['https://demo.palova.fr/tournois/t1', 'https://demo.palova.fr/events/e1']);
    });

    it('listes vides → tableau vide', () => {
      expect(clubDynamicEntries('demo.palova.fr', [], [])).toEqual([]);
    });
  });

  describe('platformEntries', () => {
    it('liste les pages statiques plateforme, sans /aide (redirection)', () => {
      const urls = platformEntries('palova.fr').map((e) => e.url);
      expect(urls).toEqual(expect.arrayContaining([
        'https://palova.fr/', 'https://palova.fr/decouvrir', 'https://palova.fr/tarifs',
        'https://palova.fr/offres', 'https://palova.fr/faq', 'https://palova.fr/cgu',
        'https://palova.fr/cgv', 'https://palova.fr/mentions-legales', 'https://palova.fr/confidentialite',
      ]));
      expect(urls).not.toContain('https://palova.fr/aide');
    });
  });
  ```
  Note : le double cast `as X & typeof over as X` dans les helpers `T`/`E` sert seulement à satisfaire le compilateur pour des fixtures partielles — remplacé ci-dessous par des objets littéraux directs dans les tests (plus simples, pas besoin d'un vrai helper générique pour 2 cas).
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/sitemapEntries.test.ts`
  Expected : FAIL — module introuvable.
- [ ] **Implémenter** — `frontend/lib/sitemapEntries.ts` :
  ```ts
  import type { MetadataRoute } from 'next';
  import type { Tournament, ClubEvent } from './api';

  /** Pages statiques d'un club (pures — indépendantes des données du club). */
  export function clubStaticEntries(host: string): MetadataRoute.Sitemap {
    const base = `https://${host}`;
    return [
      { url: `${base}/`, priority: 1 },
      { url: `${base}/club`, priority: 0.8 },
      { url: `${base}/events`, priority: 0.7 },
      { url: `${base}/parties`, priority: 0.5 },
    ];
  }

  /** Tournois/events PUBLIÉS d'un club → entrées dynamiques du sitemap. */
  export function clubDynamicEntries(host: string, tournaments: Tournament[], events: ClubEvent[]): MetadataRoute.Sitemap {
    const base = `https://${host}`;
    return [
      ...tournaments.filter((t) => t.status === 'PUBLISHED').map((t) => ({ url: `${base}/tournois/${t.id}`, priority: 0.6 })),
      ...events.filter((e) => e.status === 'PUBLISHED').map((e) => ({ url: `${base}/events/${e.id}`, priority: 0.6 })),
    ];
  }

  /** Pages statiques de l'hôte plateforme. */
  export function platformEntries(host: string): MetadataRoute.Sitemap {
    const base = `https://${host}`;
    return [
      { url: `${base}/`, priority: 1 },
      { url: `${base}/decouvrir`, priority: 0.9 },
      { url: `${base}/tarifs`, priority: 0.6 },
      { url: `${base}/offres`, priority: 0.6 },
      { url: `${base}/faq`, priority: 0.4 },
      { url: `${base}/cgu`, priority: 0.2 },
      { url: `${base}/cgv`, priority: 0.2 },
      { url: `${base}/mentions-legales`, priority: 0.2 },
      { url: `${base}/confidentialite`, priority: 0.2 },
    ];
  }
  ```
- [ ] Run : même commande. Expected : PASS (5 tests).
- [ ] **Glue de route (avec repli défensif)** — `frontend/app/sitemap.ts` :
  ```ts
  import type { MetadataRoute } from 'next';
  import { headers } from 'next/headers';
  import { api } from '@/lib/api';
  import { clubSlugFromHost } from '@/lib/host';
  import { ROOT_DOMAINS } from '@/lib/roots';
  import { clubStaticEntries, clubDynamicEntries, platformEntries } from '@/lib/sitemapEntries';

  // sitemap.xml par hôte (même résolution que app/robots.ts et app/manifest.ts). Toute erreur
  // de fetch (club suspendu/introuvable, API indisponible) → repli sur les pages statiques
  // seules, jamais d'exception (comportement défensif, comme le manifest et les icônes).
  export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const host = (await headers()).get('host') || '';
    const slug = clubSlugFromHost(host, ROOT_DOMAINS);
    if (!slug) return platformEntries(host);
    try {
      const [tournaments, events] = await Promise.all([api.getClubTournaments(slug), api.getClubEvents(slug)]);
      return [...clubStaticEntries(host), ...clubDynamicEntries(host, tournaments, events)];
    } catch {
      return clubStaticEntries(host);
    }
  }
  ```
- [ ] **Test de la glue (comportement de repli — mérite un test, contrairement à manifest.ts qui n'en a pas)** — `frontend/__tests__/SitemapRoute.test.ts` :
  ```ts
  jest.mock('next/headers', () => ({
    headers: jest.fn(async () => ({ get: (k: string) => (k === 'host' ? (globalThis as any).__host : null) })),
  }));
  jest.mock('../lib/api', () => ({ api: { getClubTournaments: jest.fn(), getClubEvents: jest.fn() } }));

  import sitemap from '../app/sitemap';
  import { api } from '../lib/api';

  const getClubTournaments = api.getClubTournaments as jest.Mock;
  const getClubEvents = api.getClubEvents as jest.Mock;

  describe('sitemap route', () => {
    afterEach(() => jest.clearAllMocks());

    it('hôte plateforme → pages statiques seules, pas de fetch club', async () => {
      (globalThis as any).__host = 'palova.fr';
      const entries = await sitemap();
      expect(entries.map((e) => e.url)).toContain('https://palova.fr/decouvrir');
      expect(getClubTournaments).not.toHaveBeenCalled();
    });

    it('hôte club, fetch OK → statique + dynamique combinés', async () => {
      // ROOT_DOMAINS vaut ['localhost'] sous jest par défaut (aucune env var posée) : le host
      // de test DOIT se terminer par ".localhost" pour que clubSlugFromHost y extraie un slug
      // (cf. lib/host.ts) — "demo.palova.fr" retomberait sur null (traité comme plateforme).
      (globalThis as any).__host = 'demo.localhost';
      getClubTournaments.mockResolvedValue([{ id: 't1', status: 'PUBLISHED' }]);
      getClubEvents.mockResolvedValue([{ id: 'e1', status: 'PUBLISHED' }]);
      const entries = await sitemap();
      const urls = entries.map((e) => e.url);
      expect(urls).toContain('https://demo.localhost/');
      expect(urls).toContain('https://demo.localhost/tournois/t1');
      expect(urls).toContain('https://demo.localhost/events/e1');
    });

    it('hôte club, fetch en échec → repli sur les pages statiques seules, pas d\'exception', async () => {
      (globalThis as any).__host = 'demo.localhost';
      getClubTournaments.mockRejectedValue(new Error('boom'));
      getClubEvents.mockResolvedValue([]);
      const entries = await sitemap();
      expect(entries.map((e) => e.url)).toEqual([
        'https://demo.localhost/', 'https://demo.localhost/club', 'https://demo.localhost/events', 'https://demo.localhost/parties',
      ]);
    });
  });
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/sitemapEntries.test.ts __tests__/SitemapRoute.test.ts`
  Expected : PASS (8 tests au total).
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/lib/sitemapEntries.ts frontend/__tests__/sitemapEntries.test.ts frontend/app/sitemap.ts frontend/__tests__/SitemapRoute.test.ts` puis commit :
  ```bash
  git commit -m "feat(seo): sitemap.xml par hote (statique + tournois/events publies)"
  ```

---

### Tâche 5 : Backend — image OG de marque (`icon.service.ts` + route)

**Files** :
- Modify : `backend/src/services/icon.service.ts`, `backend/src/routes/clubs.ts:809`
- Test : `backend/src/routes/__tests__/icon.routes.test.ts`

Pas de test-first isolé côté service : suit la convention déjà en place dans ce fichier (`getClubIconPath`/`renderIcon` ne sont couverts que par les tests de route `supertest`, `icon.service.test.ts` restant réservé à `fetchLogo`). Le test-first se fait donc directement au niveau de la route.

- [ ] **Test d'abord** — ajouter, en fin de fichier `backend/src/routes/__tests__/icon.routes.test.ts` (APRÈS le `});` qui referme le `describe('GET /api/clubs/:slug/icon/:file', ...)` existant — un nouveau `describe` frère, pas imbriqué) :
  ```ts
  describe('GET /api/clubs/:slug/icon/og.png', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      for (const f of fs.readdirSync(ICONS_DIR)) fs.unlinkSync(`${ICONS_DIR}/${f}`);
    });

    it('404 si club inconnu', async () => {
      prismaMock.club.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/api/clubs/nope/icon/og.png');
      expect(res.status).toBe(404);
    });

    it('club sans logo → PNG de repli partagé avec les cartes de partie (1200x630), 200', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', name: 'Padel Arena', logoUrl: null, accentColor: '#1d3557' } as any);
      const res = await request(app).get('/api/clubs/demo/icon/og.png');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      const meta = await sharp(res.body as Buffer).metadata();
      expect([meta.width, meta.height]).toEqual([1200, 630]);
    });

    it('club avec logo → carte 1200x630 générée + cache disque ; 2e appel sans re-téléchargement', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', name: 'Padel Arena', logoUrl: 'https://logos.example/x.png', accentColor: '#1d3557' } as any);
      const logo = await sharp({ create: { width: 60, height: 40, channels: 4, background: '#ff0000' } }).png().toBuffer();
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(logo), { status: 200 }) as any);

      const res = await request(app).get('/api/clubs/demo/icon/og.png');
      expect(res.status).toBe(200);
      const meta = await sharp(res.body as Buffer).metadata();
      expect([meta.width, meta.height]).toEqual([1200, 630]);
      expect(fs.readdirSync(ICONS_DIR).filter((f) => f.includes('-og-'))).toHaveLength(1);

      await request(app).get('/api/clubs/demo/icon/og.png');
      expect(fetchMock).toHaveBeenCalledTimes(1); // servi depuis le cache disque
      fetchMock.mockRestore();
    });

    it('logo injoignable → repli silencieux (200)', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', name: 'Padel Arena', logoUrl: 'https://logos.example/dead.png', accentColor: '#1d3557' } as any);
      const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('boom'));
      const res = await request(app).get('/api/clubs/demo/icon/og.png');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      fetchMock.mockRestore();
    });
  });
  ```
- [ ] Run : `cd backend && node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/icon.routes.test.ts`
  Expected : FAIL — 404 partout (`og.png` ne matche pas la regex `^([a-z0-9-]+)\.png$` de la variante... en fait il matche `og` comme variante, donc `ICON_VARIANTS['og']` est `undefined` → `getClubIconPath` renvoie `null` → 404 sur TOUS les cas, y compris ceux attendant 200).
- [ ] **Implémenter — `backend/src/services/icon.service.ts`.** Ajouter l'import de `readableTextOn` en haut du fichier (juste après les imports existants) :
  ```ts
  import { readableTextOn } from '../email/templates/layout';
  ```
  Ajouter, juste après la définition de `ICON_VARIANTS` (après la ligne `};` qui la termine) :
  ```ts
  // Carte de marque générique d'un club (logo + nom sur fond accentColor, 1200×630) : image
  // Open Graph réutilisée par les pages club qui n'ont pas de carte dédiée (à la différence
  // des parties ouvertes, cf. matchCard.service.ts, qui garde sa carte dynamique par état).
  const OG_W = 1200;
  const OG_H = 630;
  const OG_FONT = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif";
  const OG_RENDER_VERSION = 'v1';

  function fallbackOgCardPath(): string {
    return path.join(process.cwd(), 'assets', 'og-card-fallback.png');
  }

  function ogCacheFile(clubId: string, logoUrl: string): string {
    // Hash sur logoUrl seul (comme iconCacheFile) : un changement d'accentColor/nom sans
    // changement de logo ne rebustera pas le cache — même tradeoff déjà accepté pour les
    // icônes PWA, pas retravaillé ici.
    const hash = crypto.createHash('md5').update(`${OG_RENDER_VERSION}:${logoUrl}`).digest('hex').slice(0, 12);
    return path.join(ICONS_DIR, `${clubId}-og-${hash}.png`);
  }

  const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const clampText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  /** Carte 1200×630 : fond accentColor, logo centré (contain), nom du club en dessous. */
  async function renderOgCard(logo: Buffer, accentColor: string, clubName: string): Promise<Buffer> {
    const bg = accentColor || '#1d3557';
    const ink = readableTextOn(bg);
    const svg = `<svg width="${OG_W}" height="${OG_H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${OG_W}" height="${OG_H}" fill="${escXml(bg)}"/>
      <text x="${OG_W / 2}" y="470" text-anchor="middle" font-family="${OG_FONT}" font-size="52" font-weight="700" fill="${escXml(ink)}">${escXml(clampText(clubName, 32))}</text>
    </svg>`;
    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const mark = await sharp(logo)
      .resize(260, 260, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    return sharp(base).composite([{ input: mark, left: Math.round(OG_W / 2 - 130), top: 90 }]).png().toBuffer();
  }
  ```
  Ajouter, dans la classe `IconService`, une nouvelle méthode (juste après `getClubIconPath`) :
  ```ts
    /** Chemin absolu de la carte OG de marque du club, ou null (club introuvable → 404). */
    async getClubOgCardPath(slug: string): Promise<string | null> {
      const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, name: true, logoUrl: true, accentColor: true } });
      if (!club) return null;
      if (!club.logoUrl) return fallbackOgCardPath();
      const cached = ogCacheFile(club.id, club.logoUrl);
      if (fs.existsSync(cached)) return cached;
      try {
        const logo = await fetchLogo(club.logoUrl);
        const png = await renderOgCard(logo, club.accentColor, club.name);
        fs.writeFileSync(cached, png);
        return cached;
      } catch {
        return fallbackOgCardPath();
      }
    }
  ```
- [ ] **Implémenter — route `backend/src/routes/clubs.ts`.** Remplacer le handler existant (ligne ~809) :
  ```ts
  // Icône PWA du club (référencée par le manifest) — public, PNG, repli Palova.
  router.get('/:slug/icon/:file', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const m = asString(req.params.file).match(/^([a-z0-9-]+)\.png$/);
      const filePath = m ? await iconService.getClubIconPath(asString(req.params.slug), m[1]) : null;
      if (!filePath) { res.status(404).json({ error: 'Icône introuvable' }); return; }
      res.sendFile(filePath, { headers: { 'Cache-Control': 'public, max-age=86400' } });
    } catch (err) { handleError(err, res, next); }
  });
  ```
  par :
  ```ts
  // Icône PWA du club (référencée par le manifest) — public, PNG, repli Palova.
  // og.png : carte de marque 1200×630 (image Open Graph des pages club), même endpoint.
  router.get('/:slug/icon/:file', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = asString(req.params.file);
      const slug = asString(req.params.slug);
      let filePath: string | null;
      if (file === 'og.png') {
        filePath = await iconService.getClubOgCardPath(slug);
      } else {
        const m = file.match(/^([a-z0-9-]+)\.png$/);
        filePath = m ? await iconService.getClubIconPath(slug, m[1]) : null;
      }
      if (!filePath) { res.status(404).json({ error: 'Icône introuvable' }); return; }
      res.sendFile(filePath, { headers: { 'Cache-Control': 'public, max-age=86400' } });
    } catch (err) { handleError(err, res, next); }
  });
  ```
- [ ] Run : `cd backend && node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/icon.routes.test.ts`
  Expected : PASS (tous les cas, anciens + 4 nouveaux).
- [ ] `cd backend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add backend/src/services/icon.service.ts backend/src/routes/clubs.ts backend/src/routes/__tests__/icon.routes.test.ts` puis commit :
  ```bash
  git commit -m "feat(seo): carte OG de marque par club (icon.service og.png)"
  ```

---

### Tâche 6 : Image OG par défaut de la plateforme (asset statique)

**Files** : Create `frontend/public/og-default.png` (copie de `backend/assets/og-card-fallback.png`, déjà à la bonne taille 1200×630 — aucun nouveau travail graphique).

- [ ] Copier le fichier (`frontend/public/` existe déjà — icônes PWA) :
  ```bash
  cp backend/assets/og-card-fallback.png frontend/public/og-default.png
  ```
- [ ] Vérifier que la copie est identique à la source :
  ```bash
  diff backend/assets/og-card-fallback.png frontend/public/og-default.png && echo "OK identique"
  ```
- [ ] `git add frontend/public/og-default.png` puis commit :
  ```bash
  git commit -m "feat(seo): image OG par defaut de la plateforme (asset statique)"
  ```

---

### Tâche 7 : `/parties/[id]` → `noindex`

**Files** : Modify `frontend/app/parties/[id]/page.tsx`, `frontend/__tests__/OpenMatchPageMetadata.test.ts`

- [ ] **Test d'abord** — ajouter dans `frontend/__tests__/OpenMatchPageMetadata.test.ts`, à l'intérieur du `describe('generateMetadata /parties/[id]', ...)` existant :
  ```ts
    it('noindex dans les deux branches (contenu éphémère, mais reste crawlable pour l\'unfurling social)', async () => {
      const meta = await generateMetadata({ params: Promise.resolve({ id: 'm1' }) });
      expect(meta.robots).toEqual({ index: false, follow: true });

      getOpenMatch.mockRejectedValue(new Error('boom'));
      const metaFallback = await generateMetadata({ params: Promise.resolve({ id: 'm1' }) });
      expect(metaFallback.robots).toEqual({ index: false, follow: true });
    });
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchPageMetadata.test.ts`
  Expected : FAIL — `meta.robots` est `undefined`.
- [ ] **Implémenter** — dans `frontend/app/parties/[id]/page.tsx`, la fonction `generateMetadata` (lignes 11-34) devient :
  ```ts
  export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;
    const slug = (await headers()).get('x-club-slug');
    if (!slug) return { title: 'Partie ouverte · Palova', robots: { index: false, follow: true } };
    try {
      const [club, match] = await Promise.all([api.getClub(slug), api.getOpenMatch(slug, id)]);
      const when = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: club.timezone }).format(new Date(match.startTime));
      const places = match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`;
      const level = (match.targetLevelMin != null || match.targetLevelMax != null) ? rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null) : null;
      const title = `Partie ouverte · ${match.resourceName}`;
      const description = [when, places, level, club.name].filter(Boolean).join(' · ');
      // Carte OG dynamique 1200×630 (état réel du match), versionnée par ?v=<cardVersion>
      // pour que les crawlers (qui cachent par URL) re-crawlent à chaque nouvel état.
      const image = `${API_URL}/api/clubs/${slug}/open-matches/${id}/card.png${match.cardVersion ? `?v=${match.cardVersion}` : ''}`;
      return {
        title,
        description,
        // Contenu éphémère (créneau daté) : aucune valeur de référencement durable, mais on
        // reste crawlable (pas de robots.txt disallow) pour que l'unfurling social continue
        // de marcher — cf. spec.
        robots: { index: false, follow: true },
        openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: 'website' },
        twitter: { card: 'summary_large_image', title, description, images: [image] },
      };
    } catch {
      return { title: 'Partie ouverte · Palova', robots: { index: false, follow: true } };
    }
  }
  ```
- [ ] Run : même commande. Expected : PASS (3 tests).
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/app/parties/[id]/page.tsx frontend/__tests__/OpenMatchPageMetadata.test.ts` puis commit :
  ```bash
  git commit -m "fix(seo): noindex sur les parties ouvertes (contenu ephemere, reste partageable)"
  ```

---

### Tâche 8 : Conversion `/` (accueil) — `HomeClient` + métadonnées

**Files** :
- Create : `frontend/app/HomeClient.tsx`
- Rewrite : `frontend/app/page.tsx`
- Test : `frontend/__tests__/HomeMetadata.test.ts`

Aucun test existant n'importe `app/page.tsx` directement (`ClubHouse.test.tsx`/`AnonymousView.test.tsx` testent les composants internes, inchangés) — pas de mise à jour de test existant nécessaire pour cette tâche.

- [ ] **Test d'abord** — `frontend/__tests__/HomeMetadata.test.ts` :
  ```ts
  jest.mock('next/headers', () => ({
    headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-club-slug' ? (globalThis as any).__slug : null) })),
  }));
  jest.mock('../app/HomeClient', () => ({ HomeClient: () => null }));
  jest.mock('../lib/api', () => ({ api: { getClub: jest.fn() }, API_BASE_URL: 'http://localhost:3001' }));

  import { generateMetadata } from '../app/page';
  import { api } from '../lib/api';

  const getClub = api.getClub as jest.Mock;

  describe('generateMetadata /', () => {
    afterEach(() => jest.clearAllMocks());

    it('hôte plateforme → titre/description Palova génériques', async () => {
      (globalThis as any).__slug = undefined;
      const meta = await generateMetadata();
      expect(meta.title).toBe('Palova — Réservez votre terrain de padel en ligne');
      expect((meta.openGraph as any).images[0].url).toBe('/og-default.png');
    });

    it('hôte club, description club renseignée → utilisée telle quelle', async () => {
      (globalThis as any).__slug = 'demo';
      getClub.mockResolvedValue({ name: 'Padel Arena Paris', city: 'Paris', description: '  Le meilleur club de padel du 15e.  ' });
      const meta = await generateMetadata();
      expect(meta.title).toBe('Padel Arena Paris — Réservez un terrain de padel');
      expect(meta.description).toBe('Le meilleur club de padel du 15e.');
      expect((meta.openGraph as any).images[0].url).toBe('http://localhost:3001/api/clubs/demo/icon/og.png');
      expect((meta.alternates as any).canonical).toBe('https://demo.localhost/');
    });

    it('hôte club, pas de description club → repli générique avec la ville', async () => {
      (globalThis as any).__slug = 'demo';
      getClub.mockResolvedValue({ name: 'Padel Arena Paris', city: 'Paris', description: null });
      const meta = await generateMetadata();
      expect(meta.description).toBe('Réservez vos créneaux de padel en ligne au Padel Arena Paris, Paris.');
    });

    it('échec du fetch → repli neutre sans throw', async () => {
      (globalThis as any).__slug = 'demo';
      getClub.mockRejectedValue(new Error('boom'));
      const meta = await generateMetadata();
      expect(meta.title).toBe('Palova');
    });
  });
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/HomeMetadata.test.ts`
  Expected : FAIL — `Cannot find module '../app/page'` (export `generateMetadata` inexistant).
- [ ] **Déplacer le contenu actuel** — créer `frontend/app/HomeClient.tsx` avec le contenu ACTUEL de `frontend/app/page.tsx`, en renommant l'export par défaut en export nommé `HomeClient` :
  ```tsx
  'use client';
  import { useClub } from '@/lib/ClubProvider';
  import { useTheme } from '@/lib/ThemeProvider';
  import PlatformLanding from '@/components/PlatformLanding';
  import { Screen } from '@/components/ui/Screen';
  import { ClubNav } from '@/components/ClubNav';
  import { ClubHouse } from '@/components/ClubHouse';

  export function HomeClient() {
    const { slug, club, loading } = useClub();
    const { th } = useTheme();
    // Plateforme (palova.fr) → accueil adaptatif ; sous-domaine club → Club-house (vitrine du club).
    if (!slug) return <PlatformLanding />;
    if (loading) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
    if (!club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>Club introuvable.</div>;
    return (
      <Screen>
        <div style={{ paddingBottom: 40 }}>
          <ClubNav club={club} />
          <ClubHouse club={club} />
        </div>
      </Screen>
    );
  }
  ```
- [ ] **Réécrire** `frontend/app/page.tsx` (remplace entièrement le fichier) :
  ```tsx
  import type { Metadata } from 'next';
  import { headers } from 'next/headers';
  import { api } from '@/lib/api';
  import { canonicalFor, clubOgImage, PLATFORM_OG_IMAGE } from '@/lib/seo';
  import { HomeClient } from './HomeClient';

  const PLATFORM_TITLE = 'Palova — Réservez votre terrain de padel en ligne';
  const PLATFORM_DESCRIPTION = 'Réservez votre terrain de padel en quelques secondes, rejoignez des parties ouvertes et suivez vos tournois — sur Palova.';

  export async function generateMetadata(): Promise<Metadata> {
    const slug = (await headers()).get('x-club-slug');
    if (!slug) {
      return {
        title: PLATFORM_TITLE,
        description: PLATFORM_DESCRIPTION,
        openGraph: { title: PLATFORM_TITLE, description: PLATFORM_DESCRIPTION, images: [{ url: PLATFORM_OG_IMAGE, width: 1200, height: 630 }] },
      };
    }
    try {
      const club = await api.getClub(slug);
      const title = `${club.name} — Réservez un terrain de padel`;
      const description = club.description?.trim() || `Réservez vos créneaux de padel en ligne au ${club.name}${club.city ? `, ${club.city}` : ''}.`;
      const image = clubOgImage(slug);
      return {
        title, description,
        alternates: { canonical: canonicalFor(slug, '/') },
        openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
        twitter: { card: 'summary_large_image', title, description, images: [image] },
      };
    } catch {
      return { title: 'Palova' };
    }
  }

  export default function HomePage() {
    return <HomeClient />;
  }
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/HomeMetadata.test.ts`
  Expected : PASS (4 tests).
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/app/page.tsx frontend/app/HomeClient.tsx frontend/__tests__/HomeMetadata.test.ts` puis commit :
  ```bash
  git commit -m "feat(seo): metadonnees page d'accueil (club-house / plateforme)"
  ```

---

### Tâche 9 : Conversion `/club` — `ClubPresentationClient` + métadonnées

**Files** :
- Create : `frontend/app/club/ClubPresentationClient.tsx`
- Rewrite : `frontend/app/club/page.tsx`
- Test : `frontend/__tests__/ClubPageMetadata.test.ts` (nouveau), `frontend/__tests__/ClubPage.test.tsx` (modifié)

- [ ] **Test d'abord** — `frontend/__tests__/ClubPageMetadata.test.ts` :
  ```ts
  jest.mock('next/headers', () => ({
    headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-club-slug' ? (globalThis as any).__slug : null) })),
  }));
  jest.mock('../app/club/ClubPresentationClient', () => ({ ClubPresentationClient: () => null }));
  jest.mock('../lib/api', () => ({ api: { getClub: jest.fn(), getClubPresentation: jest.fn() }, API_BASE_URL: 'http://localhost:3001' }));

  import { generateMetadata } from '../app/club/page';
  import { api } from '../lib/api';

  const getClub = api.getClub as jest.Mock;
  const getClubPresentation = api.getClubPresentation as jest.Mock;

  describe('generateMetadata /club', () => {
    afterEach(() => jest.clearAllMocks());

    it('titre "Le club · {nom}", description = extrait de présentation', async () => {
      (globalThis as any).__slug = 'demo';
      getClub.mockResolvedValue({ name: 'Padel Arena Paris', city: 'Paris', description: null });
      getClubPresentation.mockResolvedValue({ presentationText: 'Un club familial au cœur de Paris depuis 2015.' });
      const meta = await generateMetadata();
      expect(meta.title).toBe('Le club · Padel Arena Paris');
      expect(meta.description).toBe('Un club familial au cœur de Paris depuis 2015.');
      expect((meta.alternates as any).canonical).toBe('https://demo.localhost/club');
    });

    it('pas de présentation → repli sur club.description, puis phrase générique', async () => {
      (globalThis as any).__slug = 'demo';
      getClub.mockResolvedValue({ name: 'Padel Arena Paris', city: 'Paris', description: 'Un club sympa.' });
      getClubPresentation.mockResolvedValue({ presentationText: null });
      const meta = await generateMetadata();
      expect(meta.description).toBe('Un club sympa.');
    });

    it('échec du fetch → repli neutre', async () => {
      (globalThis as any).__slug = 'demo';
      getClub.mockRejectedValue(new Error('boom'));
      const meta = await generateMetadata();
      expect(meta.title).toBe('Le club · Palova');
    });
  });
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubPageMetadata.test.ts`
  Expected : FAIL — module `../app/club/page` n'exporte pas `generateMetadata`.
- [ ] **Déplacer le contenu actuel** — créer `frontend/app/club/ClubPresentationClient.tsx` avec le contenu ACTUEL de `frontend/app/club/page.tsx` (179 lignes), en changeant uniquement la ligne d'export :
  - Remplacer `export default function ClubPage() {` par `export function ClubPresentationClient() {`
  - Tout le reste du fichier (imports, corps de la fonction, JSX) reste identique.
- [ ] **Réécrire** `frontend/app/club/page.tsx` :
  ```tsx
  import type { Metadata } from 'next';
  import { headers } from 'next/headers';
  import { api } from '@/lib/api';
  import { canonicalFor, clubOgImage, clubTitle } from '@/lib/seo';
  import { ClubPresentationClient } from './ClubPresentationClient';

  export async function generateMetadata(): Promise<Metadata> {
    const slug = (await headers()).get('x-club-slug');
    if (!slug) return { title: clubTitle('Le club', 'Palova') };
    try {
      const [club, pres] = await Promise.all([api.getClub(slug), api.getClubPresentation(slug)]);
      const title = clubTitle('Le club', club.name);
      const description = pres.presentationText?.trim().slice(0, 155)
        || club.description?.trim()
        || `Découvrez ${club.name}${club.city ? `, à ${club.city}` : ''}.`;
      const image = clubOgImage(slug);
      return {
        title, description,
        alternates: { canonical: canonicalFor(slug, '/club') },
        openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
        twitter: { card: 'summary_large_image', title, description, images: [image] },
      };
    } catch {
      return { title: clubTitle('Le club', 'Palova') };
    }
  }

  export default function ClubPage() {
    return <ClubPresentationClient />;
  }
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubPageMetadata.test.ts`
  Expected : PASS (3 tests).
- [ ] **Mettre à jour le test existant** `frontend/__tests__/ClubPage.test.tsx` :
  - Ligne 2, remplacer :
    ```ts
    import ClubPage from '@/app/club/page';
    ```
    par :
    ```ts
    import { ClubPresentationClient } from '@/app/club/ClubPresentationClient';
    ```
  - Remplacer TOUTES les occurrences (5) de `<ClubPage />` par `<ClubPresentationClient />` (`replace_all`).
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubPage.test.tsx __tests__/ClubPageMetadata.test.ts`
  Expected : PASS (tous les tests, aucune régression).
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/app/club/page.tsx frontend/app/club/ClubPresentationClient.tsx frontend/__tests__/ClubPageMetadata.test.ts frontend/__tests__/ClubPage.test.tsx` puis commit :
  ```bash
  git commit -m "feat(seo): metadonnees page /club (presentation du club)"
  ```

---

### Tâche 10 : Conversion `/events` — `EventsClient` + métadonnées

**Files** :
- Create : `frontend/app/events/EventsClient.tsx`
- Rewrite : `frontend/app/events/page.tsx`
- Test : `frontend/__tests__/EventsMetadata.test.ts`

Aucun test existant n'importe `app/events/page.tsx` directement.

- [ ] **Test d'abord** — `frontend/__tests__/EventsMetadata.test.ts` :
  ```ts
  jest.mock('next/headers', () => ({
    headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-club-slug' ? (globalThis as any).__slug : null) })),
  }));
  jest.mock('../app/events/EventsClient', () => ({ EventsClient: () => null }));
  jest.mock('../lib/api', () => ({ api: { getClub: jest.fn() }, API_BASE_URL: 'http://localhost:3001' }));

  import { generateMetadata } from '../app/events/page';
  import { api } from '../lib/api';

  const getClub = api.getClub as jest.Mock;

  describe('generateMetadata /events', () => {
    afterEach(() => jest.clearAllMocks());

    it('hôte club → titre "Tournois & animations · {nom}"', async () => {
      (globalThis as any).__slug = 'demo';
      getClub.mockResolvedValue({ name: 'Padel Arena Paris' });
      const meta = await generateMetadata();
      expect(meta.title).toBe('Tournois & animations · Padel Arena Paris');
      expect(meta.description).toContain('Padel Arena Paris');
    });

    it('hôte plateforme → titre générique', async () => {
      (globalThis as any).__slug = undefined;
      const meta = await generateMetadata();
      expect(meta.title).toBe('Tournois & animations · Palova');
    });

    it('échec du fetch → repli neutre', async () => {
      (globalThis as any).__slug = 'demo';
      getClub.mockRejectedValue(new Error('boom'));
      const meta = await generateMetadata();
      expect(meta.title).toBe('Tournois & animations · Palova');
    });
  });
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/EventsMetadata.test.ts`
  Expected : FAIL — export manquant.
- [ ] **Déplacer le contenu actuel** — créer `frontend/app/events/EventsClient.tsx` avec le contenu ACTUEL de `frontend/app/events/page.tsx` (209 lignes), en remplaçant uniquement `export default function EventsPage() {` par `export function EventsClient() {`.
- [ ] **Réécrire** `frontend/app/events/page.tsx` :
  ```tsx
  import type { Metadata } from 'next';
  import { headers } from 'next/headers';
  import { api } from '@/lib/api';
  import { canonicalFor, clubOgImage, clubTitle } from '@/lib/seo';
  import { EventsClient } from './EventsClient';

  export async function generateMetadata(): Promise<Metadata> {
    const slug = (await headers()).get('x-club-slug');
    if (!slug) return { title: clubTitle('Tournois & animations', 'Palova') };
    try {
      const club = await api.getClub(slug);
      const title = clubTitle('Tournois & animations', club.name);
      const description = `Découvrez les tournois et animations à venir au ${club.name}.`;
      const image = clubOgImage(slug);
      return {
        title, description,
        alternates: { canonical: canonicalFor(slug, '/events') },
        openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
        twitter: { card: 'summary_large_image', title, description, images: [image] },
      };
    } catch {
      return { title: clubTitle('Tournois & animations', 'Palova') };
    }
  }

  export default function EventsPage() {
    return <EventsClient />;
  }
  ```
- [ ] Run : même commande. Expected : PASS (3 tests).
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/app/events/page.tsx frontend/app/events/EventsClient.tsx frontend/__tests__/EventsMetadata.test.ts` puis commit :
  ```bash
  git commit -m "feat(seo): metadonnees page /events (liste)"
  ```

---

### Tâche 11 : Conversion `/events/[id]` — `EventDetailClient` + métadonnées

**Files** :
- Create : `frontend/app/events/[id]/EventDetailClient.tsx`
- Rewrite : `frontend/app/events/[id]/page.tsx`
- Test : `frontend/__tests__/EventDetailMetadata.test.ts` (nouveau), `frontend/__tests__/EventDetail.test.tsx` (modifié)

- [ ] **Test d'abord** — `frontend/__tests__/EventDetailMetadata.test.ts` :
  ```ts
  jest.mock('../app/events/[id]/EventDetailClient', () => ({ EventDetailClient: () => null }));
  jest.mock('../lib/api', () => ({ api: { getEvent: jest.fn() }, API_BASE_URL: 'http://localhost:3001' }));

  import { generateMetadata } from '../app/events/[id]/page';
  import { api } from '../lib/api';

  const getEvent = api.getEvent as jest.Mock;

  const eventStub = {
    id: 'ev1', name: 'Mêlée du samedi', kind: 'MELEE' as const,
    startTime: '2026-08-01T08:00:00.000Z', endTime: '2026-08-01T10:00:00.000Z',
    confirmedCount: 6, capacity: 16,
    club: { slug: 'demo', name: 'Padel Arena Paris', timezone: 'Europe/Paris' },
  };

  describe('generateMetadata /events/[id]', () => {
    afterEach(() => jest.clearAllMocks());

    it('titre "{nom event} · {club}", description composée', async () => {
      getEvent.mockResolvedValue(eventStub);
      const meta = await generateMetadata({ params: Promise.resolve({ id: 'ev1' }) });
      expect(meta.title).toBe('Mêlée du samedi · Padel Arena Paris');
      expect(meta.description).toContain('Padel Arena Paris');
      expect((meta.alternates as any).canonical).toBe('https://demo.localhost/events/ev1');
      expect((meta.openGraph as any).images[0].url).toBe('http://localhost:3001/api/clubs/demo/icon/og.png');
    });

    it('échec du fetch → repli neutre', async () => {
      getEvent.mockRejectedValue(new Error('boom'));
      const meta = await generateMetadata({ params: Promise.resolve({ id: 'ev1' }) });
      expect(meta.title).toBe('Event · Palova');
    });
  });
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/EventDetailMetadata.test.ts`
  Expected : FAIL — export manquant.
- [ ] **Déplacer le contenu actuel** — créer `frontend/app/events/[id]/EventDetailClient.tsx` avec le contenu ACTUEL de `frontend/app/events/[id]/page.tsx` (232 lignes), avec 2 changements :
  1. Retirer `useParams` de l'import `next/navigation` (ligne 3) :
     ```ts
     import { useCallback, useEffect, useState } from 'react';
     import { useRouter } from 'next/navigation';
     ```
  2. Remplacer :
     ```ts
     export default function EventDetailPage() {
       const { id } = useParams<{ id: string }>();
     ```
     par :
     ```ts
     export function EventDetailClient({ id }: { id: string }) {
     ```
  Tout le reste du fichier (imports restants, corps de la fonction, JSX) reste identique.
- [ ] **Réécrire** `frontend/app/events/[id]/page.tsx` :
  ```tsx
  import type { Metadata } from 'next';
  import { api } from '@/lib/api';
  import { canonicalFor, clubOgImage, clubTitle } from '@/lib/seo';
  import { KIND_LABEL } from '@/lib/events';
  import { formatDateShortTimeRange, heroPlacesLabel } from '@/lib/tournament';
  import { EventDetailClient } from './EventDetailClient';

  export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;
    try {
      const event = await api.getEvent(id);
      const title = clubTitle(event.name, event.club.name);
      const dateLabel = formatDateShortTimeRange(event.startTime, event.endTime, event.club.timezone);
      const places = heroPlacesLabel(event.confirmedCount, event.capacity);
      const description = [KIND_LABEL[event.kind], dateLabel, places?.text, event.club.name].filter(Boolean).join(' · ');
      const image = clubOgImage(event.club.slug);
      return {
        title, description,
        alternates: { canonical: canonicalFor(event.club.slug, `/events/${id}`) },
        openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
        twitter: { card: 'summary_large_image', title, description, images: [image] },
      };
    } catch {
      return { title: 'Event · Palova' };
    }
  }

  export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <EventDetailClient id={id} />;
  }
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/EventDetailMetadata.test.ts`
  Expected : PASS (2 tests).
- [ ] **Mettre à jour le test existant** `frontend/__tests__/EventDetail.test.tsx` :
  - Ligne 6, remplacer :
    ```ts
    import EventDetailPage from '../app/events/[id]/page';
    ```
    par :
    ```ts
    import { EventDetailClient } from '../app/events/[id]/EventDetailClient';
    ```
  - Lignes 9-12, retirer `useParams` du mock `next/navigation` :
    ```ts
    jest.mock('next/navigation', () => ({
      useRouter: () => ({ push: jest.fn() }),
    }));
    ```
  - Lignes 118-123, remplacer :
    ```ts
    function renderPage() {
      return render(
        <ThemeProvider>
          <EventDetailPage />
        </ThemeProvider>,
      );
    }
    ```
    par :
    ```ts
    function renderPage() {
      return render(
        <ThemeProvider>
          <EventDetailClient id="ev1" />
        </ThemeProvider>,
      );
    }
    ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/EventDetail.test.tsx __tests__/EventDetailMetadata.test.ts`
  Expected : PASS (tous les tests, aucune régression).
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/app/events/[id]/page.tsx frontend/app/events/[id]/EventDetailClient.tsx frontend/__tests__/EventDetailMetadata.test.ts frontend/__tests__/EventDetail.test.tsx` puis commit :
  ```bash
  git commit -m "feat(seo): metadonnees fiche event /events/[id]"
  ```

---

### Tâche 12 : Conversion `/tournois/[id]` — `TournamentDetailClient` + métadonnées

**Files** :
- Create : `frontend/app/tournois/[id]/TournamentDetailClient.tsx`
- Rewrite : `frontend/app/tournois/[id]/page.tsx`
- Test : `frontend/__tests__/TournamentDetailMetadata.test.ts` (nouveau), `frontend/__tests__/TournamentDetail.test.tsx` (modifié)

- [ ] **Test d'abord** — `frontend/__tests__/TournamentDetailMetadata.test.ts` :
  ```ts
  jest.mock('../app/tournois/[id]/TournamentDetailClient', () => ({ TournamentDetailClient: () => null }));
  jest.mock('../lib/api', () => ({ api: { getTournament: jest.fn() }, API_BASE_URL: 'http://localhost:3001' }));

  import { generateMetadata } from '../app/tournois/[id]/page';
  import { api } from '../lib/api';

  const getTournament = api.getTournament as jest.Mock;

  const tournamentStub = {
    id: 't1', name: 'Open P100', category: 'P100', gender: 'MEN' as const,
    startTime: '2026-09-05T08:00:00.000Z', endTime: '2026-09-05T18:00:00.000Z',
    confirmedCount: 6, maxTeams: 16,
    club: { slug: 'demo', name: 'Padel Arena Paris', timezone: 'Europe/Paris' },
  };

  describe('generateMetadata /tournois/[id]', () => {
    afterEach(() => jest.clearAllMocks());

    it('titre "{nom tournoi} · {club}", description composée avec catégorie/genre', async () => {
      getTournament.mockResolvedValue(tournamentStub);
      const meta = await generateMetadata({ params: Promise.resolve({ id: 't1' }) });
      expect(meta.title).toBe('Open P100 · Padel Arena Paris');
      expect(meta.description).toContain('P100 · Messieurs');
      expect((meta.alternates as any).canonical).toBe('https://demo.localhost/tournois/t1');
    });

    it('échec du fetch → repli neutre', async () => {
      getTournament.mockRejectedValue(new Error('boom'));
      const meta = await generateMetadata({ params: Promise.resolve({ id: 't1' }) });
      expect(meta.title).toBe('Tournoi · Palova');
    });
  });
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentDetailMetadata.test.ts`
  Expected : FAIL — export manquant.
- [ ] **Déplacer le contenu actuel** — créer `frontend/app/tournois/[id]/TournamentDetailClient.tsx` avec le contenu ACTUEL de `frontend/app/tournois/[id]/page.tsx` (278 lignes), avec 2 changements :
  1. Retirer `use` de l'import `react` (ligne 2) :
     ```ts
     import { useEffect, useState } from 'react';
     ```
  2. Remplacer :
     ```ts
     export default function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
       const { id } = use(params);
     ```
     par :
     ```ts
     export function TournamentDetailClient({ id }: { id: string }) {
     ```
  Tout le reste du fichier reste identique (y compris `router.push('/tournois')` dans le bouton retour, inchangé — `/tournois` reste un chemin de redirection valide côté club).
- [ ] **Réécrire** `frontend/app/tournois/[id]/page.tsx` :
  ```tsx
  import type { Metadata } from 'next';
  import { api } from '@/lib/api';
  import { canonicalFor, clubOgImage, clubTitle } from '@/lib/seo';
  import { GENDER_LABEL } from '@/lib/events';
  import { formatDateShortTimeRange, heroPlacesLabel } from '@/lib/tournament';
  import { TournamentDetailClient } from './TournamentDetailClient';

  export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;
    try {
      const t = await api.getTournament(id);
      const title = clubTitle(t.name, t.club.name);
      const dateLabel = formatDateShortTimeRange(t.startTime, t.endTime, t.club.timezone);
      const places = heroPlacesLabel(t.confirmedCount, t.maxTeams);
      const description = [`${t.category} · ${GENDER_LABEL[t.gender]}`, dateLabel, places?.text, t.club.name].filter(Boolean).join(' · ');
      const image = clubOgImage(t.club.slug);
      return {
        title, description,
        alternates: { canonical: canonicalFor(t.club.slug, `/tournois/${id}`) },
        openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
        twitter: { card: 'summary_large_image', title, description, images: [image] },
      };
    } catch {
      return { title: 'Tournoi · Palova' };
    }
  }

  export default async function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <TournamentDetailClient id={id} />;
  }
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentDetailMetadata.test.ts`
  Expected : PASS (2 tests).
- [ ] **Mettre à jour le test existant** `frontend/__tests__/TournamentDetail.test.tsx` :
  - Ligne 5, retirer l'import `Suspense` (n'est plus utilisé) :
    ```ts
    import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
    ```
  - Ligne 7, remplacer :
    ```ts
    import TournamentDetailPage from '../app/tournois/[id]/page';
    ```
    par :
    ```ts
    import { TournamentDetailClient } from '../app/tournois/[id]/TournamentDetailClient';
    ```
  - Lignes 138-149, remplacer :
    ```ts
    async function renderPage(id = 't1') {
      // Render inside act(async) so React resolves the use(params) Suspense boundary AND the
      // chained data-load promises (getTournament/getMyProfile/…) flush within a single act pass.
      await act(async () => {
        render(
          <ThemeProvider>
            <Suspense fallback={null}>
              <TournamentDetailPage params={Promise.resolve({ id })} />
            </Suspense>
          </ThemeProvider>,
        );
      });
    ```
    par :
    ```ts
    async function renderPage(id = 't1') {
      // Render inside act(async) so React flushe les promesses de chargement chaînées
      // (getTournament/getMyProfile/…) en un seul passage act.
      await act(async () => {
        render(
          <ThemeProvider>
            <TournamentDetailClient id={id} />
          </ThemeProvider>,
        );
      });
    ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentDetail.test.tsx __tests__/TournamentDetailMetadata.test.ts`
  Expected : PASS (tous les tests, aucune régression).
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/app/tournois/[id]/page.tsx frontend/app/tournois/[id]/TournamentDetailClient.tsx frontend/__tests__/TournamentDetailMetadata.test.ts frontend/__tests__/TournamentDetail.test.tsx` puis commit :
  ```bash
  git commit -m "feat(seo): metadonnees fiche tournoi /tournois/[id]"
  ```

---

### Tâche 13 : Conversion `/decouvrir` — `DiscoverClient` + métadonnées statiques

**Files** :
- Create : `frontend/app/decouvrir/DiscoverClient.tsx`
- Rewrite : `frontend/app/decouvrir/page.tsx`
- Test : `frontend/__tests__/DiscoverPage.test.tsx` (modifié)

Pas de test dédié pour cette conversion : `metadata` y est un **objet littéral statique** (pas de fonction, pas de branchement à tester) — `tsc --noEmit` suffit à en garantir la forme. Le test existant `DiscoverPage.test.tsx` couvre déjà tout le comportement du composant client, inchangé.

- [ ] **Déplacer le contenu actuel** — créer `frontend/app/decouvrir/DiscoverClient.tsx` avec le contenu ACTUEL de `frontend/app/decouvrir/page.tsx` (194 lignes), en remplaçant uniquement `export default function DiscoverPage() {` par `export function DiscoverClient() {`.
- [ ] **Réécrire** `frontend/app/decouvrir/page.tsx` :
  ```tsx
  import type { Metadata } from 'next';
  import { PLATFORM_OG_IMAGE } from '@/lib/seo';
  import { DiscoverClient } from './DiscoverClient';

  const TITLE = 'Trouvez un club de padel près de chez vous | Palova';
  const DESCRIPTION = 'Parties ouvertes, tournois et clubs de padel partout en France — cherchez par ville, département ou autour de vous.';

  export const metadata: Metadata = {
    title: TITLE,
    description: DESCRIPTION,
    openGraph: { title: TITLE, description: DESCRIPTION, images: [{ url: PLATFORM_OG_IMAGE, width: 1200, height: 630 }] },
  };

  export default function DecouvrirPage() {
    return <DiscoverClient />;
  }
  ```
- [ ] **Mettre à jour le test existant** `frontend/__tests__/DiscoverPage.test.tsx` :
  - Ligne 45, remplacer :
    ```ts
    import DiscoverPage from '@/app/decouvrir/page';
    ```
    par :
    ```ts
    import { DiscoverClient } from '@/app/decouvrir/DiscoverClient';
    ```
  - Ligne 74, remplacer :
    ```ts
    const wrap = () => render(<ThemeProvider><DiscoverPage /></ThemeProvider>);
    ```
    par :
    ```ts
    const wrap = () => render(<ThemeProvider><DiscoverClient /></ThemeProvider>);
    ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPage.test.tsx`
  Expected : PASS (aucune régression).
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/app/decouvrir/page.tsx frontend/app/decouvrir/DiscoverClient.tsx frontend/__tests__/DiscoverPage.test.tsx` puis commit :
  ```bash
  git commit -m "feat(seo): metadonnees statiques page /decouvrir"
  ```

---

### Tâche 14 : `/faq` (dynamique) et `/tarifs` (statique) — pages déjà serveur

**Files** :
- Modify : `frontend/app/faq/page.tsx`, `frontend/app/tarifs/page.tsx`
- Test : `frontend/__tests__/FaqMetadata.test.ts` (nouveau)

- [ ] **Test d'abord** — `frontend/__tests__/FaqMetadata.test.ts` :
  ```ts
  jest.mock('next/headers', () => ({
    headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-club-slug' ? (globalThis as any).__slug : null) })),
  }));
  jest.mock('@/components/content/ContentShell', () => ({ ContentShell: ({ children }: { children: React.ReactNode }) => children }));
  jest.mock('@/components/content/FaqView', () => ({ FaqView: () => null }));
  jest.mock('../lib/api', () => ({ api: { getClub: jest.fn() } }));

  import { generateMetadata } from '../app/faq/page';
  import { api } from '../lib/api';

  const getClub = api.getClub as jest.Mock;

  describe('generateMetadata /faq', () => {
    afterEach(() => jest.clearAllMocks());

    it('hôte club → "FAQ · {nom du club}"', async () => {
      (globalThis as any).__slug = 'demo';
      getClub.mockResolvedValue({ name: 'Padel Arena Paris' });
      const meta = await generateMetadata();
      expect(meta.title).toBe('FAQ · Padel Arena Paris');
    });

    it('hôte plateforme → "FAQ | Palova"', async () => {
      (globalThis as any).__slug = undefined;
      const meta = await generateMetadata();
      expect(meta.title).toBe('FAQ | Palova');
    });

    it('échec du fetch → repli plateforme', async () => {
      (globalThis as any).__slug = 'demo';
      getClub.mockRejectedValue(new Error('boom'));
      const meta = await generateMetadata();
      expect(meta.title).toBe('FAQ | Palova');
    });
  });
  ```
- [ ] Run : `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FaqMetadata.test.ts`
  Expected : FAIL — `generateMetadata` inexistant.
- [ ] **Implémenter** — `frontend/app/faq/page.tsx` :
  ```tsx
  import type { Metadata } from 'next';
  import { headers } from 'next/headers';
  import { api } from '@/lib/api';
  import { clubTitle, platformTitle } from '@/lib/seo';
  import { ContentShell } from '@/components/content/ContentShell';
  import { FaqView } from '@/components/content/FaqView';

  export async function generateMetadata(): Promise<Metadata> {
    const slug = (await headers()).get('x-club-slug');
    if (!slug) return { title: platformTitle('FAQ') };
    try {
      const club = await api.getClub(slug);
      return { title: clubTitle('FAQ', club.name) };
    } catch {
      return { title: platformTitle('FAQ') };
    }
  }

  export default function FaqPage() {
    return (
      <ContentShell>
        <FaqView />
      </ContentShell>
    );
  }
  ```
- [ ] Run : même commande. Expected : PASS (3 tests).
- [ ] **Implémenter (sans test dédié — objet littéral statique)** — `frontend/app/tarifs/page.tsx` :
  ```tsx
  import type { Metadata } from 'next';
  import { platformTitle } from '@/lib/seo';
  import { ContentShell } from '@/components/content/ContentShell';
  import { PricingContent } from '@/components/platform/PricingContent';

  export const metadata: Metadata = {
    title: platformTitle('Tarifs'),
    description: 'Palova est gratuit jusqu’à 50 membres actifs, puis un tarif simple au palier — sans engagement.',
  };

  // Tarifs Palova (B2B) — toujours le contenu plateforme, y compris depuis un club.
  // (/offres rend le même PricingContent sur l'hôte plateforme ; sur un club, sa page « Nos offres ».)
  export default function TarifsPage() {
    return (
      <ContentShell>
        <PricingContent />
      </ContentShell>
    );
  }
  ```
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
- [ ] `git add frontend/app/faq/page.tsx frontend/app/tarifs/page.tsx frontend/__tests__/FaqMetadata.test.ts` puis commit :
  ```bash
  git commit -m "feat(seo): metadonnees /faq (dynamique) et /tarifs (statique)"
  ```

---

### Tâche 15 : Vérification finale

**Files** : aucun (vérification uniquement).

- [ ] Suite ciblée complète (tous les fichiers touchés par ce plan, frontend) :
  ```bash
  cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath \
    __tests__/seo.test.ts __tests__/robotsRules.test.ts __tests__/sitemapEntries.test.ts \
    __tests__/SitemapRoute.test.ts __tests__/OpenMatchPageMetadata.test.ts \
    __tests__/HomeMetadata.test.ts __tests__/ClubPageMetadata.test.ts __tests__/ClubPage.test.tsx \
    __tests__/EventsMetadata.test.ts __tests__/EventDetailMetadata.test.ts __tests__/EventDetail.test.tsx \
    __tests__/TournamentDetailMetadata.test.ts __tests__/TournamentDetail.test.tsx \
    __tests__/DiscoverPage.test.tsx __tests__/FaqMetadata.test.ts
  ```
  Expected : PASS, 0 échec. (Suite complète non lancée — flake `BookingModal` connue et sans rapport, cf. mémoire projet ; les suites ci-dessus couvrent tout le périmètre modifié.)
- [ ] `cd frontend && node node_modules/typescript/bin/tsc --noEmit` — 0 erreur.
- [ ] Backend :
  ```bash
  cd backend && node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/icon.routes.test.ts
  cd backend && node node_modules/typescript/bin/tsc --noEmit
  ```
  Expected : PASS, 0 erreur.
- [ ] Vérification manuelle (dev server) — démarrer la stack (`start.ps1` ou `npm run dev` dans `backend/` et `frontend/`), puis :
  ```bash
  curl http://localhost:3000/robots.txt
  curl -H "Host: padel-arena-paris.localhost:3000" http://localhost:3000/robots.txt
  curl http://localhost:3000/sitemap.xml
  curl -H "Host: padel-arena-paris.localhost:3000" http://localhost:3000/sitemap.xml
  curl -o /tmp/og-test.png http://localhost:3001/api/clubs/padel-arena-paris/icon/og.png
  ```
  Vérifier à l'œil (`open /tmp/og-test.png` ou équivalent) que la carte s'affiche correctement (logo + nom lisible sur le fond de couleur du club — slug de test `padel-arena-paris`, cf. mémoire projet).
- [ ] Rapporter à Eric le résultat de cette vérification manuelle avant de considérer la feature terminée.

---

## Récapitulatif des fichiers touchés

**Nouveaux** : `frontend/lib/{seo,robotsRules,sitemapEntries}.ts`, `frontend/app/{robots,sitemap}.ts`, `frontend/app/HomeClient.tsx`, `frontend/app/club/ClubPresentationClient.tsx`, `frontend/app/events/EventsClient.tsx`, `frontend/app/events/[id]/EventDetailClient.tsx`, `frontend/app/tournois/[id]/TournamentDetailClient.tsx`, `frontend/app/decouvrir/DiscoverClient.tsx`, `frontend/public/og-default.png`, 9 nouveaux fichiers de test.

**Modifiés** : `frontend/app/{page,club/page,events/page,events/[id]/page,tournois/[id]/page,decouvrir/page,faq/page,tarifs/page,parties/[id]/page}.tsx`, `frontend/__tests__/{ClubPage,EventDetail,TournamentDetail,DiscoverPage,OpenMatchPageMetadata}.test.tsx`, `backend/src/services/icon.service.ts`, `backend/src/routes/clubs.ts`, `backend/src/routes/__tests__/icon.routes.test.ts`.

**Non touchés** (assumé, cf. spec) : `/cgu`, `/cgv`, `/mentions-legales`, `/confidentialite`, `/offres`, `/aide` (exclus via robots.txt seul, aucun changement de code) ; toute migration Prisma (aucune).
