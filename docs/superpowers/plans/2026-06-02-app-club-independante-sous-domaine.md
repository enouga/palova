# App club indépendante par sous-domaine — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque club a une application autonome servie sur son sous-domaine (`<slug>.localhost` en dev), avec une vraie page d'accueil (annonces / notifications / sponsors / hub de liens), une session joueur partagée entre sous-domaines, et l'annuaire réservé à la plateforme ; au passage, les pop-ups de réservation/annulation passent en haut de l'écran.

**Architecture :** Un seul codebase Next.js 16. Un `proxy.ts` (middleware Next 16) lit le host et injecte `x-club-slug` ; le `layout.tsx` serveur lit ce header et passe le slug à un `ClubProvider` client qui fetch le club et **brande tout l'arbre**. Sur un host club, `/` = home club, `/reserver` = réservation. La plateforme (`localhost`) garde landing + annuaire. Auth = JWT Bearer inchangé côté API ; seul le **stockage** du token passe de `localStorage` à un cookie de domaine partagé. Annonces/sponsors = modèles Prisma + back-office + endpoints publics.

**Tech Stack :** Next.js 16 (App Router, Turbopack, `proxy.ts`), React 19, Express 5, Prisma 7 (adapter `PrismaPg`), PostgreSQL 16, Jest (ts-jest back, jsdom front), luxon (déjà présent).

**Spec de référence :** `docs/superpowers/specs/2026-06-02-app-club-independante-sous-domaine-design.md`

---

## Préambule — conventions & rappels

- **Docker obligatoire avant tout test BDD :** `"C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe" up -d` (jamais `docker compose`).
- **Vérif standard d'un lot :** backend `cd backend && npx tsc --noEmit && npx jest` ; frontend `cd frontend && npx tsc --noEmit && npx jest`.
- **Next 16 :** lire `frontend/node_modules/next/dist/docs/` avant d'écrire `proxy.ts` (confirmer le nom d'export attendu : `proxy` vs `middleware`) et pour `headers()`/`useSearchParams`. `params`/`headers()` sont des Promises (`await`).
- **Prisma 7 :** ne jamais instancier `new PrismaClient()` sans l'adapter `PrismaPg` (déjà en place dans `src/db/prisma.ts` et `prisma/seed.ts`).
- **Dev sous-domaines :** les navigateurs résolvent `*.localhost` → 127.0.0.1 sans toucher au fichier hosts. Tester sur `http://padel-arena-paris.localhost:3000`.
- **Commits fréquents**, un par tâche, message `feat:`/`refactor:`/`test:`. Avertissements `LF→CRLF` Windows = normaux.

### Variables d'environnement à ajouter

`frontend/.env.local` (compléter, ne pas écraser la ligne existante) :
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_ROOT_DOMAIN=localhost
NEXT_PUBLIC_COOKIE_DOMAIN=localhost
```

`backend/.env` (ajouter) :
```
FRONTEND_ROOT_DOMAIN=localhost
```

---

# LOT A — Routing & indépendance

But : le sous-domaine sert l'app club brandée, la plateforme garde annuaire/landing, l'API accepte les requêtes cross-sous-domaine.

## Task A0 : CORS backend pour les sous-domaines

Sans ça, `clubA.localhost:3000` ne peut pas appeler l'API `localhost:3001` (origine non autorisée).

**Files:**
- Modify: `backend/src/app.ts:17`

- [ ] **Step 1 — Remplacer la config CORS** (`backend/src/app.ts`, ligne `app.use(cors({ origin: ... }))`) par :

```ts
const FRONTEND_ROOT = process.env.FRONTEND_ROOT_DOMAIN || 'localhost';
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // outils non-navigateur / same-origin
    try {
      const host = new URL(origin).hostname;
      if (host === FRONTEND_ROOT || host.endsWith(`.${FRONTEND_ROOT}`)) return cb(null, true);
    } catch { /* origine illisible */ }
    cb(new Error('Not allowed by CORS'));
  },
}));
```

- [ ] **Step 2 — Vérifier la compilation** : `cd backend && npx tsc --noEmit` → aucune erreur.
- [ ] **Step 3 — Vérifier l'autorisation** (docker + backend lancés) :
  `curl -s -H "Origin: http://padel-arena-paris.localhost:3000" -D - "http://localhost:3001/api/sports" -o /dev/null | grep -i access-control-allow-origin`
  Attendu : en-tête `Access-Control-Allow-Origin: http://padel-arena-paris.localhost:3000`.
- [ ] **Step 4 — Commit** : `git add backend/src/app.ts && git commit -m "feat(cors): autoriser les origines sous-domaines des clubs"`

## Task A1 : `proxy.ts` — résolution host → club

**Files:**
- Create: `frontend/proxy.ts`

- [ ] **Step 1 — Lire la doc Next 16** : ouvrir `frontend/node_modules/next/dist/docs/` (ou le fichier de migration middleware→proxy) pour confirmer le nom d'export (`proxy` attendu d'après le CLAUDE.md). Adapter le nom dans le step suivant si nécessaire.
- [ ] **Step 2 — Créer `frontend/proxy.ts`** :

```ts
import { NextRequest, NextResponse } from 'next/server';

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'localhost';

/** Renvoie le slug du club si le host est un sous-domaine club, sinon null (plateforme). */
function clubSlugFromHost(host: string): string | null {
  const h = host.split(':')[0];
  if (h === ROOT || h === `www.${ROOT}` || h === `app.${ROOT}`) return null;
  if (h.endsWith(`.${ROOT}`)) {
    const label = h.slice(0, -(ROOT.length + 1)).split('.')[0];
    if (!label || label === 'www' || label === 'app') return null;
    return label;
  }
  return null; // host inconnu → traité comme plateforme
}

function portSuffix(host: string): string {
  const i = host.indexOf(':');
  return i >= 0 ? host.slice(i) : '';
}

export function proxy(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const url = request.nextUrl;
  const slug = clubSlugFromHost(host);

  if (!slug) {
    // HOST PLATEFORME — rétro-compat /c/<slug> → racine du sous-domaine club
    const m = url.pathname.match(/^\/c\/([^/]+)\/?$/);
    if (m) return NextResponse.redirect(`${url.protocol}//${m[1]}.${ROOT}${portSuffix(host)}/`);
    return NextResponse.next();
  }

  // HOST CLUB
  // L'annuaire et la création de club n'existent que sur la plateforme.
  if (url.pathname === '/clubs' || url.pathname.startsWith('/clubs/')) {
    return NextResponse.redirect(`${url.protocol}//${ROOT}${portSuffix(host)}${url.pathname}`);
  }
  // Injecte le slug pour le layout serveur.
  const headers = new Headers(request.headers);
  headers.set('x-club-slug', slug);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\..*).*)'],
};
```

- [ ] **Step 3 — Vérifier** : `cd frontend && npx tsc --noEmit` propre. Lancer `npm run dev`, puis :
  - `curl -s -D - "http://localhost:3000/c/padel-arena-paris" -o /dev/null | grep -i location` → `Location: http://padel-arena-paris.localhost:3000/`
  - `curl -s -D - -H "Host: padel-arena-paris.localhost:3000" "http://localhost:3000/clubs" -o /dev/null | grep -i location` → redirige vers `http://localhost:3000/clubs`.
