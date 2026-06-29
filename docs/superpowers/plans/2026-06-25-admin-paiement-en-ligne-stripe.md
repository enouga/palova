# Page admin « Paiement en ligne » + changement de compte Stripe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraire la configuration du paiement en ligne dans une page admin dédiée `/admin/payments` et permettre au gérant de changer de compte Stripe proprement (déliaison + ré-onboarding), avec un garde-fou contre la perte de remboursements encore plausibles.

**Architecture:** Stripe Connect (comptes Express), Palova plateforme. Le club est lié via `Club.stripeAccountId`/`stripeAccountStatus`. On ajoute `StripeService.disconnectAccount` (garde-fou + déliaison transactionnelle + purge des `ClubStripeCustomer`), une route admin `POST /stripe/disconnect`, le client `api.disconnectStripe`, une page `/admin/payments` reprenant les états Stripe + un `ConfirmDialog` de changement de compte, une entrée sidebar, et le retrait du bloc Stripe de `/admin/settings`.

**Tech Stack:** Express 5, Prisma 7, Jest + supertest (backend) ; Next.js 16 / React 19, React Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-06-25-admin-paiement-en-ligne-stripe-design.md`

---

## File Structure

- `backend/src/services/stripe.service.ts` — **modifier** : ajouter `disconnectAccount(clubId)`.
- `backend/src/services/__tests__/stripe.service.test.ts` — **modifier** : étendre les mocks prisma (`payment.findMany`, `$transaction`, `clubStripeCustomer.deleteMany`) + 3 tests.
- `backend/src/routes/admin.ts` — **modifier** : route `POST /stripe/disconnect` avec mapping 409 explicite.
- `backend/src/routes/__tests__/admin.stripe.routes.test.ts` — **modifier** : mock partagé `disconnectAccount` + 2 tests (200, 409).
- `frontend/lib/api.ts` — **modifier** : `disconnectStripe` + le helper `request` recopie `count` du corps d'erreur.
- `frontend/app/admin/payments/page.tsx` — **créer** : la page dédiée.
- `frontend/__tests__/AdminPayments.test.tsx` — **créer** : rendu des états + flux changement de compte.
- `frontend/app/admin/layout.tsx` — **modifier** : entrée sidebar « Paiement en ligne ».
- `frontend/app/admin/settings/page.tsx` — **modifier** : retirer le bloc Stripe, mettre un lien.

Aucune migration.

---

## Task 1: Backend — `StripeService.disconnectAccount` (garde-fou + déliaison)

**Files:**
- Modify: `backend/src/services/stripe.service.ts`
- Test: `backend/src/services/__tests__/stripe.service.test.ts`

- [ ] **Step 1: Étendre les mocks prisma du test**

Dans `backend/src/services/__tests__/stripe.service.test.ts`, remplacer le bloc `jest.mock('../../db/prisma', …)` (lignes 3-17) par :

```ts
jest.mock('../../db/prisma', () => {
  const prisma = {
    club: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    clubStripeCustomer: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    payment: { findMany: jest.fn() },
    // Exécute le callback de transaction avec `prisma` comme `tx`.
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});
```

- [ ] **Step 2: Écrire les tests qui échouent**

Ajouter à la fin de `backend/src/services/__tests__/stripe.service.test.ts` :

```ts
describe('disconnectAccount', () => {
  it('délie le compte, reset les flags et purge les ClubStripeCustomer', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1' }));
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([]); // aucun paiement en attente
    (prisma.club.update as jest.Mock).mockResolvedValue({});
    (prisma.clubStripeCustomer.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });

    await svc.disconnectAccount('club-1');

    expect(prisma.club.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'club-1' },
      data: {
        stripeAccountId: null,
        stripeAccountStatus: 'NONE',
        requireOnlinePayment: false,
        requireCardFingerprint: false,
      },
    }));
    expect(prisma.clubStripeCustomer.deleteMany).toHaveBeenCalledWith({ where: { clubId: 'club-1' } });
  });

  it('bloque (STRIPE_HAS_PENDING_ONLINE_PAYMENTS + count) si un paiement ONLINE non remboursé reste sur une réservation à venir', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1' }));
    // 2 candidats (réservation future déjà filtrée par la requête) ; 1 a un solde remboursable.
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([
      { amount: 25, refundedAmount: 25 },  // entièrement remboursé → ne compte pas
      { amount: 25, refundedAmount: 0 },   // remboursable → compte
    ]);

    await expect(svc.disconnectAccount('club-1')).rejects.toMatchObject({
      message: 'STRIPE_HAS_PENDING_ONLINE_PAYMENTS',
      count: 1,
    });
    expect(prisma.club.update).not.toHaveBeenCalled();
    expect(prisma.clubStripeCustomer.deleteMany).not.toHaveBeenCalled();
  });

  it('lève STRIPE_NOT_CONFIGURED si aucun compte lié', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub()); // stripeAccountId null
    await expect(svc.disconnectAccount('club-1')).rejects.toThrow('STRIPE_NOT_CONFIGURED');
  });
});
```

> Note : le filtre `reservation.startTime > now` est appliqué **dans la requête** `payment.findMany` ; le test mocke donc directement la liste des candidats déjà filtrés par date, et vérifie le second filtre JS (`amount > refundedAmount`).

- [ ] **Step 3: Lancer les tests — vérifier l'échec**

Run: `cd backend && npx jest stripe.service --silent`
Expected: FAIL — `svc.disconnectAccount is not a function`.

- [ ] **Step 4: Implémenter `disconnectAccount`**

Dans `backend/src/services/stripe.service.ts`, ajouter l'import Prisma en tête (sous les imports existants) :

```ts
import { Prisma } from '@prisma/client';
```

Puis ajouter cette méthode dans la classe `StripeService` (par ex. juste avant `refundPaymentIntent`) :

```ts
  /**
   * Délie le compte Stripe connecté du club pour permettre un nouvel onboarding.
   * Garde-fou : refuse tant qu'il reste un paiement ONLINE non totalement remboursé
   * sur une réservation À VENIR (remboursement encore plausible). Les paiements sur
   * réservations passées ne bloquent pas (condition finie qui se purge d'elle-même).
   * Purge les ClubStripeCustomer (cartes liées à l'ancien compte, inutilisables ailleurs)
   * et désactive les 2 réglages de paiement (sinon des réservations seraient bloquées).
   */
  async disconnectAccount(clubId: string): Promise<void> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { stripeAccountId: true },
    });
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');

    const candidates = await prisma.payment.findMany({
      where: {
        clubId,
        method: 'ONLINE',
        stripePaymentIntentId: { not: null },
        reservation: { is: { startTime: { gt: new Date() } } },
      },
      select: { amount: true, refundedAmount: true },
    });
    const pending = candidates.filter((p) => Number(p.amount) > Number(p.refundedAmount)).length;
    if (pending > 0) {
      throw Object.assign(new Error('STRIPE_HAS_PENDING_ONLINE_PAYMENTS'), { count: pending });
    }

    await prisma.$transaction(async (tx) => {
      await tx.club.update({
        where: { id: clubId },
        data: {
          stripeAccountId: null,
          stripeAccountStatus: 'NONE',
          requireOnlinePayment: false,
          requireCardFingerprint: false,
        },
      });
      await tx.clubStripeCustomer.deleteMany({ where: { clubId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
```

- [ ] **Step 5: Lancer les tests — vérifier le succès**

Run: `cd backend && npx jest stripe.service --silent`
Expected: PASS (tous les `describe`, y compris les 3 nouveaux).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/stripe.service.ts backend/src/services/__tests__/stripe.service.test.ts
git commit -m "feat(stripe): StripeService.disconnectAccount (garde-fou + delie le compte)"
```

---

## Task 2: Backend — route `POST /stripe/disconnect`

**Files:**
- Modify: `backend/src/routes/admin.ts` (après `GET /stripe/login-link`, vers la ligne 879)
- Test: `backend/src/routes/__tests__/admin.stripe.routes.test.ts`

- [ ] **Step 1: Préparer le mock partagé + écrire les tests qui échouent**

Dans `backend/src/routes/__tests__/admin.stripe.routes.test.ts`, remplacer le haut du fichier (lignes 1-14) par ceci (on déplace `import app` SOUS le `jest.mock`, et on injecte un mock partagé `mockDisconnect` réglable par test) :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mockDisconnect = jest.fn();
jest.mock('../../services/stripe.service', () => ({
  StripeService: jest.fn().mockImplementation(() => ({
    createConnectedAccount: jest.fn().mockResolvedValue('https://connect.stripe.com/xxx'),
    syncAccountStatus: jest.fn().mockResolvedValue('ACTIVE'),
    createLoginLink: jest.fn().mockResolvedValue('https://dashboard.stripe.com/xxx'),
    chargeNoShow: jest.fn().mockResolvedValue('pi_noshow_123'),
    disconnectAccount: mockDisconnect,
  })),
}));

import app from '../../app';
```

Puis ajouter ce `describe` à l'intérieur du `describe('Admin Stripe Connect routes', …)` (avant sa `}` fermante, ligne 88) :

```ts
  describe('POST /api/clubs/club-demo/admin/stripe/disconnect', () => {
    it('200 { ok: true } quand la déliaison réussit', async () => {
      asMember();
      mockDisconnect.mockResolvedValueOnce(undefined);

      const res = await request(app)
        .post('/api/clubs/club-demo/admin/stripe/disconnect')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockDisconnect).toHaveBeenCalledWith('club-demo');
    });

    it('409 { error, count } quand des paiements CB sont en attente', async () => {
      asMember();
      mockDisconnect.mockRejectedValueOnce(
        Object.assign(new Error('STRIPE_HAS_PENDING_ONLINE_PAYMENTS'), { count: 3 }),
      );

      const res = await request(app)
        .post('/api/clubs/club-demo/admin/stripe/disconnect')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'STRIPE_HAS_PENDING_ONLINE_PAYMENTS', count: 3 });
    });

    it('403 si non membre du club', async () => {
      prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
      const res = await request(app)
        .post('/api/clubs/club-demo/admin/stripe/disconnect')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });
```

> Le mock partagé `mockDisconnect` est préfixé `mock`, donc autorisé dans la factory `jest.mock`. `import app` est placé après la factory pour que `mockDisconnect` soit initialisé quand le module est chargé.

- [ ] **Step 2: Lancer le test — vérifier l'échec**

Run: `cd backend && npx jest admin.stripe.routes --silent`
Expected: FAIL — la route renvoie 404 (route inexistante).

- [ ] **Step 3: Implémenter la route**

Dans `backend/src/routes/admin.ts`, juste après le handler `router.get('/stripe/login-link', …)` (qui se termine ligne 879), ajouter :

```ts
router.post('/stripe/disconnect', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    await stripeService.disconnectAccount(req.membership!.clubId);
    res.json({ ok: true });
  } catch (err) {
    // handleError ne porte que { error } ; on traite ce code à part pour transmettre le count.
    if ((err as Error).message === 'STRIPE_HAS_PENDING_ONLINE_PAYMENTS') {
      return void res.status(409).json({
        error: 'STRIPE_HAS_PENDING_ONLINE_PAYMENTS',
        count: (err as { count?: number }).count ?? 0,
      });
    }
    handleError(err, res, next);
  }
});
```

- [ ] **Step 4: Lancer le test — vérifier le succès**

Run: `cd backend && npx jest admin.stripe.routes --silent`
Expected: PASS (les 3 nouveaux cas + les anciens).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.stripe.routes.test.ts
git commit -m "feat(stripe): route POST /admin/stripe/disconnect (409 + count si paiements en attente)"
```

---

## Task 3: Frontend — `api.disconnectStripe` + `request` recopie `count`

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Étendre le helper `request` pour recopier `count`**

Dans `frontend/lib/api.ts`, dans la fonction `request` (bloc `if (!res.ok)`, lignes 24-29), ajouter la recopie de `count` à côté de celle de `subject` :

```ts
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.error || `HTTP ${res.status}`);
    if (body && typeof body.subject === 'string') (err as Error & { subject?: string }).subject = body.subject;
    if (body && typeof body.count === 'number') (err as Error & { count?: number }).count = body.count;
    throw err;
  }
```

- [ ] **Step 2: Ajouter `disconnectStripe` à côté des autres fonctions Stripe**

Dans `frontend/lib/api.ts`, juste après `getStripeLoginLink` (ligne 175), ajouter :

```ts
  disconnectStripe: (clubId: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/stripe/disconnect`, { method: 'POST' }, token),
