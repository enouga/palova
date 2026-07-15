# Pages /me en pleine largeur 1080 + shell standard Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirer les clamps internes de `/me/profile` (760) et `/me/friends` (900) — décision d'Eric : tout en pleine largeur 1080 — et donner aux deux pages Notifications (`/me/notifications` + `/settings`) le shell standard (`Screen` + ClubNav/en-tête plateforme + titre display 38) qu'elles n'ont jamais eu.

**Architecture:** 100 % frontend, zéro backend/migration. Les deux premiers changements sont des retraits de wrappers neutres ; les deux pages Notifications sont réécrites autour de leur logique existante (inchangée) sur le modèle exact de `/me/profile` (double branche d'en-tête) et `/me/messages` (structure titre + contenu).

**Tech Stack:** Next.js 16 (Turbopack), React inline styles + `useTheme()`, Jest/RTL. ⚠️ Shims `.bin` cassés : `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc`, jamais `npx`.

**Spec:** `docs/superpowers/specs/2026-07-15-pages-me-pleine-largeur-design.md`

**⚠️ Arbre de travail partagé :** du WIP non lié existe (backend `notification/{dispatcher,push}*`, `frontend/public/sw.js`). À chaque commit : vérifier `git branch --show-current` (= `feat/alertes-parties-ouvertes`), ne JAMAIS `git add -A`, committer en forme pathspec : `git commit -m "…" -- <fichiers>`.

---

### Task 1: Retirer les clamps de Mon profil et Mes amis

**Files:**
- Modify: `frontend/app/me/profile/page.tsx` (~lignes 331-332 et 621)
- Modify: `frontend/app/me/friends/page.tsx` (réécriture du `return`, fichier de 44 lignes)
- Tests (non-régression) : `frontend/__tests__/MeProfile.test.tsx`, `FriendsHub.test.tsx`, `FriendsHubSections.test.tsx`

- [ ] **Step 1: Profil — retirer l'ouverture du wrapper**

Dans `frontend/app/me/profile/page.tsx`, supprimer ces deux lignes (juste après la double branche d'en-tête, avant le titre « Mon profil ») :

```tsx
        {/* Clamp desktop : le shell fait 1080, le formulaire reste lisible à 760 centré. */}
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
```

- [ ] **Step 2: Profil — retirer la fermeture**

En fin de fichier (~ligne 621), remplacer :

```tsx
        </div>{/* /clamp 760 */}
      </div>
    </Screen>
```

par :

```tsx
      </div>
    </Screen>
```

- [ ] **Step 3: Amis — retirer le wrapper**

Remplacer le `return` de `frontend/app/me/friends/page.tsx` :

```tsx
  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        <ClubNav club={club} />

        {/* Clamp desktop : listes denses (suggestions, recherche) lisent mal étirées sur 1040px. */}
        <div style={{ maxWidth: 900, margin: '0 auto' }}>

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Mes amis
        </div>

        <div style={{ padding: '18px 20px 0' }}>
          <FriendsHub slug={slug} token={token} timezone={club.timezone ?? 'Europe/Paris'} anchor={anchor} />
        </div>

        </div>
      </div>
    </Screen>
  );
```

par :

```tsx
  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        <ClubNav club={club} />

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Mes amis
        </div>

        <div style={{ padding: '18px 20px 0' }}>
          <FriendsHub slug={slug} token={token} timezone={club.timezone ?? 'Europe/Paris'} anchor={anchor} />
        </div>
      </div>
    </Screen>
  );
```

- [ ] **Step 4: Lancer les suites de non-régression**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js MeProfile.test.tsx FriendsHub.test.tsx FriendsHubSections.test.tsx
```
Expected: PASS (les wrappers retirés étaient des div neutres, aucune assertion ne les cible).

- [ ] **Step 5: Commit (pathspec, garde de branche)**

```bash
git branch --show-current   # doit afficher feat/alertes-parties-ouvertes
git add frontend/app/me/profile/page.tsx frontend/app/me/friends/page.tsx
git commit -m "polish(me): profil et amis en pleine largeur 1080 (retrait des clamps)" -- frontend/app/me/profile/page.tsx frontend/app/me/friends/page.tsx
```

---

### Task 2: Page Notifications — shell standard

**Files:**
- Modify: `frontend/app/me/notifications/page.tsx` (réécriture complète, la logique ne change pas)

Pas de suite Jest existante pour cette page (changement de coquille pur — pas de nouveau test exigé par la spec).

- [ ] **Step 1: Réécrire la page**

Remplacer intégralement `frontend/app/me/notifications/page.tsx` par :

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, AppNotification } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { BackButton, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { Icon } from '@/components/ui/Icon';
import { NotificationRow } from '@/components/notifications/NotificationRow';

// Liste des notifications (ouverte depuis la cloche). Shell standard des pages /me :
// Screen + ClubNav sur hôte club / en-tête plateforme sinon (pattern /me/profile).
export default function NotificationsPage() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const { slug, club } = useClub();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState<Date | null>(null); // horloge unique posée au mount (hydration-safe)

  useEffect(() => { setNow(new Date()); }, []);

  const load = (c?: string) => {
    if (!token) return;
    setLoading(true);
    api.getNotifications(token, c).then((p) => {
      setItems((prev) => (c ? [...prev, ...p.items] : p.items));
      setCursor(p.nextCursor);
      if (!p.nextCursor) setDone(true);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { if (token) load(); /* eslint-disable-next-line */ }, [token]);

  if (ready && !token) { if (typeof window !== 'undefined') router.push('/login'); return null; }

  const openItem = (n: AppNotification) => {
    if (!n.readAt && token) api.markNotificationRead(n.id, token).catch(() => {});
    if (n.url) router.push(n.url);
  };

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        {slug && club ? (
          <ClubNav club={club} />
        ) : (
          <div style={{ padding: '28px 20px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <BackButton href="/clubs" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ThemeToggle />
                <ProfileMenu />
              </div>
            </div>
          </div>
        )}

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Notifications
        </div>

        <div style={{ padding: '18px 20px 0' }}>
          {items.length === 0 && !loading && (
            <div style={{ padding: '56px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <span aria-hidden="true" style={{ width: 60, height: 60, borderRadius: '50%', background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bell" size={28} color={th.textFaint} />
              </span>
              <span style={{ color: th.textMute, fontFamily: th.fontUI, fontSize: 15, fontWeight: 600 }}>Aucune notification</span>
              <span style={{ color: th.textFaint, fontFamily: th.fontUI, fontSize: 13.5 }}>Vous êtes à jour.</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((n) => (
              <NotificationRow key={n.id} n={n} now={now} variant="page" onClick={() => openItem(n)} />
            ))}
          </div>
          {!done && items.length > 0 && (
            <button onClick={() => cursor && load(cursor)} disabled={loading} style={{
              marginTop: 16, width: '100%', padding: '10px 0', borderRadius: 10, border: `1px solid ${th.line}`,
              background: th.surface, color: th.text, cursor: 'pointer', fontFamily: th.fontUI, fontWeight: 600,
            }}>{loading ? 'Chargement…' : 'Charger plus'}</button>
          )}
        </div>
      </div>
    </Screen>
  );
}
```

(Diff réel vs l'ancien fichier : imports `useClub`/`Screen`/`ClubNav`/`BackButton`/`ThemeToggle`/`ProfileMenu` ajoutés, conteneur `maxWidth: 640` remplacé par le shell Screen + en-tête + titre display + contenu `18px 20px 0`. La logique chargement/pagination/marquage lu est copiée à l'identique.)

- [ ] **Step 2: Type-check scopé**

Run (depuis `frontend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "me/notifications" ; echo "grep exit=$? (1 = aucune erreur sur nos fichiers)"
```
Expected: `grep exit=1`. (Des erreurs d'un WIP parallèle ailleurs sont possibles — les ignorer si elles ne concernent pas `me/notifications`.)

- [ ] **Step 3: Commit**

```bash
git branch --show-current   # doit afficher feat/alertes-parties-ouvertes
git add frontend/app/me/notifications/page.tsx
git commit -m "feat(notifications): page alignee sur le shell standard (Screen + barre du haut)" -- frontend/app/me/notifications/page.tsx
```

---

### Task 3: Page Réglages notifications — shell standard + test

**Files:**
- Modify: `frontend/__tests__/NotificationSettings.test.tsx` (mocks + assertion shell)
- Modify: `frontend/app/me/notifications/settings/page.tsx` (réécriture du shell, logique intacte)

- [ ] **Step 1: Mettre à jour le test (échec attendu d'abord)**

Remplacer intégralement `frontend/__tests__/NotificationSettings.test.tsx` par :

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SettingsPage from '@/app/me/notifications/settings/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }), logout: jest.fn() }));
// Hôte plateforme (slug null) → branche en-tête BackButton/ThemeToggle/ProfileMenu,
// pas de montage de la vraie ClubNav (qui exigerait le mock de ses appels API + SSE).
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null }) }));
jest.mock('@/lib/api', () => ({
  api: {
    getNotificationPreferences: jest.fn().mockResolvedValue({ preferences: [] }),
    getMyClubs: jest.fn().mockResolvedValue([]),
    updateNotificationPreferences: jest.fn().mockResolvedValue({ ok: true }),
    getMyProfile: jest.fn().mockResolvedValue({ id: 'u1', firstName: 'Test', lastName: 'User', email: 't@x.fr', avatarUrl: null }),
  },
  assetUrl: (u: string | null) => u,
}));
jest.mock('@/lib/usePush', () => ({ usePush: () => ({ status: 'unsupported', subscribe: jest.fn(), unsubscribe: jest.fn() }) }));