- [ ] **Step 4 — Commit** : `git add frontend/proxy.ts frontend/.env.local && git commit -m "feat(routing): proxy host→club + env ROOT_DOMAIN"`

## Task A2 : `ClubProvider` + `useClub`, branding remonté au layout

**Files:**
- Create: `frontend/lib/ClubProvider.tsx`
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1 — Créer `frontend/lib/ClubProvider.tsx`** :

```tsx
'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { api, ClubDetail } from '@/lib/api';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ThemeMode } from '@/lib/theme';

interface ClubContextValue { slug: string | null; club: ClubDetail | null; loading: boolean; }
const ClubContext = createContext<ClubContextValue>({ slug: null, club: null, loading: false });

/** Reçoit le slug (lu par le layout serveur depuis l'en-tête x-club-slug),
 *  fetch le club et brande tout le sous-arbre. Slug null = plateforme. */
export function ClubProvider({ slug, children }: { slug: string | null; children: React.ReactNode }) {
  const [club, setClub] = useState<ClubDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(!!slug);

  useEffect(() => {
    if (!slug) { setClub(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.getClub(slug)
      .then((c) => { if (!cancelled) setClub(c); })
      .catch(() => { if (!cancelled) setClub(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <ClubContext.Provider value={{ slug, club, loading }}>
      <ThemeProvider accent={club?.accentColor} defaultMode={club?.defaultThemeMode as ThemeMode | undefined}>
        {children}
      </ThemeProvider>
    </ClubContext.Provider>
  );
}

export function useClub(): ClubContextValue { return useContext(ClubContext); }
```

- [ ] **Step 2 — Modifier `frontend/app/layout.tsx`** : rendre le composant `async`, lire l'en-tête, remplacer `<ThemeProvider>` par `<ClubProvider>` :

```tsx
import { headers } from 'next/headers';
import { ClubProvider } from '@/lib/ClubProvider';
// ... (imports fonts + metadata inchangés ; retirer l'import direct de ThemeProvider)

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const slug = (await headers()).get('x-club-slug');
  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ClubProvider slug={slug}>{children}</ClubProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3 — Vérifier** : `npx tsc --noEmit` propre ; `npm run dev` ; `http://padel-arena-paris.localhost:3000` se charge sans crash (le contenu changera en A4).
- [ ] **Step 4 — Commit** : `git add frontend/lib/ClubProvider.tsx frontend/app/layout.tsx && git commit -m "feat(club): ClubProvider + branding remonté au layout par host"`

## Task A3 : helper `clubUrl` + cartes annuaire vers le sous-domaine

**Files:**
- Create: `frontend/lib/clubUrl.ts`
- Modify: `frontend/app/clubs/page.tsx` (composant `ClubCard`)

- [ ] **Step 1 — Créer `frontend/lib/clubUrl.ts`** :

```ts
/** URL absolue de l'app d'un club (sous-domaine). En SSR, repli https://. */
export function clubUrl(slug: string, path = '/'): string {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'localhost';
  const p = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined') {
    const port = window.location.port ? `:${window.location.port}` : '';
    return `${window.location.protocol}//${slug}.${root}${port}${p}`;
  }
  return `https://${slug}.${root}${p}`;
}
```

- [ ] **Step 2 — Modifier `ClubCard`** dans `frontend/app/clubs/page.tsx` : remplacer le `<Link href={`/c/${club.slug}`} …>` par une ancre absolue (cross-origine, pas de `next/link`). Remplacer la balise ouvrante/fermante :

```tsx
import { clubUrl } from '@/lib/clubUrl';
// ...
<a href={clubUrl(club.slug)} style={{ textDecoration: 'none', display: 'block' }}>
  {/* contenu inchangé */}
</a>
```
Retirer l'import `Link` s'il n'est plus utilisé ailleurs dans le fichier.

- [ ] **Step 3 — Vérifier** : `npx tsc --noEmit` propre ; sur `http://localhost:3000/clubs`, un clic sur une carte navigue vers `http://padel-arena-paris.localhost:3000/`.
- [ ] **Step 4 — Commit** : `git add frontend/lib/clubUrl.ts frontend/app/clubs/page.tsx && git commit -m "feat(annuaire): cartes club → sous-domaine"`

## Task A4 : page `/reserver` (ex `/c/[slug]`) + home conditionnelle + landing extraite