```

- [ ] **Step 3: Vérifier la compilation TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (aucune erreur de type).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(stripe): api.disconnectStripe + request recopie count du corps d'erreur"
```

---

## Task 4: Frontend — page `/admin/payments`

**Files:**
- Create: `frontend/app/admin/payments/page.tsx`
- Test: `frontend/__tests__/AdminPayments.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/AdminPayments.test.tsx` :

```tsx
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import AdminPaymentsPage from '../app/admin/payments/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/admin/payments',
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'abc', ready: true }) }));

const mockClubCtx = { slug: 'demo', club: { id: 'c1' } as Record<string, unknown>, loading: false };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => mockClubCtx }));

jest.mock('../lib/api', () => ({
  api: {
    adminGetClub: jest.fn(),
    getStripeStatus: jest.fn().mockResolvedValue({ stripeAccountStatus: 'NONE' }),
    initiateStripeConnect: jest.fn(),
    getStripeLoginLink: jest.fn(),
    adminUpdateClub: jest.fn().mockResolvedValue({}),
    disconnectStripe: jest.fn(),
  },
  assetUrl: (p: string | null) => p,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const clubWith = (over: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'Club Démo',
  stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
  requireOnlinePayment: false, requireCardFingerprint: false,
  ...over,
});

const wrap = async () => {
  render(<ThemeProvider><AdminPaymentsPage /></ThemeProvider>);
  await act(async () => {});
};

beforeEach(() => jest.clearAllMocks());

describe('AdminPaymentsPage', () => {
  it('état ACTIVE : affiche les réglages et le bouton de changement de compte', async () => {
    api.adminGetClub.mockResolvedValue(clubWith());
    await wrap();
    expect(await screen.findByText('Compte actif')).toBeInTheDocument();
    expect(screen.getByText('Exiger le paiement CB à la réservation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Changer de compte Stripe' })).toBeInTheDocument();
  });

  it('état NONE : affiche le bouton de connexion, pas de changement de compte', async () => {
    api.adminGetClub.mockResolvedValue(clubWith({ stripeAccountId: null, stripeAccountStatus: 'NONE' }));
    await wrap();
    expect(await screen.findByRole('button', { name: 'Connecter mon compte Stripe' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Changer de compte Stripe' })).not.toBeInTheDocument();
  });

  it('changement de compte : confirme, appelle disconnectStripe puis repasse en NONE', async () => {
    api.adminGetClub
      .mockResolvedValueOnce(clubWith())                                              // chargement initial
      .mockResolvedValueOnce(clubWith({ stripeAccountId: null, stripeAccountStatus: 'NONE' })); // après déliaison
    api.disconnectStripe.mockResolvedValue({ ok: true });
    await wrap();

    fireEvent.click(await screen.findByRole('button', { name: 'Changer de compte Stripe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Changer de compte' })); // bouton du ConfirmDialog

    await waitFor(() => expect(api.disconnectStripe).toHaveBeenCalledWith('c1', 'abc'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connecter mon compte Stripe' })).toBeInTheDocument());
  });

  it('changement de compte : 409 affiche le nombre de paiements en attente et ne bascule pas', async () => {
    api.adminGetClub.mockResolvedValue(clubWith());
    api.disconnectStripe.mockRejectedValue(
      Object.assign(new Error('STRIPE_HAS_PENDING_ONLINE_PAYMENTS'), { count: 2 }),
    );
    await wrap();

    fireEvent.click(await screen.findByRole('button', { name: 'Changer de compte Stripe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Changer de compte' }));

    await waitFor(() => expect(screen.getByText(/2 paiement\(s\) CB sur des réservations à venir/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Connecter mon compte Stripe' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer le test — vérifier l'échec**

Run: `cd frontend && npx jest AdminPayments --silent`
Expected: FAIL — module `../app/admin/payments/page` introuvable.

- [ ] **Step 3: Créer la page**

Créer `frontend/app/admin/payments/page.tsx` :

```tsx
'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, ClubAdminDetail } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const STATUS_META: Record<string, { dot: string; label: string }> = {
  NONE:       { dot: '#9ca3af', label: 'Non connecté' },
  PENDING:    { dot: '#f59e0b', label: 'Onboarding en cours' },
  RESTRICTED: { dot: '#f59e0b', label: 'Compte restreint' },
  ACTIVE:     { dot: '#22c55e', label: 'Compte actif' },
};

