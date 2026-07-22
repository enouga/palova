# Google Analytics 4 + bannière de consentement (opt-in strict) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charger Google Analytics 4 **uniquement après consentement explicite** (opt-in strict), via une bannière conforme CNIL, partout sauf les back-offices `/admin` et `/superadmin`.

**Architecture:** Un composant client `AnalyticsConsent` monté globalement dans `app/layout.tsx` lit un cookie de consentement partagé (`palova_consent` sur `.palova.fr`) ; s'il vaut `granted`, il injecte `gtag.js` et émet les pages vues à chaque navigation. Sinon il affiche la bannière (Accepter / Refuser). Aucun ID GA (`NEXT_PUBLIC_GA_ID` vide) → composant inerte. Logique pure isolée dans `lib/consent.ts`, effets de bord GA dans `lib/gtag.ts`.

**Tech Stack:** Next.js 16 (App Router, `usePathname`), React client component, GA4 `gtag.js`, cookies partagés (réutilise `lib/session.ts`), Jest + Testing Library.

**⚠️ Rappel Next 16 :** `frontend/AGENTS.md` impose de lire `node_modules/next/dist/docs/` avant d'écrire du code Next (breaking changes). Ici on n'utilise que `usePathname` de `next/navigation` (API stable, pas de `Suspense` requis contrairement à `useSearchParams`) et une injection de script manuelle — pas de `next/script`.

**⚠️ WIP concurrent :** l'arbre de travail contient déjà des fichiers modifiés (`.env.prod.example`, etc.). Committer **fichier par fichier** avec les chemins exacts indiqués ; ne jamais `git add -A`. Ne jamais `git stash` (pile partagée entre worktrees).

---

## Ordre des tâches

1. Helpers de consentement purs (`lib/consent.ts`) + réexport de `writeCookie`
2. Chargeur GA (`lib/gtag.ts`)
3. Composant `AnalyticsConsent` (bannière, exclusion, accept/refuse, réouverture, page vue)
4. Montage dans le layout + bouton « Gérer les cookies » du Footer
5. Mises à jour légales (politique cookies + sous-traitants + version PRIVACY)
6. Configuration prod (build-arg `NEXT_PUBLIC_GA_ID`)
7. Vérification finale (tsc + suites ciblées) + prérequis manuel

---

### Task 1 : Helpers de consentement purs

**Files:**
- Modify: `frontend/lib/session.ts` (exporter `writeCookie`)
- Create: `frontend/lib/consent.ts`
- Test: `frontend/__tests__/consent.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/consent.test.ts` :

```ts
import { readConsent, writeConsent, CONSENT_COOKIE, CONSENT_VERSION, CONSENT_EVENT } from '@/lib/consent';

afterEach(() => {
  // purge le cookie entre les cas (jsdom : host-only sur localhost)
  document.cookie = `${CONSENT_COOKIE}=; path=/; max-age=0`;
});

test('readConsent renvoie null sans cookie', () => {
  expect(readConsent()).toBeNull();
});

test('writeConsent/readConsent : aller-retour granted', () => {
  writeConsent('granted');
  expect(readConsent()).toBe('granted');
});

test('writeConsent/readConsent : aller-retour denied', () => {
  writeConsent('denied');
  expect(readConsent()).toBe('denied');
});

test('une version de consentement périmée est ignorée (bannière réaffichée)', () => {
  document.cookie = `${CONSENT_COOKIE}=granted:0; path=/`;
  expect(readConsent()).toBeNull();
});

test('une valeur inconnue est ignorée', () => {
  document.cookie = `${CONSENT_COOKIE}=maybe:${CONSENT_VERSION}; path=/`;
  expect(readConsent()).toBeNull();
});

test('constantes exportées', () => {
  expect(CONSENT_COOKIE).toBe('palova_consent');
  expect(CONSENT_EVENT).toBe('palova:open-consent');
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run : `node node_modules/jest/bin/jest.js __tests__/consent.test.ts --runTestsByPath`
Expected : FAIL — `Cannot find module '@/lib/consent'`.

- [ ] **Step 3 : Exporter `writeCookie` depuis `session.ts`**

Dans `frontend/lib/session.ts`, ajouter le mot-clé `export` à la fonction `writeCookie` (ligne 20). Résultat :

```ts
export function writeCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}${cookieDomainAttr()}; path=/; SameSite=Lax${secureAttr()}; max-age=${maxAge}`;
}
```