const mount = () => render(<ThemeProvider><SettingsPage /></ThemeProvider>);

describe('NotificationSettings', () => {
  it('affiche le shell standard (en-tête plateforme) et la grille, verrouille CLUB_MESSAGES+Cloche', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Messages du club')).toBeInTheDocument());
    // Shell : la page porte désormais l'en-tête standard (branche plateforme).
    expect(screen.getByLabelText('Retour')).toBeInTheDocument();
    expect(screen.getByLabelText('Changer de thème')).toBeInTheDocument();
    const locked = screen.getByLabelText('Messages du club – Cloche') as HTMLInputElement;
    expect(locked.checked).toBe(true);
    expect(locked.disabled).toBe(true);
  });

  it('enregistre les préférences', async () => {
    const { api } = require('@/lib/api');
    mount();
    await waitFor(() => screen.getByText('Mes parties'));
    fireEvent.click(screen.getByLabelText('Mes parties – Email'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(api.updateNotificationPreferences).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Lancer le test — vérifier qu'il échoue**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js NotificationSettings.test.tsx
```
Expected: FAIL — `getByLabelText('Retour')` introuvable (la page n'a pas encore d'en-tête).

- [ ] **Step 3: Réécrire le shell de la page**

Dans `frontend/app/me/notifications/settings/page.tsx` :

**(a)** Compléter les imports — remplacer :

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, NotifPrefRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { usePush } from '@/lib/usePush';
```

par :

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, NotifPrefRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { BackButton, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { usePush } from '@/lib/usePush';
```

**(b)** Ajouter le hook club — remplacer :

```tsx
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const { status: pushStatus, subscribe, unsubscribe } = usePush();
```

par :

```tsx
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const { slug, club } = useClub();
  const { status: pushStatus, subscribe, unsubscribe } = usePush();
```

**(c)** Remplacer l'ouverture du rendu — remplacer :

```tsx
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 22, color: th.text, marginBottom: 4 }}>Notifications</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 16 }}>
        Choisis comment tu veux être prévenu. Active le push pour être prévenu même l'app fermée.
      </p>
```

par :

```tsx
  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        {slug && club ? (
          <ClubNav club={club} />
        ) : (
          <div style={{ padding: '28px 20px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <BackButton href="/clubs" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ThemeToggle />
                <ProfileMenu />
              </div>
            </div>
          </div>
        )}

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Notifications
        </div>

        <div style={{ padding: '18px 20px 0' }}>
      <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 16 }}>
        Choisis comment tu veux être prévenu. Active le push pour être prévenu même l'app fermée.
      </p>
```

**(d)** Fermer les conteneurs — remplacer la fin du fichier :

```tsx
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button onClick={save} style={{
          padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
          background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontWeight: 700,
        }}>Enregistrer</button>
        {saved && <span style={{ color: th.textMute, fontFamily: th.fontUI, fontSize: 13 }}>Enregistré ✓</span>}
      </div>
    </div>
  );
}
```

par :

```tsx
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button onClick={save} style={{
          padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
          background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontWeight: 700,
        }}>Enregistrer</button>
        {saved && <span style={{ color: th.textMute, fontFamily: th.fontUI, fontSize: 13 }}>Enregistré ✓</span>}
      </div>
        </div>
      </div>
    </Screen>
  );
}
```

(L'indentation du contenu intermédiaire — bandeaux push, table — n'est pas ré-alignée : JSX s'en moque, on limite le diff. Le `<h1>` 22px disparaît au profit du titre display standard.)

- [ ] **Step 4: Lancer le test — vérifier qu'il passe**

Run: `node node_modules/jest/bin/jest.js NotificationSettings.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Type-check scopé**

