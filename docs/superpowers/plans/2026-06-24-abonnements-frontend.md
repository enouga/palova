# Abonnements — Plan d'implémentation FRONTEND (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rendre les abonnements utilisables dans l'UI : types/API, helper pur de couverture, section admin « Abonnements » + vente en caisse, affichage joueur (chip Réserver, BookingModal couverture, ProfileMenu).

**Architecture:** On miroir le feature « offres prépayées » (packages) existant. La décision de couverture côté client est un helper pur `lib/subscriptions.ts` (miroir du `coverageFor` backend, volet booléen). La confirmation de résa passe `paymentSource: { subscriptionId }` ; le backend (déjà fait) applique la gratuité/remise et renvoie une erreur claire si non couvert.

**Tech Stack:** Next.js 16 + React 19 + TS strict. Tests : RTL + Jest, `lib/api` mocké en `jest.mock('../lib/api', () => ({ api: { … }, assetUrl }))`. Lancer un test : `cd frontend && npx jest <fichier>`.

**Spec :** `docs/superpowers/specs/2026-06-23-abonnement-design.md`. **Backend (fait) :** routes `GET/POST /api/clubs/:clubId/admin/subscription-plans`, `PATCH …/:id`, `GET/POST …/members/:userId/subscriptions`, `GET /api/clubs/:slug/me/subscriptions` ; `confirmReservation` accepte `paymentSource:{subscriptionId}`. **Branche :** `feat/abonnements`.

> **IMPORTANT Next 16 :** Turbopack, `params` = Promise dans les server pages. Ces tâches touchent surtout des composants client (`'use client'`). Ne pas activer next-pwa.

---

## Structure des fichiers

- **Modifier** `frontend/lib/api.ts` — types `SubscriptionPlan`/`Subscription` + body types + 6 méthodes API ; élargir le type `paymentSource` de `confirmReservation`.
- **Créer** `frontend/lib/subscriptions.ts` — helpers purs `subscriptionCovers` / `coverageLabel` / `coveringSubscription`.
- **Créer** `frontend/__tests__/subscriptions.test.ts` — tests du helper.
- **Modifier** `frontend/app/admin/packages/page.tsx` — section « Abonnements » (liste + création).
- **Modifier** `frontend/app/admin/caisse/page.tsx` — panneau « Vendre un abonnement » + `METHOD_LABEL.SUBSCRIPTION`.
- **Modifier** `frontend/components/ClubReserve.tsx` — fetch abos + chip « Abonné » + passe `subscriptions` à BookingModal.
- **Modifier** `frontend/components/BookingModal.tsx` — bloc couverture + confirm `{ subscriptionId }`.
- **Modifier** `frontend/components/ProfileMenu.tsx` — abos actifs dans le menu.
- **Créer** `frontend/__tests__/BookingModal.subscription.test.tsx` — couverture au booking.

---

## Task F1 : Types + méthodes API (`lib/api.ts`)

**Files:** Modify `frontend/lib/api.ts`

- [ ] **Step 1 : Ajouter les types** (près des types `PackageTemplate`, ~`lib/api.ts:1275`)

```ts
export type SubscriptionBenefit = 'INCLUDED' | 'DISCOUNT';
export type SubscriptionStatus = 'ACTIVE' | 'CANCELLED';

export interface SubscriptionPlan {
  id: string;
  name: string;
  sportKeys: string[];
  monthlyPrice: string;        // Decimal sérialisé
  commitmentMonths: number;
  offPeakOnly: boolean;
  benefit: SubscriptionBenefit;
  discountPercent: number | null;
  dailyCap: number | null;
  weeklyCap: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface Subscription {
  id: string;
  planId: string;
  status: SubscriptionStatus;
  startedAt: string;
  expiresAt: string;
  monthlyPriceSnapshot: string;
  sportKeys: string[];
  offPeakOnly: boolean;
  benefit: SubscriptionBenefit;
  discountPercent: number | null;
  dailyCap: number | null;
  weeklyCap: number | null;
  plan: { name: string };
}

export type CreateSubscriptionPlanBody = {
  name: string; sportKeys: string[]; monthlyPrice: number; commitmentMonths: number;
  offPeakOnly?: boolean; benefit: SubscriptionBenefit; discountPercent?: number | null;
  dailyCap?: number | null; weeklyCap?: number | null;
};
export type UpdateSubscriptionPlanBody = Partial<CreateSubscriptionPlanBody & { isActive: boolean }>;
export interface SellSubscriptionBody {
  planId: string; method?: PaymentMethod; payerName?: string; voucherRef?: string; voucherIssuer?: string;
}
```