(Aucun autre changement : `cookieDomainAttr` pose `domain=.palova.fr` en prod, host-only sur localhost/dev — exactement la portée voulue pour le consentement partagé entre sous-domaines.)

- [ ] **Step 4 : Créer `lib/consent.ts`**

```ts
import { getCookie, writeCookie } from './session';

/** Cookie qui mémorise le choix de l'utilisateur sur les cookies de mesure d'audience.
 *  Strictement fonctionnel (exempté de consentement). Partagé sur `.palova.fr` via la
 *  logique de domaine de session.ts → consenti une fois pour tous les sous-domaines. */
export const CONSENT_COOKIE = 'palova_consent';

/** Bumper si GA se met à collecter autre chose → la bannière réapparaît pour re-recueillir. */
export const CONSENT_VERSION = 1;

/** Event window émis par « Gérer les cookies » (Footer) pour rouvrir la bannière. */
export const CONSENT_EVENT = 'palova:open-consent';

// 6 mois : re-demande périodique (recommandation CNIL, borne max 13 mois).
const MAX_AGE = 60 * 60 * 24 * 180;

export type ConsentValue = 'granted' | 'denied';

/** Choix courant, ou null si absent OU version périmée (→ bannière à réafficher). */
export function readConsent(): ConsentValue | null {
  const raw = getCookie(CONSENT_COOKIE);
  if (!raw) return null;
  const [value, version] = raw.split(':');
  if (version !== String(CONSENT_VERSION)) return null;
  if (value !== 'granted' && value !== 'denied') return null;
  return value;
}

/** Persiste le choix (valeur + version) dans le cookie partagé. */
export function writeConsent(value: ConsentValue): void {
  writeCookie(CONSENT_COOKIE, `${value}:${CONSENT_VERSION}`, MAX_AGE);
}
```

- [ ] **Step 5 : Lancer le test pour vérifier le succès**

Run : `node node_modules/jest/bin/jest.js __tests__/consent.test.ts --runTestsByPath`
Expected : PASS (6 tests).

- [ ] **Step 6 : Commit**

```bash
git add frontend/lib/session.ts frontend/lib/consent.ts frontend/__tests__/consent.test.ts
git commit -m "feat(analytics): helpers de consentement cookies (lib/consent)"
```

---

### Task 2 : Chargeur Google Analytics (`lib/gtag.ts`)

**Files:**
- Create: `frontend/lib/gtag.ts`
- Test: `frontend/__tests__/gtag.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/gtag.test.ts` :

```ts
import { gaId, loadGtag, pageview } from '@/lib/gtag';

const OLD = process.env.NEXT_PUBLIC_GA_ID;
afterEach(() => {
  if (OLD === undefined) delete process.env.NEXT_PUBLIC_GA_ID;
  else process.env.NEXT_PUBLIC_GA_ID = OLD;
  document.getElementById('ga-gtag')?.remove();
  // @ts-expect-error nettoyage du gtag posé sur window
  delete window.gtag;
  // @ts-expect-error nettoyage du dataLayer
  delete window.dataLayer;
});

test('gaId lit NEXT_PUBLIC_GA_ID', () => {
  process.env.NEXT_PUBLIC_GA_ID = 'G-ABC123';
  expect(gaId()).toBe('G-ABC123');
});

test('gaId vide si non défini', () => {
  delete process.env.NEXT_PUBLIC_GA_ID;
  expect(gaId()).toBe('');
});

test('loadGtag injecte le script gtag.js et initialise window.gtag', () => {
  loadGtag('G-ABC123');
  const s = document.getElementById('ga-gtag') as HTMLScriptElement | null;
  expect(s).not.toBeNull();
  expect(s!.src).toContain('googletagmanager.com/gtag/js?id=G-ABC123');
  expect(typeof window.gtag).toBe('function');
});

test('loadGtag est idempotent (pas de double injection)', () => {
  loadGtag('G-ABC123');
  loadGtag('G-ABC123');
  expect(document.querySelectorAll('#ga-gtag').length).toBe(1);
});

test('pageview pousse un événement page_view quand gtag existe', () => {
  const spy = jest.fn();
  // @ts-expect-error stub gtag
  window.gtag = spy;
  pageview('/reserver');
  expect(spy).toHaveBeenCalledWith('event', 'page_view', { page_path: '/reserver' });
});

test('pageview ne fait rien sans gtag', () => {
  expect(() => pageview('/reserver')).not.toThrow();
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run : `node node_modules/jest/bin/jest.js __tests__/gtag.test.ts --runTestsByPath`
Expected : FAIL — `Cannot find module '@/lib/gtag'`.

- [ ] **Step 3 : Créer `lib/gtag.ts`**

```ts
// Effets de bord Google Analytics 4 (chargement + pages vues). Séparé de lib/consent.ts
// (logique pure) pour rester mockable. GA n'est appelé qu'APRÈS consentement accordé.

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** ID de mesure GA4 (G-XXXX), injecté au build via NEXT_PUBLIC_GA_ID. Vide → GA désactivé. */
export function gaId(): string {
  return process.env.NEXT_PUBLIC_GA_ID || '';
}