export default function AdminPaymentsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club: hostClub } = useClub();
  const clubId = hostClub?.id;

  const [club, setClub]       = useState<ClubAdminDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [saved, setSaved]     = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const card: CSSProperties = {
    background: th.surface, border: `1px solid ${th.line}`,
    borderRadius: 18, padding: 24, marginBottom: 20,
  };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setClub(await api.adminGetClub(clubId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  // Retour d'onboarding Stripe (?stripe=return|refresh) → resync du statut.
  useEffect(() => {
    if (!ready || !token || !clubId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'return' || params.get('stripe') === 'refresh') {
      api.getStripeStatus(clubId, token).then(() => {
        window.history.replaceState({}, '', window.location.pathname);
        load();
      }).catch(() => {});
    }
  }, [ready, token, clubId, load]);

  const handleConnect = async () => {
    if (!token || !clubId) return;
    setConnecting(true);
    try {
      const base = window.location.href.split('?')[0];
      const { url } = await api.initiateStripeConnect(
        clubId, { refreshUrl: `${base}?stripe=refresh`, returnUrl: `${base}?stripe=return` }, token,
      );
      window.location.href = url;
    } catch { setConnecting(false); }
  };

  const handleLoginLink = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!token || !clubId) return;
    try { const { url } = await api.getStripeLoginLink(clubId, token); window.open(url, '_blank'); }
    catch { /* ignore */ }
  };

  const handleRefresh = async () => {
    if (!token || !clubId) return;
    try { await api.getStripeStatus(clubId, token); await load(); } catch { /* ignore */ }
  };

  const setFlag = async (key: 'requireOnlinePayment' | 'requireCardFingerprint', value: boolean) => {
    if (!token || !clubId || !club) return;
    setClub({ ...club, [key]: value });
    setSaved(false);
    try { await api.adminUpdateClub(clubId, { [key]: value }, token); setSaved(true); }
    catch { load(); } // revert depuis la source en cas d'échec
  };

  const handleDisconnect = async () => {
    if (!token || !clubId) return;
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      await api.disconnectStripe(clubId, token);
      setConfirmOpen(false);
      await load();
    } catch (e) {
      const err = e as Error & { count?: number };
      if (err.message === 'STRIPE_HAS_PENDING_ONLINE_PAYMENTS') {
        setDisconnectError(
          `${err.count ?? 0} paiement(s) CB sur des réservations à venir — remboursez-les ou attendez qu'elles soient passées avant de changer de compte.`,
        );
      } else {
        setDisconnectError('Le changement a échoué. Réessayez.');
      }
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) return <div style={{ padding: 24, fontFamily: th.fontUI, color: th.textMute }}>Chargement…</div>;
  if (error || !club) return <div style={{ padding: 24, fontFamily: th.fontUI, color: '#ef4444' }}>{error ?? 'Erreur de chargement'}</div>;

  const status = club.stripeAccountStatus;
  const meta = STATUS_META[status] ?? STATUS_META.NONE;
  const linked = status !== 'NONE';

  return (
    <div style={{ maxWidth: 720, padding: 24 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 28, margin: '0 0 4px', color: th.text }}>Paiement en ligne</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 24px' }}>
        Acceptez les paiements CB en ligne et les empreintes bancaires via Stripe.
      </p>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: meta.dot, display: 'inline-block' }} />
          <span style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 600, color: th.text }}>{meta.label}</span>
          {linked && (
            <button onClick={handleRefresh} style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${th.line}`, borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
              Rafraîchir le statut
            </button>
          )}
        </div>

        {status === 'NONE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: 0 }}>
              Connectez votre compte Stripe pour accepter les paiements CB en ligne et enregistrer des empreintes bancaires.
            </p>
            <div>
              <button onClick={handleConnect} disabled={connecting} style={{ background: '#635bff', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 20px', cursor: connecting ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, opacity: connecting ? 0.7 : 1 }}>
                {connecting ? 'Redirection…' : 'Connecter mon compte Stripe'}
              </button>
            </div>
          </div>
        )}

        {status === 'PENDING' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Terminez votre inscription Stripe pour activer les paiements.</span>
            <div>
              <button onClick={handleConnect} disabled={connecting} style={{ background: th.surface2, color: th.text, border: `1px solid ${th.line}`, borderRadius: 9, padding: '8px 16px', cursor: connecting ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 14 }}>
                {connecting ? 'Redirection…' : "Reprendre l'onboarding"}
              </button>
            </div>
          </div>
        )}

        {status === 'RESTRICTED' && (
          <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Compte restreint — vérifiez votre tableau de bord Stripe pour lever les restrictions.</span>
        )}

        {status === 'ACTIVE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <a href="#" onClick={handleLoginLink} style={{ fontFamily: th.fontUI, fontSize: 14, color: th.accent }}>Tableau de bord Stripe ↗</a>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: th.fontUI, fontSize: 15, color: th.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={club.requireOnlinePayment} onChange={(e) => setFlag('requireOnlinePayment', e.target.checked)} style={{ width: 16, height: 16, accentColor: th.accent }} />
                Exiger le paiement CB à la réservation
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: th.fontUI, fontSize: 15, color: th.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={club.requireCardFingerprint} onChange={(e) => setFlag('requireCardFingerprint', e.target.checked)} style={{ width: 16, height: 16, accentColor: th.accent }} />
                Enregistrer une empreinte bancaire (protection no-show)
              </label>
              {saved && <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.accent }}>Enregistré ✓</span>}
            </div>
          </div>
        )}
      </div>

      {linked && (
        <div style={card}>
          <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, margin: '0 0 8px', color: th.text }}>Changer de compte Stripe</h2>
          <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 14px', lineHeight: 1.5 }}>
            Délier le compte actuel pour en connecter un autre. Les empreintes bancaires enregistrées seront supprimées.
          </p>
          <Btn variant="danger" onClick={() => { setDisconnectError(null); setConfirmOpen(true); }}>Changer de compte Stripe</Btn>
        </div>
      )}

      {confirmOpen && (
        <ConfirmDialog
          title="Changer de compte Stripe"
          message={
            <span>
              Conséquences :
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                <li>les empreintes bancaires enregistrées seront supprimées — les clients devront re-saisir leur carte ;</li>
                <li>le paiement CB sera désactivé jusqu'au nouvel onboarding ;</li>
                <li>les remboursements des paiements CB déjà encaissés sur l'ancien compte ne seront plus possibles.</li>
              </ul>
              {disconnectError && (
                <span style={{ display: 'block', marginTop: 12, color: '#ef4444', fontWeight: 600 }}>{disconnectError}</span>
              )}
            </span>
          }
          confirmLabel="Changer de compte"
          busy={disconnecting}
          onConfirm={handleDisconnect}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer le test — vérifier le succès**

Run: `cd frontend && npx jest AdminPayments --silent`
Expected: PASS (les 4 cas).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/payments/page.tsx frontend/__tests__/AdminPayments.test.tsx
git commit -m "feat(stripe): page admin /admin/payments (statut, reglages, changement de compte)"
```

---

## Task 5: Frontend — entrée sidebar « Paiement en ligne »

**Files:**
- Modify: `frontend/app/admin/layout.tsx:116-119` (section « Finances »)

- [ ] **Step 1: Ajouter l'entrée dans la section Finances**

Dans `frontend/app/admin/layout.tsx`, dans la section `{ title: 'Finances', … }`, ajouter la ligne « Paiement en ligne » en tête de la section :

```tsx
    { title: 'Finances', color: '#5bbd6e', items: [
      { href: '/admin/payments',     label: 'Paiement en ligne', icon: 'lock' },
      { href: '/admin/comptabilite', label: 'Comptabilité',     icon: 'chart' },
      { href: '/admin/packages',     label: 'Offres prépayées', icon: 'card' },
    ] },
```

- [ ] **Step 2: Vérifier que la sidebar rend la nouvelle entrée**

Run: `cd frontend && npx jest AdminLayout --silent`
Expected: PASS (la suite existante ne casse pas ; `lock` est un `IconName` valide).

- [ ] **Step 3: Vérifier la compilation TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/layout.tsx
git commit -m "feat(stripe): entree sidebar admin Paiement en ligne"
```

---

## Task 6: Frontend — retirer le bloc Stripe de `/admin/settings`, mettre un lien

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx`

- [ ] **Step 1: Remplacer le bloc « Paiement en ligne » par un lien**

Dans `frontend/app/admin/settings/page.tsx`, remplacer tout le bloc `{/* Paiement en ligne — Stripe Connect */}` (de `<div style={card}>` ligne 474 à sa `</div>` fermante ligne 523) par :

```tsx
      {/* Paiement en ligne — déplacé sur sa page dédiée */}
      <div style={card}>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: '0 0 8px', color: th.text }}>Paiement en ligne</h2>
        <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 14px' }}>
          La connexion Stripe et les réglages de paiement CB ont leur page dédiée.
        </p>
        <a href="/admin/payments" style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.accent }}>
          Gérer le paiement en ligne →
        </a>
      </div>
```

- [ ] **Step 2: Retirer le code Stripe désormais inutilisé**

Dans le même fichier, supprimer :
- l'état `const [stripeConnecting, setStripeConnecting] = useState(false);` (ligne 23) ;
- l'effet `useEffect` du retour d'onboarding `?stripe=` (lignes 39-48) ;
- les handlers `handleStripeConnect` (lignes 50-61) et `handleStripeLoginLink` (lignes 63-70).

> Ces symboles ne sont plus référencés (le bloc qui les utilisait est remplacé par le lien). `getStripeStatus`/`initiateStripeConnect`/`getStripeLoginLink` restent dans `lib/api.ts` (utilisés par la nouvelle page). Les champs `requireOnlinePayment`/`requireCardFingerprint` restent dans le `body` de `save()` (inoffensif — la nouvelle page les pilote aussi).

- [ ] **Step 3: Vérifier la compilation TypeScript (aucune référence morte)**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS — aucune erreur « declared but never used » ni symbole manquant.

- [ ] **Step 4: Lancer la suite frontend complète**

Run: `cd frontend && npx jest --silent`
Expected: PASS (aucune régression ; il n'existe pas de test de la page settings qui dépendrait du bloc retiré).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/settings/page.tsx
git commit -m "refactor(stripe): /admin/settings renvoie vers la page Paiement en ligne dediee"
```

---

## Task 7: Vérification finale

- [ ] **Step 1: Suite backend complète**

Run: `cd backend && npx jest --silent`
Expected: PASS.

- [ ] **Step 2: Suite frontend complète**

Run: `cd frontend && npx jest --silent`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `cd frontend && npx eslint app/admin/payments/page.tsx app/admin/layout.tsx app/admin/settings/page.tsx lib/api.ts`
Expected: aucun warning/erreur.

- [ ] **Step 4: Vérification manuelle (optionnelle, nécessite Docker + clés Stripe test)**

1. Démarrer backend + frontend (cf. CLAUDE.md).
2. En tant que gérant, ouvrir `/admin` → section Finances → « Paiement en ligne ».
3. Vérifier l'affichage du statut courant ; sur un compte ACTIVE, basculer les 2 réglages (persistés) et ouvrir le tableau de bord Stripe.
4. Cliquer « Changer de compte Stripe » → lire le dialog → confirmer → la page repasse à « Connecter mon compte Stripe ».
5. Si un paiement CB est en attente sur une réservation future : le dialog affiche le message 409 et ne bascule pas.
6. Vérifier que `/admin/settings` montre le lien « Gérer le paiement en ligne → » au lieu du bloc.