- [ ] **Step 2 : Ajouter les 6 méthodes API** (dans l'objet `api`, près de `adminGetPackageTemplates`, ~`:305` et `getMyClubPackages`, ~`:480`)

```ts
  adminGetSubscriptionPlans: (clubId: string, token: string) =>
    request<SubscriptionPlan[]>(`/api/clubs/${clubId}/admin/subscription-plans`, {}, token),
  adminCreateSubscriptionPlan: (clubId: string, body: CreateSubscriptionPlanBody, token: string) =>
    request<SubscriptionPlan>(`/api/clubs/${clubId}/admin/subscription-plans`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminUpdateSubscriptionPlan: (clubId: string, id: string, body: UpdateSubscriptionPlanBody, token: string) =>
    request<SubscriptionPlan>(`/api/clubs/${clubId}/admin/subscription-plans/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  adminGetMemberSubscriptions: (clubId: string, userId: string, token: string) =>
    request<Subscription[]>(`/api/clubs/${clubId}/admin/members/${userId}/subscriptions`, {}, token),
  adminSellSubscription: (clubId: string, userId: string, body: SellSubscriptionBody, token: string) =>
    request<{ subscription: Subscription; payment: Payment }>(`/api/clubs/${clubId}/admin/members/${userId}/subscriptions`, { method: 'POST', body: JSON.stringify(body) }, token),
  getMyClubSubscriptions: (slug: string, token: string) =>
    request<Subscription[]>(`/api/clubs/${slug}/me/subscriptions`, {}, token),
```

- [ ] **Step 3 : Élargir le type `paymentSource` de `confirmReservation`** (~`:137`)

```ts
    paymentSource?: { packageId: string } | { subscriptionId: string };
```

- [ ] **Step 4 : Typecheck**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: pas d'erreur.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(abonnements): types + méthodes API frontend (plans, vente, couverture)"
```

---

## Task F2 : Helper pur `lib/subscriptions.ts` + tests

**Files:** Create `frontend/lib/subscriptions.ts`, Create `frontend/__tests__/subscriptions.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
import { subscriptionCovers, coverageLabel, coveringSubscription } from '../lib/subscriptions';

const inclPadel = { sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED' as const, discountPercent: null };
const discPadel = { sportKeys: ['padel'], offPeakOnly: true, benefit: 'DISCOUNT' as const, discountPercent: 50 };
const allHours  = { sportKeys: ['squash'], offPeakOnly: false, benefit: 'INCLUDED' as const, discountPercent: null };

describe('subscriptionCovers', () => {
  it('couvre padel en heures creuses', () => {
    expect(subscriptionCovers(inclPadel, { sportKey: 'padel', isOffPeak: true })).toBe(true);
  });
  it('ne couvre pas un créneau plein si offPeakOnly', () => {
    expect(subscriptionCovers(inclPadel, { sportKey: 'padel', isOffPeak: false })).toBe(false);
  });
  it('ne couvre pas un autre sport', () => {
    expect(subscriptionCovers(inclPadel, { sportKey: 'squash', isOffPeak: true })).toBe(false);
  });
  it('offPeakOnly=false couvre aussi les heures pleines', () => {
    expect(subscriptionCovers(allHours, { sportKey: 'squash', isOffPeak: false })).toBe(true);
  });
});

describe('coverageLabel', () => {
  it('INCLUDED → gratuit', () => { expect(coverageLabel(inclPadel)).toBe('gratuit'); });
  it('DISCOUNT → −50 %', () => { expect(coverageLabel(discPadel)).toBe('−50 %'); });
});

describe('coveringSubscription', () => {
  it('retourne le 1er abo couvrant, sinon null', () => {
    expect(coveringSubscription([inclPadel], { sportKey: 'padel', isOffPeak: true })).toBe(inclPadel);
    expect(coveringSubscription([inclPadel], { sportKey: 'padel', isOffPeak: false })).toBeNull();
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `cd frontend && npx jest subscriptions.test`
Expected: FAIL « Cannot find module '../lib/subscriptions' ».

- [ ] **Step 3 : Implémenter le helper**

```ts
import type { Subscription } from './api';

type Coverage = Pick<Subscription, 'sportKeys' | 'offPeakOnly'>;
type Benefit = Pick<Subscription, 'benefit' | 'discountPercent'>;

/** Vrai si l'abonnement couvre ce créneau (miroir booléen de SubscriptionService.coverageFor). */
export function subscriptionCovers(sub: Coverage, ctx: { sportKey: string; isOffPeak: boolean }): boolean {
  return sub.sportKeys.includes(ctx.sportKey) && (!sub.offPeakOnly || ctx.isOffPeak);
}

/** Libellé court de l'avantage (« gratuit » ou « −X % »). */
export function coverageLabel(sub: Benefit): string {
  return sub.benefit === 'INCLUDED' ? 'gratuit' : `−${sub.discountPercent ?? 0} %`;
}

/** 1er abonnement de la liste qui couvre le créneau, sinon null. */
export function coveringSubscription<T extends Coverage>(
  subs: T[], ctx: { sportKey: string; isOffPeak: boolean },
): T | null {
  return subs.find((s) => subscriptionCovers(s, ctx)) ?? null;
}
```

- [ ] **Step 4 : Lancer → succès**

Run: `cd frontend && npx jest subscriptions.test`
Expected: PASS (8 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/subscriptions.ts frontend/__tests__/subscriptions.test.ts
git commit -m "feat(abonnements): helper pur de couverture (subscriptionCovers/coverageLabel)"
```

---

## Task F3 : Section « Abonnements » dans `/admin/packages`

**Files:** Modify `frontend/app/admin/packages/page.tsx`

Le composant a déjà la structure : `<h1>Offres prépayées</h1>` + formulaire de création + liste (état `templates`, `load()`, `create()`, `toggleActive()`). On ajoute une **2ᵉ moitié** « Abonnements » sous la liste des offres, avec son propre état et ses handlers, réutilisant les styles `input`/`label`/`Btn` déjà définis dans le fichier.

- [ ] **Step 1 : Lire le fichier en entier** pour récupérer les styles (`input`, `label`), l'usage de `useClub`/`useAuth`/`useTheme`, et le pattern `load`/`create`/`toggleActive`.

- [ ] **Step 2 : Ajouter l'état abonnements** (à côté des états packages)

```tsx
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [pName, setPName] = useState('');
  const [pSports, setPSports] = useState<string[]>(['padel']);
  const [pPrice, setPPrice] = useState('');
  const [pMonths, setPMonths] = useState('12');
  const [pOffPeak, setPOffPeak] = useState(true);
  const [pBenefit, setPBenefit] = useState<SubscriptionBenefit>('INCLUDED');
  const [pDiscount, setPDiscount] = useState('50');
  const [pDailyCap, setPDailyCap] = useState('');
  const [pWeeklyCap, setPWeeklyCap] = useState('');
```

Étendre le `load()` existant pour charger aussi les plans :
```tsx
      const [tpls, pls] = await Promise.all([
        api.adminGetPackageTemplates(clubId, token),
        api.adminGetSubscriptionPlans(clubId, token),
      ]);
      setTemplates(tpls); setPlans(pls);
```
(remplace l'appel `setTemplates(await api.adminGetPackageTemplates(...))`).

- [ ] **Step 3 : Ajouter les handlers** (sous `create`)

```tsx
  const sportOptions = ['padel', 'squash', 'tennis', 'badminton', 'pickleball', 'pingpong'];
  const toggleSport = (k: string) =>
    setPSports((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const createPlan = async () => {
    if (!token || !clubId) return;
    if (!pName.trim() || !pPrice || pSports.length === 0) { setError('Nom, prix et au moins un sport requis.'); return; }
    setBusy(true);
    try {
      setError(null);
      await api.adminCreateSubscriptionPlan(clubId, {
        name: pName.trim(), sportKeys: pSports, monthlyPrice: Number(pPrice), commitmentMonths: Number(pMonths),
        offPeakOnly: pOffPeak, benefit: pBenefit,
        discountPercent: pBenefit === 'DISCOUNT' ? Number(pDiscount) : null,
        dailyCap: pDailyCap ? Number(pDailyCap) : null,
        weeklyCap: pWeeklyCap ? Number(pWeeklyCap) : null,
      }, token);
      setPName(''); setPPrice('');
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const togglePlanActive = async (p: SubscriptionPlan) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { setError(null); await api.adminUpdateSubscriptionPlan(clubId, p.id, { isActive: !p.isActive }, token); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
```

- [ ] **Step 4 : Ajouter la section JSX** (juste avant le `</div>` final de la page, après la liste des offres)

```tsx
      {/* ===== Abonnements ===== */}
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '40px 0 18px', color: th.text }}>Abonnements</h1>

      <div style={{ background: th.surface, borderRadius: 16, padding: 18, marginBottom: 22, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text, marginBottom: 12 }}>Nouvel abonnement</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {sportOptions.map((k) => (
            <button key={k} type="button" onClick={() => toggleSport(k)}
              style={{ border: `1.5px solid ${pSports.includes(k) ? th.accent : th.line}`, background: pSports.includes(k) ? th.surface2 : 'transparent', borderRadius: 10, padding: '6px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
              {k}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ ...label, flex: 1, minWidth: 180 }}>Nom
            <input type="text" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Ex. Abonnement Padel — heures creuses" style={input} />
          </label>
          <label style={label}>Prix mensuel €
            <input type="number" min={0} step="1" value={pPrice} onChange={(e) => setPPrice(e.target.value)} style={{ ...input, width: 110 }} />
          </label>
          <label style={label}>Engagement (mois)
            <input type="number" min={1} step="1" value={pMonths} onChange={(e) => setPMonths(e.target.value)} style={{ ...input, width: 90 }} />
          </label>
          <label style={{ ...label, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={pOffPeak} onChange={(e) => setPOffPeak(e.target.checked)} /> Heures creuses uniquement
          </label>
          <label style={label}>Avantage
            <select value={pBenefit} onChange={(e) => setPBenefit(e.target.value as SubscriptionBenefit)} style={{ ...input, width: 130 }}>
              <option value="INCLUDED">Inclus (gratuit)</option>
              <option value="DISCOUNT">Remise %</option>
            </select>
          </label>
          {pBenefit === 'DISCOUNT' && (
            <label style={label}>Remise %
              <input type="number" min={1} max={100} step="1" value={pDiscount} onChange={(e) => setPDiscount(e.target.value)} style={{ ...input, width: 80 }} />
            </label>
          )}
          <label style={label}>Plafond / jour
            <input type="number" min={1} step="1" value={pDailyCap} onChange={(e) => setPDailyCap(e.target.value)} placeholder="∞" style={{ ...input, width: 90 }} />
          </label>
          <label style={label}>Plafond / sem.
            <input type="number" min={1} step="1" value={pWeeklyCap} onChange={(e) => setPWeeklyCap(e.target.value)} placeholder="∞" style={{ ...input, width: 90 }} />
          </label>
          <Btn type="button" icon="plus" onClick={createPlan} disabled={busy}>{busy ? '…' : 'Créer'}</Btn>
        </div>
      </div>

      {plans.length === 0 ? (
        <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun abonnement pour l’instant.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {plans.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: th.surface, borderRadius: 14, padding: '13px 16px', boxShadow: `inset 0 0 0 1px ${th.line}`, opacity: p.isActive ? 1 : 0.55 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>{p.name}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                  {p.sportKeys.join(', ')} · {euro(p.monthlyPrice)}/mois · {p.commitmentMonths} mois
                  {' · '}{p.offPeakOnly ? 'heures creuses' : 'toutes heures'}
                  {' · '}{p.benefit === 'INCLUDED' ? 'inclus' : `−${p.discountPercent} %`}
                  {(p.dailyCap || p.weeklyCap) ? ` · max ${p.dailyCap ?? '∞'}/j, ${p.weeklyCap ?? '∞'}/sem` : ''}
                </div>
              </div>
              <button type="button" onClick={() => togglePlanActive(p)} disabled={busy}
                style={{ border: `1px solid ${th.line}`, background: 'transparent', color: p.isActive ? '#ff7a4d' : th.text, borderRadius: 9, padding: '7px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
                {p.isActive ? 'Désactiver' : 'Réactiver'}
              </button>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 5 : Ajouter les imports** (`SubscriptionPlan`, `SubscriptionBenefit` depuis `@/lib/api`).

- [ ] **Step 6 : Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: pas d'erreur.

```bash
git add frontend/app/admin/packages/page.tsx
git commit -m "feat(abonnements): section Abonnements dans /admin/packages (liste + création)"
```

---

## Task F4 : Vente en caisse + libellé méthode

**Files:** Modify `frontend/app/admin/caisse/page.tsx`

- [ ] **Step 1 : Ajouter le libellé `SUBSCRIPTION`** dans `METHOD_LABEL` (`:14`) — NE PAS l'ajouter à `MONEY_METHODS` ni `SALE_METHODS`.

```ts
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre',
  VOUCHER: 'Ticket CE', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre',
  SUBSCRIPTION: 'Abonnement',
};
```

- [ ] **Step 2 : Lire la zone « vente d'offre »** (états `buyer`, `sellTplId`, `sellMethod`, `sellRef`, `sellIssuer`, handlers `pickBuyer`/`sell`, JSX du panneau) pour mirrorer.

- [ ] **Step 3 : Ajouter l'état + handler vente abonnement**

```tsx
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [sellPlanId, setSellPlanId] = useState('');

  // dans le load() existant, charger aussi les plans actifs :
  //   setPlans((await api.adminGetSubscriptionPlans(clubId, token)).filter((p) => p.isActive));

  const sellSub = async () => {
    if (!token || !clubId || !buyer || !sellPlanId) return;
    if (sellMethod === 'VOUCHER' && !sellRef.trim()) { setError('Référence du ticket CE requise.'); return; }
    setBusy(true);
    try {
      setError(null);
      await api.adminSellSubscription(clubId, buyer.userId, {
        planId: sellPlanId, method: sellMethod,
        payerName: `${buyer.firstName} ${buyer.lastName}`,
        voucherRef: sellMethod === 'VOUCHER' ? sellRef.trim() : undefined,
        voucherIssuer: sellMethod === 'VOUCHER' ? sellIssuer.trim() || undefined : undefined,
      }, token);
      await Promise.all([load(), pickBuyer(buyer)]);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
```

- [ ] **Step 4 : Ajouter le panneau JSX « Vendre un abonnement »** juste après le panneau « Vendre une offre » (mirroir : `<select>` des plans actifs → `setSellPlanId`, réutilise le même sélecteur de moyen de paiement `sellMethod` et les champs ticket CE déjà présents, bouton « Vendre l'abonnement » appelant `sellSub`, désactivé si `!buyer || !sellPlanId`). Afficher le plan comme `{p.name} — {euro(p.monthlyPrice)}/mois`.

- [ ] **Step 5 : Ajouter les imports** (`SubscriptionPlan`). Typecheck + commit.

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

```bash
git add frontend/app/admin/caisse/page.tsx
git commit -m "feat(abonnements): vente d'abonnement en caisse + libellé méthode SUBSCRIPTION"
```

---

## Task F5 : ClubReserve — fetch abos + chip + passe à BookingModal

**Files:** Modify `frontend/components/ClubReserve.tsx`

- [ ] **Step 1 : Lire** la zone du fetch `getMyClubPackages` (~`:95`), le rendu des chips (~`:172`), et l'appel `<BookingModal … packages={myPackages} … />`.

- [ ] **Step 2 : Ajouter l'état + fetch des abos** (à côté de `myPackages`)

```tsx
  const [mySubs, setMySubs] = useState<Subscription[]>([]);
  useEffect(() => {
    if (!token) { setMySubs([]); return; }
    api.getMyClubSubscriptions(club.slug, token).then(setMySubs).catch(() => setMySubs([]));
  }, [token, club.slug]);
```

- [ ] **Step 3 : Ajouter un chip « Abonné <sports> »** à côté des chips de solde (dans le même conteneur, après le map des packages)

```tsx
    {mySubs.map((s) => (
      <Chip key={s.id}>Abonné {s.sportKeys.join('/')}{s.offPeakOnly ? ' · heures creuses' : ''}</Chip>
    ))}
```

- [ ] **Step 4 : Passer `subscriptions={mySubs}` à `<BookingModal>`** (à côté de `packages={myPackages}`).

- [ ] **Step 5 : Imports (`Subscription`). Typecheck + commit.**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

```bash
git add frontend/components/ClubReserve.tsx
git commit -m "feat(abonnements): chip Abonné sur Réserver + passe les abos au BookingModal"
```

---

## Task F6 : BookingModal — couverture au booking (+ test)

**Files:** Modify `frontend/components/BookingModal.tsx`, Create `frontend/__tests__/BookingModal.subscription.test.tsx`

- [ ] **Step 1 : Lire** `BookingModal.tsx` : la prop `slot: TimeSlot` (vérifier dans `lib/api.ts` que `TimeSlot` expose **`offPeak: boolean`** ; sinon, dériver via le prix), les props `sportKey?`/`packages?`, l'état `paySource`, et l'appel `api.confirmReservation(reservation.id, token, paySource ? { paymentSource: { packageId: paySource } } : undefined)`.

- [ ] **Step 2 : Écrire le test qui échoue** (`frontend/__tests__/BookingModal.subscription.test.tsx`) — mirroir de `BookingModal.packages.test.tsx`

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../lib/api', () => ({
  api: {
    holdSlot: jest.fn(),
    confirmReservation: jest.fn(),
    getMyClubMembership: jest.fn(),
  },
  assetUrl: (p: string | null) => (p ? `http://localhost:3001${p}` : null),
}));
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