/** Injecte gtag.js et configure GA4 en « mesure d'audience seule » (pas de pub, IP anonymisée,
 *  pas de page_view auto — on les émet nous-mêmes à chaque navigation SPA). Idempotent. */
export function loadGtag(id: string): void {
  if (typeof window === 'undefined') return;
  if (document.getElementById('ga-gtag')) return; // déjà chargé

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag pousse ses arguments bruts dans dataLayer (contrat Google).
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    send_page_view: false,
  });

  const s = document.createElement('script');
  s.id = 'ga-gtag';
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
}

/** Émet une page vue GA4 pour le chemin donné (navigation cliente App Router). */
export function pageview(path: string): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', { page_path: path });
}
```

- [ ] **Step 4 : Lancer le test pour vérifier le succès**

Run : `node node_modules/jest/bin/jest.js __tests__/gtag.test.ts --runTestsByPath`
Expected : PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/gtag.ts frontend/__tests__/gtag.test.ts
git commit -m "feat(analytics): chargeur GA4 gtag.js + page_view (lib/gtag)"
```

---

### Task 3 : Composant `AnalyticsConsent`

**Files:**
- Create: `frontend/components/AnalyticsConsent.tsx`
- Test: `frontend/__tests__/AnalyticsConsent.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/AnalyticsConsent.test.tsx` :