**Files:**
- Create: `frontend/components/PlatformLanding.tsx`
- Create: `frontend/app/reserver/page.tsx`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/app/c/[slug]/page.tsx` (devient une redirection)

- [ ] **Step 1 — Extraire la landing** : créer `frontend/components/PlatformLanding.tsx` en y déplaçant **tel quel** le JSX actuel de `frontend/app/page.tsx` (le composant `HomePage` actuel), renommé `PlatformLanding` (garder `'use client'`, les imports, `SPORTS`, le contenu). C'est la landing plateforme.

- [ ] **Step 2 — Créer `frontend/app/reserver/page.tsx`** à partir de l'actuel `frontend/app/c/[slug]/page.tsx` :
  - Conserver le composant `ClubContent` (toute la UI Réserver/Terrains + `BookingModal`) **à l'identique**, SAUF :
    - supprimer le bouton « retour annuaire » (le `<button onClick={() => router.push('/clubs')} aria-label="Annuaire">…</button>` en tête) — l'app club est autonome ; le remplacer par `<Logotype size={20} />` (import depuis `@/components/ui/atoms`).
    - l'onglet initial lit `?tab=courts` : remplacer `const [tab, setTab] = useState<'book' | 'courts'>('book');` par une init différée :
      ```tsx
      const [tab, setTab] = useState<'book' | 'courts'>('book');
      useEffect(() => {
        if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'courts') setTab('courts');
      }, []);
      ```
  - Le composant exporté par défaut lit le club via `useClub()` au lieu de `useParams()`/fetch, et **n'enveloppe plus** de `ThemeProvider` (le layout brande déjà) :
    ```tsx
    'use client';
    import { useClub } from '@/lib/ClubProvider';
    // ... imports existants de ClubContent (sans ThemeProvider ni useParams)
    export default function ReserverPage() {
      const { club, loading } = useClub();
      const { th } = useTheme();
      if (loading) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
      if (!club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>Club introuvable.</div>;
      return <ClubContent club={club} />;
    }
    ```

- [ ] **Step 3 — Réécrire `frontend/app/page.tsx`** (home conditionnelle) :

```tsx
'use client';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import PlatformLanding from '@/components/PlatformLanding';
import ClubHome from '@/components/ClubHome'; // créé au Lot C ; en attendant, voir Step 4

export default function HomePage() {
  const { slug, club, loading } = useClub();
  const { th } = useTheme();
  if (!slug) return <PlatformLanding />;
  if (loading) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (!club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>Club introuvable.</div>;
  return <ClubHome club={club} />;
}
```

- [ ] **Step 4 — Stub temporaire `ClubHome`** (remplacé au Lot C) : créer `frontend/components/ClubHome.tsx` minimal pour que le Lot A compile et tourne :

```tsx
'use client';
import { ClubDetail } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Screen } from '@/components/ui/Screen';
import { Btn } from '@/components/ui/atoms';
export default function ClubHome({ club }: { club: ClubDetail }) {
  const router = useRouter();
  return (
    <Screen>
      <div style={{ padding: 24 }}>
        <h1>{club.name}</h1>
        <Btn full icon="arrowR" onClick={() => router.push('/reserver')}>Réserver</Btn>
      </div>
    </Screen>
  );
}
```

- [ ] **Step 5 — Transformer `frontend/app/c/[slug]/page.tsx`** en redirection (couvre les accès `/c/...` sur un host club) :

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function LegacyClubRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/reserver'); }, [router]);
  return null;
}
```

- [ ] **Step 6 — Vérifier** : `npx tsc --noEmit` propre ; `npx jest` (les tests existants passent). Manuel :
  - `http://localhost:3000` → landing plateforme.
  - `http://padel-arena-paris.localhost:3000` → stub home club (nom + bouton Réserver).
  - `http://padel-arena-paris.localhost:3000/reserver` → grille de réservation brandée ; un créneau ouvre le `BookingModal`.
- [ ] **Step 7 — Commit** : `git add -A frontend/app frontend/components && git commit -m "feat(club): /reserver + home conditionnelle + landing extraite + redirect /c"`

## Task A5 : `Logotype` contextuel sur host club

**Files:**
- Modify: `frontend/components/ui/atoms.tsx` (fonction `Logotype`)

- [ ] **Step 1 — Modifier `Logotype`** : importer `useClub` et faire pointer le logo vers `/` sur un host club :

```tsx
import { useClub } from '@/lib/ClubProvider';
// dans Logotype, après const { token, clubId, ready } = useAuth();
const { slug } = useClub();
const target = href ?? (slug ? '/' : (!ready ? '/' : clubId ? '/admin' : token ? '/clubs' : '/'));
```
(le reste du composant est inchangé.)

- [ ] **Step 2 — Vérifier** : `npx tsc --noEmit` propre ; `npx jest` (les tests BookingModal/ConfirmDialog rendent sans `ClubProvider` — `useClub()` renvoie la valeur par défaut `{slug:null}`, aucun throw). Manuel : sur un sous-domaine, le logo ramène à `/` (home club).
- [ ] **Step 3 — Commit** : `git add frontend/components/ui/atoms.tsx && git commit -m "feat(ui): logo contextuel → home club sur sous-domaine"`

**Vérif de fin de Lot A :** `cd frontend && npx tsc --noEmit && npx jest` propres ; les 3 parcours manuels du A4/A5 OK ; `cd backend && npx tsc --noEmit && npx jest` propres.

---

# LOT B — Session partagée entre sous-domaines

But : se connecter une fois, rester connecté sur tous les `*.localhost`. Auth API inchangée (Bearer) ; on déplace le stockage vers un cookie de domaine. Le back-office se scope sur le club du host.

## Task B1 : helpers de session par cookie

**Files:**
- Create: `frontend/lib/session.ts`
- Modify: `frontend/lib/useAuth.ts`

- [ ] **Step 1 — Créer `frontend/lib/session.ts`** :

```ts
const COOKIE_DOMAIN = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || 'localhost';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 jours, aligné sur l'expiry JWT

function writeCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; domain=${COOKIE_DOMAIN}; path=/; SameSite=Lax; max-age=${maxAge}`;
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Écrit la session partagée (token + club géré optionnel). */
export function setSession(token: string, clubId?: string | null) {
  writeCookie('token', token, MAX_AGE);
  if (clubId) writeCookie('clubId', clubId, MAX_AGE);
  else writeCookie('clubId', '', 0);
}

export function clearSession() {
  writeCookie('token', '', 0);
  writeCookie('clubId', '', 0);
}
```

- [ ] **Step 2 — Réécrire `frontend/lib/useAuth.ts`** pour lire/écrire le cookie :

```ts
'use client';
import { useState, useEffect } from 'react';
import { getCookie, clearSession } from '@/lib/session';

interface AuthState { token: string | null; clubId: string | null; ready: boolean; }

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ token: null, clubId: null, ready: false });
  useEffect(() => {
    setState({ token: getCookie('token'), clubId: getCookie('clubId'), ready: true });
  }, []);
  return state;
}