import { BookingModal } from '../components/BookingModal';

const sub = {
  id: 'sub-1', planId: 'plan-1', status: 'ACTIVE', startedAt: '', expiresAt: '',
  monthlyPriceSnapshot: '69', sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED',
  discountPercent: null, dailyCap: null, weeklyCap: null, plan: { name: 'Abo Padel' },
};

beforeEach(() => {
  api.holdSlot.mockResolvedValue({ id: 'res-1', status: 'PENDING' });
  api.confirmReservation.mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
  api.getMyClubMembership.mockResolvedValue(null);
});

it('créneau creux couvert : confirme avec paymentSource subscriptionId', async () => {
  render(
    <BookingModal
      slot={{ start: '2026-07-01T08:00:00Z', end: '2026-07-01T09:30:00Z', price: '13.00', offPeak: true } as any}
      resourceId="court-1" price="13.00" duration={90} token="jwt" slug="mon-club"
      sportKey="padel" subscriptions={[sub] as any} packages={[] as any}
      onClose={() => {}} onConfirmed={() => {}}
    />,
  );
  // Le bloc « couvert par votre abonnement » est visible et sélectionné par défaut.
  expect(await screen.findByText(/abonnement/i)).toBeInTheDocument();
  // Lancer la réservation (le label exact du bouton de confirmation dépend du composant — adapter au besoin).
  fireEvent.click(await screen.findByRole('button', { name: /r[ée]server|confirmer/i }));
  await waitFor(() => {
    expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt', { paymentSource: { subscriptionId: 'sub-1' } });
  });
});
```

> Note : adapte les noms de boutons/labels au composant réel après l'avoir lu. L'assertion clé est l'appel `confirmReservation(..., { paymentSource: { subscriptionId: 'sub-1' } })`.

- [ ] **Step 3 : Lancer → échec.** `cd frontend && npx jest BookingModal.subscription`

- [ ] **Step 4 : Implémenter la couverture** dans `BookingModal.tsx` :
  1. Ajouter la prop `subscriptions?: Subscription[]` (défaut `[]`).
  2. Calculer `const isOffPeak = slot.offPeak ?? false;` (utiliser le champ `TimeSlot.offPeak` ; le confirmer à l'étape 1).
  3. `const cover = coveringSubscription(subscriptions ?? [], { sportKey: sportKey ?? '', isOffPeak });` (import depuis `@/lib/subscriptions`).
  4. État `const [useSub, setUseSub] = useState(false);` initialisé à `true` quand `cover` existe (via un `useEffect` sur `cover?.id`). Quand `useSub` est vrai, désélectionner tout `paySource` package.
  5. Si `cover`, afficher un bloc « Couvert par votre abonnement — {coverageLabel(cover)} » (case cochée par défaut) au-dessus des options de paiement prépayé.
  6. Dans le handler de confirmation : `const paymentSource = useSub && cover ? { subscriptionId: cover.id } : paySource ? { packageId: paySource } : undefined;` puis `api.confirmReservation(reservation.id, token, paymentSource ? { paymentSource } : undefined)`.

- [ ] **Step 5 : Lancer → succès** (`npx jest BookingModal.subscription`) + typecheck.

Run: `cd frontend && npx jest BookingModal && npx tsc --noEmit 2>&1 | head -20`
Expected: vert + pas d'erreur (ne pas casser `BookingModal.packages.test.tsx`).

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/BookingModal.tsx frontend/__tests__/BookingModal.subscription.test.tsx
git commit -m "feat(abonnements): couverture appliquée au booking (BookingModal → subscriptionId)"
```