```tsx
import { render, screen, act, cleanup } from '@testing-library/react';
import { AnalyticsConsent } from '@/components/AnalyticsConsent';
import { CONSENT_COOKIE, CONSENT_VERSION, CONSENT_EVENT } from '@/lib/consent';
import * as gtag from '@/lib/gtag';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '' }) }) }));

const mockPath = { current: '/' };
jest.mock('next/navigation', () => ({ usePathname: () => mockPath.current }));

jest.mock('@/lib/gtag', () => ({
  gaId: () => process.env.NEXT_PUBLIC_GA_ID || '',
  loadGtag: jest.fn(),
  pageview: jest.fn(),
}));

const OLD = process.env.NEXT_PUBLIC_GA_ID;
beforeEach(() => { process.env.NEXT_PUBLIC_GA_ID = 'G-TEST'; mockPath.current = '/'; });
afterEach(() => {
  cleanup();
  if (OLD === undefined) delete process.env.NEXT_PUBLIC_GA_ID;
  else process.env.NEXT_PUBLIC_GA_ID = OLD;
  document.cookie = `${CONSENT_COOKIE}=; path=/; max-age=0`;
  jest.clearAllMocks();
});

test('sans NEXT_PUBLIC_GA_ID : rien (ni bannière ni GA)', () => {
  delete process.env.NEXT_PUBLIC_GA_ID;
  render(<AnalyticsConsent />);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
  expect(gtag.loadGtag).not.toHaveBeenCalled();
});

test('aucun choix : la bannière s\'affiche avec Accepter et Refuser', () => {
  render(<AnalyticsConsent />);
  expect(screen.getByRole('button', { name: /accepter/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /refuser/i })).toBeInTheDocument();
  expect(gtag.loadGtag).not.toHaveBeenCalled();
});

test('Accepter : charge GA, écrit le cookie granted, ferme la bannière', () => {
  render(<AnalyticsConsent />);
  act(() => { screen.getByRole('button', { name: /accepter/i }).click(); });
  expect(gtag.loadGtag).toHaveBeenCalledWith('G-TEST');
  expect(document.cookie).toContain(`${CONSENT_COOKIE}=granted%3A${CONSENT_VERSION}`);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
});

test('Refuser : ne charge pas GA, écrit denied, ferme la bannière', () => {
  render(<AnalyticsConsent />);
  act(() => { screen.getByRole('button', { name: /refuser/i }).click(); });
  expect(gtag.loadGtag).not.toHaveBeenCalled();
  expect(document.cookie).toContain(`${CONSENT_COOKIE}=denied%3A${CONSENT_VERSION}`);
  expect(screen.queryByRole('button', { name: /refuser/i })).toBeNull();
});

test('cookie granted au montage : pas de bannière, GA chargé, page vue émise', () => {
  document.cookie = `${CONSENT_COOKIE}=granted:${CONSENT_VERSION}; path=/`;
  render(<AnalyticsConsent />);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
  expect(gtag.loadGtag).toHaveBeenCalledWith('G-TEST');
  expect(gtag.pageview).toHaveBeenCalledWith('/');
});

test('cookie denied au montage : pas de bannière, GA non chargé', () => {
  document.cookie = `${CONSENT_COOKIE}=denied:${CONSENT_VERSION}; path=/`;
  render(<AnalyticsConsent />);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
  expect(gtag.loadGtag).not.toHaveBeenCalled();
});

test('sur /admin : rend null même avec consentement accordé', () => {
  document.cookie = `${CONSENT_COOKIE}=granted:${CONSENT_VERSION}; path=/`;
  mockPath.current = '/admin/planning';
  render(<AnalyticsConsent />);
  expect(gtag.loadGtag).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
});

test('sur /superadmin : rend null', () => {
  mockPath.current = '/superadmin';
  render(<AnalyticsConsent />);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
});

test('événement « Gérer les cookies » : rouvre la bannière même après un choix', () => {
  document.cookie = `${CONSENT_COOKIE}=denied:${CONSENT_VERSION}; path=/`;
  render(<AnalyticsConsent />);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
  act(() => { window.dispatchEvent(new Event(CONSENT_EVENT)); });
  expect(screen.getByRole('button', { name: /accepter/i })).toBeInTheDocument();
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run : `node node_modules/jest/bin/jest.js __tests__/AnalyticsConsent.test.tsx --runTestsByPath`
Expected : FAIL — `Cannot find module '@/components/AnalyticsConsent'`.

- [ ] **Step 3 : Créer `components/AnalyticsConsent.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { gaId, loadGtag, pageview } from '@/lib/gtag';
import { readConsent, writeConsent, CONSENT_EVENT, type ConsentValue } from '@/lib/consent';

// Back-offices authentifiés : jamais de mesure d'audience ni de bannière (se tracer soi-même
// en superadmin ou coller une bannière au gérant dans son outil n'a aucune valeur « audience »).
function isBackOffice(path: string): boolean {
  return path.startsWith('/admin') || path.startsWith('/superadmin');
}

export function AnalyticsConsent() {
  const pathname = usePathname() || '/';
  const { th } = useTheme();
  const id = gaId();
  const active = !!id && !isBackOffice(pathname);

  const [consent, setConsent] = useState<ConsentValue | null>(null);
  const [open, setOpen] = useState(false);

  // Montage : lit le choix, charge GA s'il est accordé, ouvre la bannière si aucun choix.
  useEffect(() => {
    if (!active) return;
    const c = readConsent();
    setConsent(c);
    if (c === 'granted') loadGtag(id);
    if (c === null) setOpen(true);
  }, [active, id]);

  // « Gérer les cookies » (Footer) → rouvre la bannière.
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(CONSENT_EVENT, h);
    return () => window.removeEventListener(CONSENT_EVENT, h);
  }, []);

  // Page vue à chaque navigation cliente, seulement si le consentement est accordé.
  useEffect(() => {
    if (active && consent === 'granted') pageview(pathname);
  }, [active, consent, pathname]);

  if (!active || !open) return null;

  const accept = () => { writeConsent('granted'); loadGtag(id); setConsent('granted'); setOpen(false); };
  const refuse = () => { writeConsent('denied'); setConsent('denied'); setOpen(false); };

  return (
    <div
      role="dialog"
      aria-label="Consentement aux cookies"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, background: th.surface2, borderTop: `1px solid ${th.line}`, padding: '14px 16px', boxShadow: th.shadow, fontFamily: th.fontUI }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <p style={{ margin: 0, color: th.text, fontSize: 14, lineHeight: 1.4, flex: '1 1 320px' }}>
          Nous utilisons des cookies de mesure d&apos;audience (Google Analytics) pour comprendre
          la fréquentation du site. Aucun cookie publicitaire.{' '}
          <a href="/confidentialite" style={{ color: th.accent, textDecoration: 'underline' }}>En savoir plus</a>.
        </p>
        <div style={{ display: 'flex', gap: 10, flex: '0 0 auto' }}>
          <button type="button" onClick={refuse} style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${th.line}`, background: 'transparent', color: th.text, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Refuser
          </button>
          <button type="button" onClick={accept} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: th.accent, color: th.onAccent, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Lancer le test pour vérifier le succès**

Run : `node node_modules/jest/bin/jest.js __tests__/AnalyticsConsent.test.tsx --runTestsByPath`
Expected : PASS (9 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/AnalyticsConsent.tsx frontend/__tests__/AnalyticsConsent.test.tsx
git commit -m "feat(analytics): banniere de consentement opt-in strict (AnalyticsConsent)"
```