Run: `node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "me/notifications" ; echo "grep exit=$? (1 = aucune erreur sur nos fichiers)"`
Expected: `grep exit=1`.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # doit afficher feat/alertes-parties-ouvertes
git add frontend/app/me/notifications/settings/page.tsx frontend/__tests__/NotificationSettings.test.tsx
git commit -m "feat(notifications): reglages alignes sur le shell standard + test shell" -- frontend/app/me/notifications/settings/page.tsx frontend/__tests__/NotificationSettings.test.tsx
```

---

### Task 4: Vérification visuelle

**Files:** possiblement retouchés selon constats (même pattern que les tâches précédentes).

- [ ] **Step 1: Invoquer la skill `verify`** (stack locale déjà lancée, session authentifiée `test@palova.fr`/`password123`)

Pages à capturer — desktop **1280** (clair + sombre) puis **390 en non-régression** (⚠️ `mobile:false` + largeur fixe, piège d'émulation connu) :

1. `padel-arena-paris.localhost:3000/me/profile`
2. `padel-arena-paris.localhost:3000/me/friends`
3. `padel-arena-paris.localhost:3000/me/notifications` — **ET** `localhost:3000/me/notifications` (hôte plateforme, branche BackButton)
4. `padel-arena-paris.localhost:3000/me/notifications/settings` — **ET** `localhost:3000/me/notifications/settings`

- [ ] **Step 2: Critères**

- Barre du haut présente sur les 4 pages côté club (ClubNav, même largeur que les autres pages) ; en-tête plateforme (Retour + toggles) côté plateforme.
- Contenu en pleine colonne (plus de bande centrée étroite sur profil/amis).
- Aucun débordement horizontal : `document.documentElement.scrollWidth <= innerWidth` partout (1280 et 390).

- [ ] **Step 3: Corriger si besoin, re-vérifier, committer le polish**

Tout écart → correction minimale dans le fichier concerné, re-capture de la page touchée, puis :

```bash
git branch --show-current
git add <fichiers du polish uniquement>
git commit -m "polish(me): retouches apres verification visuelle pleine largeur" -- <fichiers du polish uniquement>
```

(Si rien à corriger : pas de commit.)

---

## Self-review (fait à l'écriture du plan)

- **Couverture spec :** §Changements 1 (profil) + 2 (amis) → Task 1 ; §3 (notifications) → Task 2 ; §4 (réglages) → Task 3 ; §Tests (stratégie hôte plateforme pour `NotificationSettings.test`, avec `getMyProfile`/`assetUrl` dans le mock api — ProfileMenu appelle `getMyProfile` dès le mount) → Task 3 Step 1 ; §Vérification → Task 4. Hors périmètre respecté (aucun backend, aucune autre page).
- **Placeholders :** aucun — chaque étape porte le code complet ou la commande exacte avec résultat attendu.
- **Cohérence :** l'en-tête double branche est copié à l'identique de `/me/profile` (lignes 317-329) dans les Tasks 2 et 3 ; le titre display 38 est byte-identique à celui de `/me/messages`/`/me/friends` ; les imports `BackButton, ThemeToggle` viennent bien de `components/ui/atoms` et `ProfileMenu` de `components/ProfileMenu` (vérifiés dans profile/page.tsx).