---

## Task F7 : ProfileMenu — abonnements actifs

**Files:** Modify `frontend/components/ProfileMenu.tsx`

- [ ] **Step 1 : Lire** la zone de fetch (`getMyClubPackages`, ~`:53`) et le bloc « Mes soldes » (~`:131`).

- [ ] **Step 2 : Ajouter l'état + fetch des abos** (à côté de `packages`)

```tsx
  const [subs, setSubs] = useState<Subscription[]>([]);
  // dans le même bloc que getMyClubPackages :
  //   api.getMyClubSubscriptions(slug, token).then(setSubs).catch(() => {});
```

- [ ] **Step 3 : Ajouter un bloc « Mes abonnements »** sous « Mes soldes »

```tsx
  {subs.length > 0 && (
    <div style={{ borderBottom: `1px solid ${th.line}`, paddingBottom: 10 }}>
      <div style={sectionTitle}>Mes abonnements</div>
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
        {subs.map((s) => <span key={s.id}>{s.plan.name}</span>)}
      </div>
    </div>
  )}
```

- [ ] **Step 4 : Imports (`Subscription`). Typecheck + commit.**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

```bash
git add frontend/components/ProfileMenu.tsx
git commit -m "feat(abonnements): abonnements actifs dans le ProfileMenu"
```