---

### Task 4 : Montage dans le layout + bouton « Gérer les cookies » (Footer)

**Files:**
- Modify: `frontend/app/layout.tsx` (monter `<AnalyticsConsent />`)
- Modify: `frontend/components/Footer.tsx` (bouton « Gérer les cookies »)
- Test: `frontend/__tests__/Footer.cookies.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue (Footer)**

Créer `frontend/__tests__/Footer.cookies.test.tsx` :

```tsx
import { render, screen, cleanup } from '@testing-library/react';
import { Footer } from '@/components/Footer';
import { CONSENT_EVENT } from '@/lib/consent';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '' }) }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null }) }));
jest.mock('next/navigation', () => ({ usePathname: () => '/' }));

const OLD = process.env.NEXT_PUBLIC_GA_ID;
afterEach(() => {
  cleanup();
  if (OLD === undefined) delete process.env.NEXT_PUBLIC_GA_ID;
  else process.env.NEXT_PUBLIC_GA_ID = OLD;
});

test('avec un ID GA : le bouton « Gérer les cookies » émet l\'événement de réouverture', () => {
  process.env.NEXT_PUBLIC_GA_ID = 'G-TEST';
  const spy = jest.fn();
  window.addEventListener(CONSENT_EVENT, spy);
  render(<Footer />);
  const btn = screen.getByRole('button', { name: /gérer les cookies/i });
  btn.click();
  expect(spy).toHaveBeenCalled();
  window.removeEventListener(CONSENT_EVENT, spy);
});