/** Déconnexion : efface la session partagée et renvoie vers /login. */
export function logout(): void {
  clearSession();
  window.location.assign('/login');
}
```

- [ ] **Step 3 — Vérifier** : `npx tsc --noEmit` propre.
- [ ] **Step 4 — Commit** : `git add frontend/lib/session.ts frontend/lib/useAuth.ts && git commit -m "feat(auth): session par cookie de domaine (partagée entre sous-domaines)"`

## Task B2 : écrire la session au login / register / création de club

**Files:**
- Modify: `frontend/app/login/page.tsx`
- Modify: `frontend/app/register/page.tsx`
- Modify: `frontend/app/clubs/new/page.tsx`

- [ ] **Step 1 — `login/page.tsx`** : remplacer le bloc `localStorage.setItem('token', …)` + résolution clubId par une logique sensible au host :

```tsx
import { setSession } from '@/lib/session';
import { useClub } from '@/lib/ClubProvider';
import { clubUrl } from '@/lib/clubUrl';
// dans le composant : const { slug } = useClub();
// dans handleSubmit, après avoir reçu data.token :
const memberships = await api.getMyClubs(data.token).catch(() => []);
if (slug) {
  const m = memberships.find((x) => x.slug === slug);
  setSession(data.token, m?.clubId ?? null);
  router.push(m ? '/admin' : '/');           // membre → back-office, sinon home club
} else {
  const managed = memberships[0];
  setSession(data.token, managed?.clubId ?? null);
  if (managed) window.location.assign(clubUrl(managed.slug, '/admin'));
  else router.push('/clubs');
}
```

- [ ] **Step 2 — `register/page.tsx`** : lire ce fichier, remplacer le stockage `localStorage` du token par `setSession(token, null)` et, après inscription, rediriger : sur host club → `router.push('/')` ; sur plateforme → `router.push('/clubs')`. Utiliser `useClub().slug` pour décider (mêmes imports que ci-dessus).

- [ ] **Step 3 — `clubs/new/page.tsx`** : remplacer `localStorage.setItem('token'…)/('clubId'…)` + `router.push('/admin')` par :

```tsx
import { setSession } from '@/lib/session';
import { clubUrl } from '@/lib/clubUrl';
// après création (token + club) :
setSession(token, club.id);
window.location.assign(clubUrl(club.slug, '/admin')); // bascule sur le sous-domaine du nouveau club
```

- [ ] **Step 4 — Vérifier** : `npx tsc --noEmit` propre. Manuel :
  - login sur `http://padel-arena-paris.localhost:3000/login` (owner@palova.fr / password123) → `/admin`.
  - ouvrir `http://localhost:3000/me/reservations`… (note : `localhost` n'a pas de club ; tester plutôt) ouvrir un **autre** sous-domaine, ex un 2e club créé, et vérifier que `getCookie('token')` est présent (DevTools → Application → Cookies → `localhost`).
- [ ] **Step 5 — Commit** : `git add frontend/app/login frontend/app/register frontend/app/clubs/new && git commit -m "feat(auth): écrire la session cookie + redirection sous-domaine au login/register/onboarding"`

## Task B3 : back-office scopé sur le club du host

Aujourd'hui `app/admin/layout.tsx` et les pages admin lisent `clubId` depuis la session. Sur un sous-domaine, le club actif = celui du host (déjà fetché par `ClubProvider`). On gate sur l'appartenance.

**Files:**
- Modify: `frontend/app/admin/layout.tsx`
- Modify: les 7 pages `frontend/app/admin/**/page.tsx` (changer la source du `clubId`)

- [ ] **Step 1 — `admin/layout.tsx`** : remplacer le gating `useAuth().clubId` par une résolution via `useClub()` + vérification d'appartenance :

```tsx
import { useClub } from '@/lib/ClubProvider';
import { api } from '@/lib/api';
// dans le composant :
const { token, ready } = useAuth();
const { club } = useClub();
const [allowed, setAllowed] = useState<boolean | null>(null);
useEffect(() => {
  if (!ready) return;
  if (!token) { router.replace('/login'); return; }
  if (!club) return; // attend le fetch du club (host)
  api.getMyClubs(token)
    .then((cs) => setAllowed(cs.some((c) => c.clubId === club.id)))
    .catch(() => setAllowed(false));
}, [ready, token, club, router]);
useEffect(() => { if (allowed === false) router.replace('/'); }, [allowed, router]);

if (!ready || !token || !club || allowed !== true) {
  return (/* même écran "Chargement…" qu'aujourd'hui */);
}
```
Ajouter les entrées de nav Annonces/Sponsors à `links` (voir Lot C, Task C7).

- [ ] **Step 2 — Pages admin** : dans chacune des 7 pages (`admin/page.tsx`, `admin/planning`, `admin/courts`, `admin/sports`, `admin/reservations`, `admin/subscribers`, `admin/settings`), remplacer la lecture du club :
  - retirer `const { token, clubId } = useAuth();` → garder `const { token } = useAuth();`
  - ajouter `const { club } = useClub();` puis utiliser `const clubId = club?.id;`
  - garder les gardes existantes `if (!token || !clubId) return …` inchangées dans leur logique.
  (Repérer les usages avec `grep -rn "clubId" frontend/app/admin`.)

- [ ] **Step 3 — Vérifier** : `npx tsc --noEmit` propre ; `npx jest`. Manuel : sur `padel-arena-paris.localhost:3000/admin`, le back-office charge les ressources/réservations du bon club ; un compte non-membre est renvoyé vers `/`.
- [ ] **Step 4 — Commit** : `git add frontend/app/admin && git commit -m "feat(admin): back-office scopé sur le club du host"`

**Vérif de fin de Lot B :** login sur un sous-domaine club → en ouvrant un autre sous-domaine club, l'utilisateur est toujours connecté (cookie partagé). `tsc`+`jest` front propres.

> ⚠️ **Risque cookie `domain=localhost`** : valider en début de Lot B que le cookie est bien partagé (`document.cookie` visible sur deux `*.localhost`). Si un navigateur refuse `domain=localhost`, repli : ne pas fixer `domain` (cookie host-only) → session par sous-domaine (re-login par club) ; en informer l'utilisateur avant de continuer.

---

# LOT C — Home club + modèles Annonces/Sponsors

But : la home `/` du sous-domaine affiche notifications joueur, annonces et sponsors gérés par le club, et un hub de liens.

## Task C1 : modèles Prisma + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1 — Ajouter les relations inverses** au modèle `Club` (dans le bloc `model Club { … }`, près de `subscribers ClubSubscriber[]`) :
```prisma
  announcements Announcement[]
  sponsors      Sponsor[]
```

- [ ] **Step 2 — Ajouter les deux modèles** en fin de fichier :
```prisma
/// Annonce publiée par un club sur sa page d'accueil.
model Announcement {
  id          String   @id @default(cuid())
  clubId      String   @map("club_id")
  title       String
  body        String
  linkUrl     String?  @map("link_url")
  imageUrl    String?  @map("image_url")
  isPublished Boolean  @default(true) @map("is_published")
  pinned      Boolean  @default(false)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)

  @@index([clubId])
  @@map("announcements")
}

/// Sponsor/partenaire affiché sur la page d'accueil d'un club.
model Sponsor {
  id        String   @id @default(cuid())
  clubId    String   @map("club_id")
  name      String
  logoUrl   String   @map("logo_url")
  linkUrl   String?  @map("link_url")
  sortOrder Int      @default(0) @map("sort_order")
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)

  @@index([clubId])
  @@map("sponsors")
}
```

- [ ] **Step 3 — Migrer (additif, pas de reset)** : docker up, puis `cd backend && npx prisma migrate dev --name add_announcements_sponsors` puis `npx prisma generate`.
- [ ] **Step 4 — Vérifier** : `npx tsc --noEmit` propre (le client Prisma régénéré expose `prisma.announcement` / `prisma.sponsor`). Une 5e migration apparaît dans `prisma/migrations/`.
- [ ] **Step 5 — Commit** : `git add backend/prisma && git commit -m "feat(db): modèles Announcement + Sponsor (migration additive)"`

## Task C2 : services + tests (announcement, sponsor)

**Files:**
- Create: `backend/src/services/announcement.service.ts`
- Create: `backend/src/services/sponsor.service.ts`
- Test: `backend/src/services/__tests__/announcement.service.test.ts`

- [ ] **Step 1 — Écrire le test d'abord** `backend/src/services/__tests__/announcement.service.test.ts` (calqué sur `resource.service.test.ts` + mock `__mocks__/prisma`) :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { AnnouncementService } from '../announcement.service';

describe('AnnouncementService', () => {
  let service: AnnouncementService;
  beforeEach(() => { service = new AnnouncementService(); });

  it('listPublic rejette CLUB_NOT_FOUND si club inconnu/inactif', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.listPublic('inconnu')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('listPublic ne renvoie que les annonces publiées, épinglées d abord', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.announcement.findMany.mockResolvedValue([{ id: 'a1' }] as any);
    await service.listPublic('padel-arena-paris');
    expect(prismaMock.announcement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId: 'club-demo', isPublished: true },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    }));
  });

  it('update rejette ANNOUNCEMENT_NOT_FOUND si l annonce est d un autre club', async () => {
    prismaMock.announcement.findUnique.mockResolvedValue({ id: 'a1', clubId: 'autre' } as any);
    await expect(service.update('a1', 'club-demo', { title: 'x' })).rejects.toThrow('ANNOUNCEMENT_NOT_FOUND');
    expect(prismaMock.announcement.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 — Lancer le test, vérifier l'échec** : `cd backend && npx jest announcement` → échoue (`Cannot find module '../announcement.service'`).

- [ ] **Step 3 — Écrire `backend/src/services/announcement.service.ts`** :

```ts
import { prisma } from '../db/prisma';

interface AnnouncementInput { title?: string; body?: string; linkUrl?: string | null; imageUrl?: string | null; isPublished?: boolean; pinned?: boolean; }

export class AnnouncementService {
  async listPublic(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return prisma.announcement.findMany({
      where: { clubId: club.id, isPublished: true },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async listAdmin(clubId: string) {
    return prisma.announcement.findMany({ where: { clubId }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }] });
  }

  async create(clubId: string, data: AnnouncementInput) {
    const title = (data.title ?? '').trim();
    const body = (data.body ?? '').trim();
    if (!title || !body) throw new Error('VALIDATION_ERROR');
    return prisma.announcement.create({
      data: {
        clubId, title, body,
        linkUrl: data.linkUrl?.trim() || null,
        imageUrl: data.imageUrl?.trim() || null,
        isPublished: data.isPublished ?? true,
        pinned: data.pinned ?? false,
      },
    });
  }

  async update(id: string, clubId: string, data: AnnouncementInput) {
    const found = await prisma.announcement.findUnique({ where: { id }, select: { clubId: true } });
    if (!found || found.clubId !== clubId) throw new Error('ANNOUNCEMENT_NOT_FOUND');
    return prisma.announcement.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.body !== undefined ? { body: data.body.trim() } : {}),
        ...(data.linkUrl !== undefined ? { linkUrl: data.linkUrl?.trim() || null } : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl?.trim() || null } : {}),
        ...(data.isPublished !== undefined ? { isPublished: data.isPublished } : {}),
        ...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
      },
    });
  }

  async remove(id: string, clubId: string) {
    await prisma.announcement.deleteMany({ where: { id, clubId } });
  }
}
```

- [ ] **Step 4 — Écrire `backend/src/services/sponsor.service.ts`** (même structure ; champs `name` (requis), `logoUrl` (requis), `linkUrl?`, `sortOrder?`, `isActive?`) :

```ts
import { prisma } from '../db/prisma';

interface SponsorInput { name?: string; logoUrl?: string; linkUrl?: string | null; sortOrder?: number; isActive?: boolean; }

export class SponsorService {
  async listPublic(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return prisma.sponsor.findMany({ where: { clubId: club.id, isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  async listAdmin(clubId: string) {
    return prisma.sponsor.findMany({ where: { clubId }, orderBy: { sortOrder: 'asc' } });
  }

  async create(clubId: string, data: SponsorInput) {
    const name = (data.name ?? '').trim();
    const logoUrl = (data.logoUrl ?? '').trim();
    if (!name || !logoUrl) throw new Error('VALIDATION_ERROR');
    return prisma.sponsor.create({
      data: {
        clubId, name, logoUrl,
        linkUrl: data.linkUrl?.trim() || null,
        sortOrder: Number.isInteger(data.sortOrder) ? data.sortOrder! : 0,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(id: string, clubId: string, data: SponsorInput) {
    const found = await prisma.sponsor.findUnique({ where: { id }, select: { clubId: true } });
    if (!found || found.clubId !== clubId) throw new Error('SPONSOR_NOT_FOUND');
    return prisma.sponsor.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl.trim() } : {}),
        ...(data.linkUrl !== undefined ? { linkUrl: data.linkUrl?.trim() || null } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: Number(data.sortOrder) } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
  }

  async remove(id: string, clubId: string) {
    await prisma.sponsor.deleteMany({ where: { id, clubId } });
  }
}
```

- [ ] **Step 5 — Lancer les tests** : `npx jest announcement` → PASS. `npx tsc --noEmit` propre.
- [ ] **Step 6 — Commit** : `git add backend/src/services && git commit -m "feat(api): services Announcement + Sponsor (+ tests)"`

## Task C3 : endpoints publics + back-office

**Files:**
- Modify: `backend/src/routes/clubs.ts` (2 routes publiques, AVANT `GET /:slug`)
- Modify: `backend/src/routes/admin.ts` (8 routes back-office + codes d'erreur)

- [ ] **Step 1 — `clubs.ts`** : importer les services et ajouter, **avant** le handler `GET /:slug` (l. ~70), à la suite de `/:slug/availability` :

```ts
import { AnnouncementService } from '../services/announcement.service';
import { SponsorService } from '../services/sponsor.service';
const announcementService = new AnnouncementService();
const sponsorService = new SponsorService();

router.get('/:slug/announcements', async (req, res, next) => {
  try { res.json(await announcementService.listPublic(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});
router.get('/:slug/sponsors', async (req, res, next) => {
  try { res.json(await sponsorService.listPublic(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 2 — `admin.ts`** : ajouter aux imports/instances et à `ERROR_STATUS` :
```ts
import { AnnouncementService } from '../services/announcement.service';
import { SponsorService } from '../services/sponsor.service';
const announcementService = new AnnouncementService();
const sponsorService = new SponsorService();
// dans ERROR_STATUS :
ANNOUNCEMENT_NOT_FOUND: 404,
SPONSOR_NOT_FOUND:      404,
```
puis les routes (toutes déjà derrière `authMiddleware, requireClubMember('STAFF')`), avant `export default router;` :
```ts
// --- Annonces ---
router.get('/announcements', async (req: ClubScopedRequest, res, next) => {
  try { res.json(await announcementService.listAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/announcements', async (req: ClubScopedRequest, res, next) => {
  try { res.status(201).json(await announcementService.create(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.patch('/announcements/:id', async (req: ClubScopedRequest, res, next) => {
  try { res.json(await announcementService.update(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/announcements/:id', async (req: ClubScopedRequest, res, next) => {
  try { await announcementService.remove(asString(req.params.id), req.membership!.clubId); res.json({ ok: true }); } catch (e) { handleError(e, res, next); }
});
// --- Sponsors --- (mêmes 4 routes, /sponsors, via sponsorService)
```
Ajouter les 4 routes `/sponsors` sur le même modèle (get/post/patch/:id/delete/:id).

- [ ] **Step 3 — Vérifier** : `npx tsc --noEmit` propre. Docker + backend lancés, token obtenu via login owner :
  - `curl "http://localhost:3001/api/clubs/padel-arena-paris/announcements"` → `[]` (avant seed) ou liste.
  - `curl -X POST "http://localhost:3001/api/clubs/club-demo/admin/announcements" -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"title":"Tournoi","body":"Samedi 10h"}'` → 201.
- [ ] **Step 4 — Commit** : `git add backend/src/routes && git commit -m "feat(api): endpoints publics + back-office Annonces/Sponsors"`

## Task C4 : couche API frontend

**Files:**
- Modify: `frontend/lib/api.ts` (types + méthodes)

- [ ] **Step 1 — Ajouter les types** (section Types) :
```ts
export interface Announcement {
  id: string; title: string; body: string;
  linkUrl: string | null; imageUrl: string | null;
  isPublished: boolean; pinned: boolean; createdAt: string; updatedAt: string;
}
export interface Sponsor {
  id: string; name: string; logoUrl: string;
  linkUrl: string | null; sortOrder: number; isActive: boolean; createdAt: string;
}
export type AnnouncementBody = Partial<{ title: string; body: string; linkUrl: string; imageUrl: string; isPublished: boolean; pinned: boolean; }>;
export type SponsorBody = Partial<{ name: string; logoUrl: string; linkUrl: string; sortOrder: number; isActive: boolean; }>;
```

- [ ] **Step 2 — Ajouter les méthodes** dans l'objet `api` :
```ts
getClubAnnouncements: (slug: string) => request<Announcement[]>(`/api/clubs/${slug}/announcements`),
getClubSponsors: (slug: string) => request<Sponsor[]>(`/api/clubs/${slug}/sponsors`),

adminGetAnnouncements: (clubId: string, token: string) => request<Announcement[]>(`/api/clubs/${clubId}/admin/announcements`, {}, token),
adminCreateAnnouncement: (clubId: string, body: AnnouncementBody, token: string) => request<Announcement>(`/api/clubs/${clubId}/admin/announcements`, { method: 'POST', body: JSON.stringify(body) }, token),
adminUpdateAnnouncement: (clubId: string, id: string, body: AnnouncementBody, token: string) => request<Announcement>(`/api/clubs/${clubId}/admin/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
adminDeleteAnnouncement: (clubId: string, id: string, token: string) => request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/announcements/${id}`, { method: 'DELETE' }, token),

adminGetSponsors: (clubId: string, token: string) => request<Sponsor[]>(`/api/clubs/${clubId}/admin/sponsors`, {}, token),
adminCreateSponsor: (clubId: string, body: SponsorBody, token: string) => request<Sponsor>(`/api/clubs/${clubId}/admin/sponsors`, { method: 'POST', body: JSON.stringify(body) }, token),
adminUpdateSponsor: (clubId: string, id: string, body: SponsorBody, token: string) => request<Sponsor>(`/api/clubs/${clubId}/admin/sponsors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
adminDeleteSponsor: (clubId: string, id: string, token: string) => request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/sponsors/${id}`, { method: 'DELETE' }, token),
```

- [ ] **Step 3 — Vérifier** : `cd frontend && npx tsc --noEmit` propre.
- [ ] **Step 4 — Commit** : `git add frontend/lib/api.ts && git commit -m "feat(api-client): méthodes Annonces/Sponsors"`

## Task C5 : composant `ClubHome` (remplace le stub)

**Files:**
- Modify: `frontend/components/ClubHome.tsx`

- [ ] **Step 1 — Remplacer le stub** par la home complète (4 sections + hub). Réutilise `Screen`, `Logotype`, `ThemeToggle`, `MyBookingsButton`, `LogoutButton`, `Btn`, `Chip`, `Icon` :

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ClubDetail, Announcement, Sponsor, MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle, MyBookingsButton, LogoutButton, Btn, Chip } from '@/components/ui/atoms';
import { Icon, IconName } from '@/components/ui/Icon';

function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export default function ClubHome({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const router = useRouter();
  const { token, ready } = useAuth();
  const [ann, setAnn] = useState<Announcement[]>([]);
  const [spons, setSpons] = useState<Sponsor[]>([]);
  const [next, setNext] = useState<MyReservation[]>([]);
  const [isSub, setIsSub] = useState(false);

  useEffect(() => { api.getClubAnnouncements(club.slug).then(setAnn).catch(() => setAnn([])); }, [club.slug]);
  useEffect(() => { api.getClubSponsors(club.slug).then(setSpons).catch(() => setSpons([])); }, [club.slug]);
  useEffect(() => {
    if (!ready || !token) return;
    api.getMyReservations(token)
      .then((rs) => setNext(rs.filter((r) => r.resource.club.slug === club.slug && r.status !== 'CANCELLED' && new Date(r.startTime) > new Date()).slice(0, 3)))
      .catch(() => {});
    api.getMySubscriptions(token).then((ids) => setIsSub(ids.includes(club.id))).catch(() => {});
  }, [ready, token, club.slug, club.id]);

  const sectionTitle = (t: string) => (
    <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>{t}</div>
  );

  const links: { label: string; icon: IconName; href: string; show: boolean }[] = [
    { label: 'Réserver', icon: 'arrowR', href: '/reserver', show: true },
    { label: 'Terrains', icon: 'indoor', href: '/reserver?tab=courts', show: true },
    { label: 'Mes réservations', icon: 'ticket', href: '/me/reservations', show: !!token },
    { label: 'Connexion', icon: 'user', href: '/login', show: ready && !token },
    { label: 'Créer un compte', icon: 'user', href: '/register', show: ready && !token },
  ];

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        {/* En-tête */}
        <div style={{ padding: '24px 20px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Logotype size={22} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isSub && <Chip tone="accent" icon="check">Abonné</Chip>}
            <MyBookingsButton /><ThemeToggle /><LogoutButton />
          </div>
        </div>

        {/* Identité club */}
        <div style={{ padding: '14px 20px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
          {club.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={club.logoUrl} alt={club.name} style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover' }} />
            : <div style={{ width: 56, height: 56, borderRadius: 14, background: th.accent, color: th.onAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26 }}>{club.name.slice(0, 1)}</div>}
          <div>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, lineHeight: 1.02, color: th.text, letterSpacing: -0.5 }}>{club.name}</div>
            {club.city && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 4 }}><Icon name="pin" size={13} color={th.textMute} />{club.city}</div>}
          </div>
        </div>

        {/* CTA principal */}
        <div style={{ padding: '20px 20px 0' }}>
          <Btn full icon="arrowR" onClick={() => router.push('/reserver')}>Réserver un créneau</Btn>
        </div>

        {/* Notifications (joueur connecté) */}
        {next.length > 0 && (
          <div style={{ padding: '26px 20px 0' }}>
            {sectionTitle('Vos prochaines réservations')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {next.map((r) => (
                <div key={r.id} style={{ background: th.surface, borderRadius: 14, padding: '12px 14px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon name="ticket" size={18} color={th.accent} />
                  <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{r.resource.name} · {formatDateTime(r.startTime, r.resource.club.timezone)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Annonces */}
        {ann.length > 0 && (
          <div style={{ padding: '26px 20px 0' }}>
            {sectionTitle('Annonces')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ann.map((a) => (
                <div key={a.id} style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {a.pinned && <Chip tone="accent">Épinglé</Chip>}
                    <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text }}>{a.title}</span>
                  </div>
                  <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.body}</p>
                  {a.linkUrl && <a href={a.linkUrl} target="_blank" rel="noreferrer" style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.accent }}>En savoir plus →</a>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hub de liens */}
        <div style={{ padding: '26px 20px 0' }}>
          {sectionTitle('Accès rapide')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {links.filter((l) => l.show).map((l) => (
              <button key={l.label} onClick={() => router.push(l.href)} style={{ border: 'none', cursor: 'pointer', textAlign: 'left', background: th.surface2, borderRadius: 16, padding: '16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name={l.icon} size={18} color={th.text} />
                <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5, color: th.text }}>{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sponsors */}
        {spons.length > 0 && (
          <div style={{ padding: '26px 20px 0' }}>
            {sectionTitle('Partenaires')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {spons.map((s) => (
                <a key={s.id} href={s.linkUrl ?? '#'} target={s.linkUrl ? '_blank' : undefined} rel="noreferrer" title={s.name} style={{ display: 'block' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.logoUrl} alt={s.name} style={{ height: 44, width: 'auto', borderRadius: 8, background: th.surface, padding: 6, objectFit: 'contain' }} />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
```
> Vérifier que les noms d'icônes (`arrowR`, `indoor`, `ticket`, `user`, `pin`, `check`) existent dans `components/ui/Icon.tsx` (`IconName`) ; sinon, choisir un nom valide équivalent.

- [ ] **Step 2 — Vérifier** : `npx tsc --noEmit` propre ; `http://padel-arena-paris.localhost:3000` affiche l'en-tête, le CTA, le hub (annonces/sponsors/notifs apparaissent après le seed C8).
- [ ] **Step 3 — Commit** : `git add frontend/components/ClubHome.tsx && git commit -m "feat(club): page d'accueil club (notifs, annonces, sponsors, hub)"`

## Task C6 : back-office Annonces

**Files:**
- Create: `frontend/app/admin/announcements/page.tsx`

- [ ] **Step 1 — Créer la page** (liste + formulaire créer/éditer + supprimer), calquée sur le style d'une page admin existante (`app/admin/subscribers/page.tsx` comme référence de structure : `useAuth` token + `useClub` clubId, états, fetch, formulaire thémé). Champs : `title`, `body` (textarea), `linkUrl`, `imageUrl`, cases `pinned` et `isPublished`. Actions : `api.adminGetAnnouncements`, `adminCreateAnnouncement`, `adminUpdateAnnouncement`, `adminDeleteAnnouncement`. Récupérer `clubId` via `const { club } = useClub(); const clubId = club?.id;` et `token` via `useAuth()`.
- [ ] **Step 2 — Vérifier** : `npx tsc --noEmit` propre ; sur `…/admin/announcements`, créer une annonce → elle apparaît dans la liste et sur la home `/`.
- [ ] **Step 3 — Commit** : `git add frontend/app/admin/announcements && git commit -m "feat(admin): gestion des annonces"`

## Task C7 : back-office Sponsors + nav admin

**Files:**
- Create: `frontend/app/admin/sponsors/page.tsx`
- Modify: `frontend/app/admin/layout.tsx` (tableau `links`)

- [ ] **Step 1 — Créer la page Sponsors** sur le **même patron** que C6 (champs : `name`, `logoUrl`, `linkUrl`, `sortOrder` (number), `isActive`), via `api.adminGetSponsors`/`adminCreateSponsor`/`adminUpdateSponsor`/`adminDeleteSponsor`.
- [ ] **Step 2 — Ajouter les entrées de nav** dans `app/admin/layout.tsx`, tableau `links` (après `Réglages` ou avant) :
```ts
{ href: '/admin/announcements', label: 'Annonces',  icon: 'bolt' as const },
{ href: '/admin/sponsors',      label: 'Partenaires', icon: 'users' as const },
```
(choisir des `IconName` existants ; ajuster si besoin.)
- [ ] **Step 3 — Vérifier** : `npx tsc --noEmit` propre ; nav admin affiche Annonces + Partenaires ; CRUD sponsors reflété sur la home.
- [ ] **Step 4 — Commit** : `git add frontend/app/admin && git commit -m "feat(admin): gestion des sponsors + nav"`

## Task C8 : seed de démo (annonces + sponsors)

**Files:**
- Modify: `backend/prisma/seed.ts`

- [ ] **Step 1 — Ajouter, après la création des ressources** (avant la section comptes), un seed idempotent (supprime puis recrée pour `club-demo` afin de rester idempotent sans clé naturelle) :
```ts
  // 4b. Annonces & sponsors de démo (idempotent : on repart de zéro pour le club démo)
  await prisma.announcement.deleteMany({ where: { clubId: club.id } });
  await prisma.announcement.createMany({ data: [
    { clubId: club.id, title: 'Tournoi interne samedi', body: 'Inscriptions ouvertes au club-house. Niveau loisir, lots à gagner !', pinned: true },
    { clubId: club.id, title: 'Nouveaux créneaux le matin', body: 'Le club ouvre désormais dès 8h en semaine.' },
  ] });
  await prisma.sponsor.deleteMany({ where: { clubId: club.id } });
  await prisma.sponsor.createMany({ data: [
    { clubId: club.id, name: 'Babolat', logoUrl: 'https://dummyimage.com/120x44/111/fff&text=Babolat', sortOrder: 1 },
    { clubId: club.id, name: 'Decathlon', logoUrl: 'https://dummyimage.com/120x44/111/fff&text=Decathlon', sortOrder: 2 },
  ] });
```
- [ ] **Step 2 — Exécuter** (docker up) : `cd backend && npm run db:seed` → « Seed terminé. » sans erreur.
- [ ] **Step 3 — Vérifier** : `http://padel-arena-paris.localhost:3000` affiche les 2 annonces (épinglée d'abord) et les 2 logos sponsors.
- [ ] **Step 4 — Commit** : `git add backend/prisma/seed.ts && git commit -m "feat(seed): annonces + sponsors de démo"`

**Vérif de fin de Lot C :** `tsc`+`jest` back & front propres ; home club complète et alimentée ; CRUD annonces/sponsors opérationnel.

---

# LOT D — Pop-ups vers le haut (top-sheet)

But : `BookingModal` et `ConfirmDialog` s'ancrent en haut de l'écran. Indépendant des autres lots. Les tests existants (labels/rôles) ne doivent pas casser.

## Task D1 : keyframe d'entrée par le haut

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1 — Ajouter** après `@keyframes sp-sheet-in …` :
```css
@keyframes sp-sheet-in-top { from { transform: translateY(-100%); } to { transform: translateY(0); } }
```
- [ ] **Step 2 — Commit** : `git add frontend/app/globals.css && git commit -m "feat(ui): keyframe sp-sheet-in-top"`

## Task D2 : `BookingModal` en top-sheet

**Files:**
- Modify: `frontend/components/BookingModal.tsx`

- [ ] **Step 1 — Conteneur fixe** (l. ~105) : remplacer `justifyContent: 'flex-end'` par `justifyContent: 'flex-start'`.
- [ ] **Step 2 — Feuille** (l. ~107) : remplacer `borderRadius: '28px 28px 0 0'` → `borderRadius: '0 0 28px 28px'`, `boxShadow: '0 -10px 40px rgba(0,0,0,0.3)'` → `boxShadow: '0 10px 40px rgba(0,0,0,0.3)'`, `animation: 'sp-sheet-in …'` → `animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)'`.
- [ ] **Step 3 — Poignée** (l. ~108) : déplacer la barre de glissement sous le contenu — soit changer sa marge `margin: '0 auto 18px'` → `margin: '18px auto 0'` et la rendre cohérente visuellement (en top-sheet, la poignée en bas), soit la retirer. Choix recommandé : la déplacer en bas (placer le `<div … />` juste avant la fermeture de la feuille, après les blocs `phase`).
- [ ] **Step 4 — Vérifier** : `npx tsc --noEmit` propre ; `npx jest BookingModal` → PASS (labels intacts). Manuel : le pop-up s'ouvre depuis le haut.
- [ ] **Step 5 — Commit** : `git add frontend/components/BookingModal.tsx && git commit -m "feat(ui): BookingModal en top-sheet"`

## Task D3 : `ConfirmDialog` en top-sheet

**Files:**
- Modify: `frontend/components/ui/ConfirmDialog.tsx`

- [ ] **Step 1 — Mêmes 3 changements** qu'en D2 (l. ~30 conteneur `flex-start` ; l. ~32 `borderRadius: '0 0 28px 28px'`, `boxShadow: '0 10px 40px rgba(0,0,0,0.3)'`, `animation: 'sp-sheet-in-top …'` ; l. ~33 poignée déplacée en bas ou retirée).
- [ ] **Step 2 — Vérifier** : `npx tsc --noEmit` propre ; `npx jest ConfirmDialog` → PASS. Manuel : la confirmation d'annulation s'affiche en haut.
- [ ] **Step 3 — Commit** : `git add frontend/components/ui/ConfirmDialog.tsx && git commit -m "feat(ui): ConfirmDialog en top-sheet"`

**Vérif de fin de Lot D :** `npx jest` front complet vert ; les deux pop-ups s'ouvrent par le haut.

---

# Vérification end-to-end (après tous les lots)

1. Docker up, backend (`npm run dev`), frontend (`npm run dev`).
2. **Plateforme** : `http://localhost:3000` → landing ; `/clubs` → annuaire ; clic carte → `http://padel-arena-paris.localhost:3000/`.
3. **Home club** : annonces (épinglée d'abord) + sponsors + hub + CTA ; logo → `/`.
4. **Réservation** : `/reserver` brandé ; cycle hold→confirm OK ; pop-up en haut ; `/reserver?tab=courts` ouvre l'onglet Terrains.
5. **Session partagée** : login owner sur le sous-domaine → cookie `token` visible sur `localhost` (DevTools) ; rester connecté en changeant de sous-domaine.
6. **Back-office** : `…/admin` scopé au club du host ; CRUD annonces/sponsors reflété sur la home ; non-membre renvoyé vers `/`.
7. **Rétro-compat** : `http://localhost:3000/c/padel-arena-paris` redirige vers le sous-domaine.
8. **Tests** : `cd backend && npx tsc --noEmit && npx jest` (≥ 31 tests) ; `cd frontend && npx tsc --noEmit && npx jest` (≥ 11 tests).

---

# Self-review (couverture spec)

- **§3 routing (proxy, faces)** → A1 (proxy), A4 (faces), A3 (annuaire→sous-domaine). ✔
- **§4 branding remonté** → A2 (ClubProvider/layout), A4 (retrait ThemeProvider de `/reserver`), `/courts/[id]` : son `ThemeProvider` interne devient redondant — *à nettoyer en option lors de A4 (laisser fonctionnel ; le double-wrap ne casse rien)*. ✔ (note ci-dessous)
- **§5 home club** → C5 (ClubHome), A4 (/reserver, route + tab param). ✔
- **§6 modèles + back-office** → C1 (schema/migration), C2 (services+tests), C3 (endpoints), C4 (api client), C6/C7 (admin), C8 (seed). ✔
- **§7 session partagée** → B1/B2 (cookie), B3 (admin scopé host). ✔
- **§8 pop-ups** → D1/D2/D3. ✔
- **§9 navigation/indépendance** → A3 (cartes), A5 (logo), A4 (retrait retour-annuaire), A1 (redirect /c + blocage /clubs sur host club). ✔
- **Risque cookie `domain=localhost`** → encadré en fin de Lot B. ✔

**Note `/courts/[id]`** : il garde aujourd'hui un `ThemeProvider` interne (accent de la ressource). Sur un host club, le layout brande déjà → ce wrap est redondant mais inoffensif. Optionnel (cohérence) : en A4, retirer le `ThemeProvider` interne de `frontend/app/courts/[id]/page.tsx` et garder seulement `CourtBooking`. Non bloquant.

**Incohérences de types vérifiées** : `clubId` admin = `useClub().club?.id` (B3) cohérent avec les signatures `api.adminXxx(clubId, …)` existantes ; `MyReservation.resource.club.slug/timezone` (api.ts) utilisé en C5 ; `ClubDetail.accentColor/defaultThemeMode/slug/logoUrl/city` utilisés en A2/C5 — tous présents dans les types actuels.