---

## Task F8 : Vérification finale frontend

- [ ] **Step 1 : Typecheck complet**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: aucune erreur.

- [ ] **Step 2 : Suite de tests frontend**

Run: `cd frontend && npx jest 2>&1 | tail -15`
Expected: tous verts (dont `subscriptions.test`, `BookingModal.subscription`, et les suites existantes intactes — notamment `BookingModal.packages`, `MeProfile`, `ProfileMenu`).

- [ ] **Step 3 : Lint (si configuré)**

Run: `cd frontend && npx eslint . 2>&1 | head -20`
Expected: pas de nouvelle erreur (warnings tolérés).

- [ ] **Step 4 : Commit éventuel** des correctifs, sinon rien.

---

## Notes de cohérence

- `SUBSCRIPTION` reste **hors** de `MONEY_METHODS`/`SALE_METHODS` en caisse → exclu du total encaissé ; un libellé existe dans `METHOD_LABEL`. La couverture au booking crée un paiement `SUBSCRIPTION` (backend), donc le « reste dû » tombe à 0 (INCLUDED) ou au reste (DISCOUNT), affiché par la caisse existante.
- Le **prix affiché** du créneau ne change pas (la gratuité est un paiement « sans argent »).
- Si `TimeSlot` n'expose pas `offPeak`, dériver `isOffPeak` côté `ClubReserve` (qui a `club.offPeakHours` + `timezone`) via `splitOffPeakMinutes(...).peakMin === 0` de `lib/caisse.ts` et le passer en prop au BookingModal — sinon utiliser `slot.offPeak` directement.