test('sans ID GA : pas de bouton « Gérer les cookies »', () => {
  delete process.env.NEXT_PUBLIC_GA_ID;
  render(<Footer />);
  expect(screen.queryByRole('button', { name: /gérer les cookies/i })).toBeNull();
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run : `node node_modules/jest/bin/jest.js __tests__/Footer.cookies.test.tsx --runTestsByPath`
Expected : FAIL — aucun bouton « Gérer les cookies ».

- [ ] **Step 3 : Ajouter le bouton au Footer**

Dans `frontend/components/Footer.tsx`, ajouter les imports en tête (après la ligne `import { CANONICAL_ROOT } from '@/lib/roots';`) :

```tsx
import { gaId } from '@/lib/gtag';
import { CONSENT_EVENT } from '@/lib/consent';
```

Puis, dans le `<nav>`, juste après le `{links.map(...)}` (avant la fermeture `</nav>`), insérer :

```tsx
          {gaId() && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(CONSENT_EVENT))}
              style={{ color: th.textMute, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13.5, fontWeight: 500, fontFamily: 'inherit' }}
            >
              Gérer les cookies
            </button>
          )}
```

- [ ] **Step 4 : Lancer le test pour vérifier le succès**

Run : `node node_modules/jest/bin/jest.js __tests__/Footer.cookies.test.tsx --runTestsByPath`
Expected : PASS (2 tests).

- [ ] **Step 5 : Monter `AnalyticsConsent` dans le layout**

Dans `frontend/app/layout.tsx`, ajouter l'import (après la ligne `import { LegalUpdateBanner } from '@/components/LegalUpdateBanner';`) :

```tsx
import { AnalyticsConsent } from '@/components/AnalyticsConsent';
```

Puis, dans le JSX rendu, ajouter `<AnalyticsConsent />` comme frère de `<DmWidgetHost />` (juste après lui) :

```tsx
            <DmWidgetHost />
            <AnalyticsConsent />
            <Footer />
```

- [ ] **Step 6 : Vérifier que le type-check passe**

Run : `node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`
Expected : aucune erreur sur `layout.tsx`, `Footer.tsx`, `AnalyticsConsent.tsx`, `gtag.ts`, `consent.ts` (ignorer d'éventuelles erreurs pré-existantes hors de ces fichiers dues à du WIP concurrent — cf. mémoire « frontend jest doesn't type-check »).

- [ ] **Step 7 : Commit**

```bash
git add frontend/app/layout.tsx frontend/components/Footer.tsx frontend/__tests__/Footer.cookies.test.tsx
git commit -m "feat(analytics): montage global + bouton Gerer les cookies (Footer)"
```

---

### Task 5 : Mises à jour légales (politique cookies + sous-traitants + version PRIVACY)

**Files:**
- Modify: `backend/src/content/legalVersions.ts` (bump PRIVACY)
- Modify: `frontend/lib/platformContent.ts` (en-tête version + tableau + destinataires + DPA + section Cookies)
- Modify: `frontend/__tests__/platformContent.test.ts` (assertion cookies réécrite)

- [ ] **Step 1 : Repérer le test à mettre à jour**

Un seul test fige le texte cookies supprimé : `frontend/__tests__/platformContent.test.ts` (l.24-27) asserte `PLATFORM_CONFIDENTIALITE` contient `'aucun bandeau'`. Il sera réécrit au Step 8. (La suite backend `legal.service.test.ts` lit la version PRIVACY dynamiquement depuis `LEGAL_VERSIONS`, elle ne fige pas la date `'2026-07-20'` → rien à y changer ; les autres fichiers de test qui contiennent `2026-07-20` l'ont comme date-fixture sans rapport.)

- [ ] **Step 2 : Bumper la version PRIVACY (backend)**

Dans `backend/src/content/legalVersions.ts`, changer :

```ts
  PRIVACY: '2026-07-20',
```
en :
```ts
  PRIVACY: '2026-07-21',
```

- [ ] **Step 3 : Mettre à jour l'en-tête de version (frontend)**

Dans `frontend/lib/platformContent.ts`, dans `PLATFORM_CONFIDENTIALITE`, changer la ligne d'en-tête :

```
*Version du 20 juillet 2026*
```
en :
```
*Version du 21 juillet 2026*
```

- [ ] **Step 4 : Ajouter la ligne « Mesure d'audience » au tableau des traitements**

Dans le même document, dans le tableau « Quelles données, pourquoi, combien de temps ? », ajouter une ligne après la ligne « Sécurité et journaux techniques » :

```
| Mesure d'audience du site | pages vues, provenance, identifiants Google Analytics | consentement | 13 mois (Google) |
```

- [ ] **Step 5 : Ajouter Google aux destinataires**

Dans la section « Destinataires et transferts », remplacer le bloc existant par (ajout de Google en fin de liste des sous-traitants) :

```
Sous-traitants : **Hetzner** (hébergement, Allemagne), **Stripe** (paiements — des transferts
hors UE peuvent intervenir, encadrés par des clauses contractuelles types), **OVH** (e-mails,
France), **GlitchTip** (supervision technique — collecte de métadonnées d'erreur applicative :
horodatage, message, identifiant interne de compte, adresse IP — aux seules fins de détection
et de correction des dysfonctionnements) et **Google** (mesure d'audience du site via Google
Analytics, uniquement si vous y consentez ; des transferts hors UE peuvent intervenir, encadrés
par le Data Privacy Framework auquel Google est certifié). Les membres d'un même club voient les
informations que vous rendez visibles (nom, avatar, niveau, participation aux parties).
```

- [ ] **Step 6 : Réécrire la section Cookies**

Remplacer intégralement la section `## Cookies` (de `## Cookies` jusqu'à la ligne juste avant `## Suppression de compte`) par :

```
## Cookies
Cookies **strictement nécessaires** (exemptés de consentement) :

- cookie \`token\` (session de connexion, 7 jours) ;
- cookie \`clubId\` (contexte du club courant, 7 jours) ;
- cookie \`palova_consent\` (mémorise votre choix sur les cookies de mesure d'audience, 6 mois) ;
- stockage local du navigateur pour vos préférences d'affichage (thème, vues).

Cookies de **mesure d'audience**, soumis à votre **consentement préalable** :

- **Google Analytics** (\`_ga\`, \`_ga_<id>\`, jusqu'à 13 mois) : statistiques de fréquentation
  anonymisées (pages vues, provenance), sans publicité ni personnalisation. Ces cookies ne sont
  déposés **que si vous cliquez « Accepter »** dans le bandeau affiché à votre première visite,
  et **jamais** si vous refusez ou ignorez le bandeau. Vous pouvez revenir sur votre choix à tout
  moment via **« Gérer les cookies »** en pied de page.

**Aucun cookie publicitaire.** Les données de mesure d'audience sont traitées par Google (voir
« Destinataires et transferts »).

```

- [ ] **Step 7 : Ajouter Google au sous-traitant de l'annexe DPA**

Dans `PLATFORM_CGV` (annexe article 28), point 6 « Sous-traitants ultérieurs », remplacer :

```
6. **Sous-traitants ultérieurs** : le Club autorise le recours à Hetzner (hébergement), Stripe
   (paiements), OVH (envoi d'e-mails) et GlitchTip (supervision technique des erreurs). Tolaris
   Studio informera le Club de tout changement, qui pourra s'y opposer pour motif légitime.
```
par :
```
6. **Sous-traitants ultérieurs** : le Club autorise le recours à Hetzner (hébergement), Stripe
   (paiements), OVH (envoi d'e-mails), GlitchTip (supervision technique des erreurs) et Google
   (mesure d'audience du site, sur consentement des visiteurs). Tolaris Studio informera le Club
   de tout changement, qui pourra s'y opposer pour motif légitime.
```

- [ ] **Step 8 : Mettre à jour le test `platformContent.test.ts`**

Dans `frontend/__tests__/platformContent.test.ts`, remplacer le cas :

```ts
  it('confidentialité : cookies documentés sans bandeau', () => {
    expect(PLATFORM_CONFIDENTIALITE).toContain('token');
    expect(PLATFORM_CONFIDENTIALITE).toContain('aucun bandeau');
  });
```
par :
```ts
  it('confidentialité : cookies fonctionnels + mesure d\'audience soumise au consentement', () => {
    expect(PLATFORM_CONFIDENTIALITE).toContain('token');
    expect(PLATFORM_CONFIDENTIALITE).toContain('Google Analytics');
    expect(PLATFORM_CONFIDENTIALITE).toContain('consentement');
    expect(PLATFORM_CONFIDENTIALITE).toContain('Gérer les cookies');
  });
```

- [ ] **Step 9 : Lancer les suites légales (backend + front)**

Run (backend) : `(cd backend && node node_modules/jest/bin/jest.js legal.service)`
Then (frontend) : `node node_modules/jest/bin/jest.js platformContent --runTestsByPath`
Expected : les deux vertes. La version PRIVACY est lue depuis `LEGAL_VERSIONS` (non figée dans les tests) ; le cas cookies réécrit passe avec le nouveau texte (`Google Analytics`, `consentement`, `Gérer les cookies` présents).

- [ ] **Step 10 : Commit**

```bash
git add backend/src/content/legalVersions.ts frontend/lib/platformContent.ts frontend/__tests__/platformContent.test.ts
git commit -m "docs(legal): politique cookies GA4 + Google sous-traitant, bump PRIVACY 2026-07-21"
```

---

### Task 6 : Configuration prod (`NEXT_PUBLIC_GA_ID`)

**Files:**
- Modify: `docker-compose.prod.yml` (build-arg frontend)
- Modify: `.env.prod.example` (variable documentée)
- Modify: `render.yaml` (envVar `palova-web`)

⚠️ Ces fichiers peuvent porter du WIP concurrent — n'ajouter QUE les lignes ci-dessous et committer chaque fichier explicitement.

- [ ] **Step 1 : docker-compose.prod.yml — ajouter le build-arg**

Dans le bloc `frontend.build.args`, juste après la ligne `NEXT_PUBLIC_GLITCHTIP_DSN: ${NEXT_PUBLIC_GLITCHTIP_DSN}`, ajouter :

```yaml
        # Google Analytics 4 — ID de mesure (G-XXXX), gelé au build (NEXT_PUBLIC_*).
        # Absent → aucune mesure d'audience, aucune bannière cookie.
        NEXT_PUBLIC_GA_ID: ${NEXT_PUBLIC_GA_ID}
```

- [ ] **Step 2 : .env.prod.example — documenter la variable**

À la fin du fichier `.env.prod.example`, ajouter :

```bash

# --- Mesure d'audience (Google Analytics 4) ---
# ID de mesure GA4 (G-XXXXXXXX), créé sur analytics.google.com. Injecté en BUILD-ARG du
# frontend → GELÉ au build (rebuild du front si changé). Absent → GA désactivé, aucune
# bannière cookie. GA n'est chargé qu'après consentement explicite du visiteur.
NEXT_PUBLIC_GA_ID=
```

- [ ] **Step 3 : render.yaml — ajouter l'envVar**

Dans le service `palova-web`, sous `envVars`, ajouter (après `NEXT_PUBLIC_COOKIE_DOMAIN`) :

```yaml
      - key: NEXT_PUBLIC_GA_ID
        sync: false
```

- [ ] **Step 4 : Vérifier la cohérence YAML**

Run : `node -e "const y=require('fs').readFileSync('docker-compose.prod.yml','utf8'); if(!y.includes('NEXT_PUBLIC_GA_ID')) throw new Error('manquant'); console.log('OK')"`
Expected : `OK`.

- [ ] **Step 5 : Commit**

```bash
git add docker-compose.prod.yml .env.prod.example render.yaml
git commit -m "chore(analytics): NEXT_PUBLIC_GA_ID en build-arg frontend (prod)"
```

---

### Task 7 : Vérification finale

- [ ] **Step 1 : Type-check ciblé**

Run : `node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`
Expected : aucune erreur sur les fichiers de la feature (`consent.ts`, `gtag.ts`, `AnalyticsConsent.tsx`, `Footer.tsx`, `layout.tsx`). Ignorer les erreurs pré-existantes hors périmètre (WIP concurrent).

- [ ] **Step 2 : Suites de la feature**

Run : `node node_modules/jest/bin/jest.js consent gtag AnalyticsConsent Footer.cookies`
Expected : toutes vertes (6 + 6 + 9 + 2 = 23 tests).

- [ ] **Step 3 : Vérification visuelle (skill `verify`)**

Lancer le frontend avec `NEXT_PUBLIC_GA_ID=G-TEST` (dev), invoquer le skill `verify` sur `/` (hôte plateforme) et sur un hôte club :
- la bannière apparaît en bas, boutons « Accepter » / « Refuser » de taille égale, pas de panneau sombre (thème clair ET sombre) ;
- « Refuser » → la bannière disparaît, aucun cookie `_ga` déposé ;
- « Accepter » → bannière disparaît, cookie `palova_consent=granted` + `_ga` présents ;
- naviguer vers `/admin` → aucune bannière ;
- « Gérer les cookies » (pied de page) → la bannière réapparaît.
Sans variable (défaut dev) : aucune bannière nulle part.

- [ ] **Step 4 : Prérequis manuel (Eric, hors code)**

Consigner dans la remise : créer la propriété GA4 sur analytics.google.com, récupérer le `G-XXXXXXXX`, le renseigner comme `NEXT_PUBLIC_GA_ID` dans l'environnement de build prod (docker-compose `.env.prod` ou variables Render), **puis rebuild du frontend** (variable gelée au build). Sans cet ID, la feature reste dormante (aucune bannière, aucun tracé).

---

## Notes de conformité (rappel)

- **Opt-in strict** : `loadGtag` n'est appelé qu'après `writeConsent('granted')` (Accepter) ou si le cookie vaut déjà `granted`. Refus/ignoré → GA jamais chargé.
- **Refuser après avoir accepté** : le cookie passe `denied` et plus aucune page vue n'est émise ; le script `gtag.js` déjà chargé dans l'onglet courant disparaît au prochain rechargement de page. Acceptable en v1 (documenté).
- **Retrait aussi simple que l'octroi** : bouton « Gérer les cookies » présent sur toutes les pages à Footer (public + app joueur). Absent sur `/admin`/`/superadmin` — précisément les pages où GA n'est pas actif.
- **Cookie de consentement** partagé sur `.palova.fr` → consenti une fois pour tous les sous-domaines (host-only en dev `*.localhost`, limitation Chrome connue).
