# Encaissement par porte-monnaie / carnet en paiement rapide — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre d'encaisser la part d'un joueur (ou le total) avec son porte-monnaie/carnet en 1 clic sur la page Encaissement, et corriger la modale d'encaissement pour que le porte-monnaie respecte le montant affiché.

**Architecture:** Le backend `addPayment` sait déjà encaisser un montant partiel en `WALLET`/`PACK_CREDIT` avec `sourcePackageId` + `participantId`. On ajoute un endpoint de lecture en masse des soldes actifs du club, on indexe ces soldes par joueur côté front (`packagesByUser`), et les composants d'encaissement (`ReservationCollect`, `CollectPanel`) affichent un bouton prépayé contextuel pour le joueur concerné.

**Tech Stack :** Backend Express + Prisma (`PackageService`), front Next.js/React (composants admin), Jest + React Testing Library.

**Spec :** `docs/superpowers/specs/2026-06-25-encaissement-porte-monnaie-rapide-design.md`

---

## Fichiers touchés

- **Create** `frontend/__tests__/packages.test.ts` — tests du helper `pickPackageFor`.
- **Modify** `backend/src/services/package.service.ts` — `listActiveByClub`.
- **Modify** `backend/src/services/__tests__/package.service.test.ts` — test `listActiveByClub`.
- **Modify** `backend/src/routes/admin.ts` — route `GET /packages/active`.
- **Modify** `frontend/lib/api.ts` — type `ActiveMemberPackage` + `adminGetActivePackages`.
- **Modify** `frontend/lib/packages.ts` — `pickPackageFor` + `indexPackagesByUser`.
- **Modify** `frontend/app/admin/reservations/page.tsx` — charge/recharge/passe `packagesByUser`.
- **Modify** `frontend/app/admin/planning/page.tsx` — charge/passe `packagesByUser`.
- **Modify** `frontend/components/admin/ReservationCollect.tsx` — bouton prépayé par joueur + `pay(... sourcePackageId)`.
- **Modify** `frontend/components/admin/CollectPanel.tsx` — prop `packagesByUser`, fix montant, promotion en primaire.
- **Modify** `frontend/__tests__/AdminReservations.test.tsx` — mock `adminGetActivePackages` + test porte-monnaie par joueur.
- **Modify** `frontend/__tests__/CollectPanel.test.tsx` — passe `packagesByUser` + test « honore le montant ».

---

### Task 1 : Backend — `PackageService.listActiveByClub`

**Files:**
- Modify: `backend/src/services/package.service.ts`
- Test: `backend/src/services/__tests__/package.service.test.ts`

- [ ] **Step 1 : Écrire le test (qui échoue)**

Ajouter à la fin de `backend/src/services/__tests__/package.service.test.ts` :

```typescript
describe('PackageService — listActiveByClub', () => {
  it('interroge les soldes utilisables du club et expose userId', async () => {
    prismaMock.memberPackage.findMany.mockResolvedValue([
      { id: 'pk-1', userId: 'u1', kind: 'WALLET', amountRemaining: new Prisma.Decimal(130) } as any,
    ]);
    const svc = new PackageService();
    const rows = await svc.listActiveByClub('club-1');
    const arg = prismaMock.memberPackage.findMany.mock.calls[0][0] as any;
    expect(arg.where.clubId).toBe('club-1');
    expect(arg.select.userId).toBe(true);
    // filtre expirés + soldes à zéro
    expect(JSON.stringify(arg.where)).toContain('expiresAt');
    expect(JSON.stringify(arg.where)).toContain('amountRemaining');
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `npm --prefix backend test -- package.service`
Expected: FAIL — `listActiveByClub is not a function`.

- [ ] **Step 3 : Implémenter `listActiveByClub`**

Dans `backend/src/services/package.service.ts`, juste après `listMyPackagesBySlug` (avant `// --- Caisse du jour & tickets CE ---`), ajouter :

```typescript
  /**
   * Soldes ACTIFS (utilisables) de tout le club, avec userId — pour les boutons
   * d'encaissement rapide par joueur. Même filtre que `listMyPackagesBySlug`.
   */
  async listActiveByClub(clubId: string) {
    const now = new Date();
    return prisma.memberPackage.findMany({
      where: {
        clubId,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          { OR: [{ creditsRemaining: { gte: 1 } }, { amountRemaining: { gt: 0 } }] },
        ],
      },
      orderBy: { purchasedAt: 'asc' },
      select: {
        id: true, userId: true, kind: true,
        creditsTotal: true, creditsRemaining: true,
        amountTotal: true, amountRemaining: true,
        purchasedAt: true, expiresAt: true,
        template: { select: { name: true } },
      },
    });
  }
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `npm --prefix backend test -- package.service`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/package.service.ts backend/src/services/__tests__/package.service.test.ts
git commit -m "feat(caisse): PackageService.listActiveByClub (soldes actifs du club)"
```

---

### Task 2 : Backend — route `GET /packages/active`

**Files:**
- Modify: `backend/src/routes/admin.ts`

- [ ] **Step 1 : Ajouter la route**

Dans `backend/src/routes/admin.ts`, juste après le bloc `router.patch('/packages/templates/:id', ...)` (vers la ligne 748), ajouter :

```typescript
// Soldes actifs du club (pour les boutons d'encaissement rapide par joueur).
router.get('/packages/active', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await packageService.listActiveByClub(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
```

> La route est un wrapper mince identique aux autres routes `/packages/*` (pas de
> test de route dédié — il n'existe pas de `admin.packages.routes.test.ts` ; la
> logique est couverte par le test service de la Task 1).

- [ ] **Step 2 : Vérifier la compilation TypeScript**

Run: `npm --prefix backend run build` (ou `npx --prefix backend tsc --noEmit`)
Expected: pas d'erreur de type.

- [ ] **Step 3 : Commit**

```bash
git add backend/src/routes/admin.ts
git commit -m "feat(caisse): route GET /clubs/:clubId/admin/packages/active"
```

---

### Task 3 : Frontend — type + appel API

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1 : Ajouter le type `ActiveMemberPackage`**

Dans `frontend/lib/api.ts`, juste après l'interface `MemberPackage` (vers la ligne 1397-1410), ajouter :

```typescript
/** Solde actif renvoyé par l'endpoint de masse — porte en plus le userId du joueur. */
export type ActiveMemberPackage = MemberPackage & { userId: string };
```

- [ ] **Step 2 : Ajouter la méthode API**

Dans l'objet `api`, juste après `adminGetMemberPackages` (vers la ligne 364-365), ajouter :

```typescript
  adminGetActivePackages: (clubId: string, token: string) =>
    request<ActiveMemberPackage[]>(`/api/clubs/${clubId}/admin/packages/active`, {}, token),
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx --prefix frontend tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(caisse): api.adminGetActivePackages + type ActiveMemberPackage"
```

---

### Task 4 : Frontend — helpers `pickPackageFor` + `indexPackagesByUser`

**Files:**
- Modify: `frontend/lib/packages.ts`
- Test: `frontend/__tests__/packages.test.ts` (création)

- [ ] **Step 1 : Écrire les tests (qui échouent)**

Créer `frontend/__tests__/packages.test.ts` :

```typescript
import { pickPackageFor, indexPackagesByUser } from '../lib/packages';
import type { MemberPackage, ActiveMemberPackage } from '../lib/api';

const wallet = (over: Partial<MemberPackage> = {}): MemberPackage => ({
  id: 'pk-w', kind: 'WALLET', creditsTotal: null, creditsRemaining: null,
  amountTotal: '130.00', amountRemaining: '130.00', purchasedAt: '', expiresAt: null, ...over,
} as MemberPackage);
const carnet = (over: Partial<MemberPackage> = {}): MemberPackage => ({
  id: 'pk-c', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 5,
  amountTotal: null, amountRemaining: null, purchasedAt: '', expiresAt: null, ...over,
} as MemberPackage);

describe('pickPackageFor', () => {
  it('porte-monnaie choisi s\'il couvre le montant', () => {
    expect(pickPackageFor([wallet()], 1300)?.id).toBe('pk-w');
  });
  it('porte-monnaie écarté si le solde ne couvre pas', () => {
    expect(pickPackageFor([wallet({ amountRemaining: '5.00' })], 1300)).toBeNull();
  });
  it('carnet toujours choisi tant qu\'il a une entrée', () => {
    expect(pickPackageFor([carnet()], 999999)?.id).toBe('pk-c');
  });
  it('filtre par kind', () => {
    expect(pickPackageFor([carnet(), wallet()], 1300, 'WALLET')?.id).toBe('pk-w');
  });
  it('liste vide → null', () => {
    expect(pickPackageFor([], 1300)).toBeNull();
  });
  it('ignore un solde expiré', () => {
    expect(pickPackageFor([wallet({ expiresAt: '2000-01-01T00:00:00.000Z' })], 1300)).toBeNull();
  });
});

describe('indexPackagesByUser', () => {
  it('groupe les soldes actifs par userId', () => {
    const rows = [
      { ...wallet(), id: 'a', userId: 'u1' },
      { ...carnet(), id: 'b', userId: 'u1' },
      { ...wallet(), id: 'c', userId: 'u2' },
    ] as ActiveMemberPackage[];
    const map = indexPackagesByUser(rows);
    expect(map['u1'].map((p) => p.id)).toEqual(['a', 'b']);
    expect(map['u2'].map((p) => p.id)).toEqual(['c']);
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm --prefix frontend test -- packages.test`
Expected: FAIL — `pickPackageFor is not a function` / `indexPackagesByUser is not a function`.

- [ ] **Step 3 : Implémenter les helpers**

À la fin de `frontend/lib/packages.ts`, ajouter (les imports `canCover` existent déjà dans le fichier) :

```typescript
import type { ActiveMemberPackage } from '@/lib/api';

/**
 * Choisit le 1ᵉʳ solde utilisable d'un joueur capable de couvrir `amountCents`.
 * `kind` filtre éventuellement (ENTRIES / WALLET). null si aucun ne convient.
 */
export function pickPackageFor(
  packages: MemberPackage[],
  amountCents: number,
  kind?: 'ENTRIES' | 'WALLET',
  now: Date = new Date(),
): MemberPackage | null {
  const amount = amountCents / 100;
  for (const p of packages) {
    if (kind && p.kind !== kind) continue;
    if (canCover(p, amount, now)) return p;
  }
  return null;
}

/** Indexe les soldes actifs (avec userId) par joueur, ordre conservé. */
export function indexPackagesByUser(rows: ActiveMemberPackage[]): Record<string, ActiveMemberPackage[]> {
  const map: Record<string, ActiveMemberPackage[]> = {};
  for (const p of rows) (map[p.userId] ??= []).push(p);
  return map;
}
```

> Note : `import type { MemberPackage }` est déjà en tête du fichier. Ajouter
> l'import `ActiveMemberPackage` en haut plutôt qu'au milieu si le linter du
> projet l'exige — placer `import type { MemberPackage, ActiveMemberPackage } from '@/lib/api';`.

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `npm --prefix frontend test -- packages.test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/packages.ts frontend/__tests__/packages.test.ts
git commit -m "feat(caisse): helpers pickPackageFor + indexPackagesByUser"
```

---

### Task 5 : Frontend — câblage de la page Encaissement (`packagesByUser`)

**Files:**
- Modify: `frontend/app/admin/reservations/page.tsx`
- Test: `frontend/__tests__/AdminReservations.test.tsx`

- [ ] **Step 1 : Mettre à jour le mock du test (ne pas casser l'existant)**

Dans `frontend/__tests__/AdminReservations.test.tsx`, dans l'objet `api` du `jest.mock('../lib/api', …)` (vers la ligne 21), ajouter après `adminGetMemberPackages` :

```typescript
    adminGetActivePackages: jest.fn().mockResolvedValue([]),
```

- [ ] **Step 2 : Lancer la suite, vérifier qu'elle passe encore (rouge attendu seulement si l'appel n'est pas câblé)**

Run: `npm --prefix frontend test -- AdminReservations`
Expected: PASS (l'app n'appelle pas encore `adminGetActivePackages`, le mock supplémentaire est inerte).

- [ ] **Step 3 : Câbler le chargement, le rechargement et le passage de prop**

Dans `frontend/app/admin/reservations/page.tsx` :

a) Importer le type et le helper. Modifier l'import `@/lib/api` (ligne 3) pour ajouter `MemberPackage`, et l'import `@/lib/caisse` (ligne 13) reste ; ajouter une ligne d'import :

```typescript
import { indexPackagesByUser } from '@/lib/packages';
```

b) Ajouter l'état (près de `const [members, setMembers] = …`, ligne 66) :

```typescript
  const [packagesByUser, setPackagesByUser] = useState<Record<string, MemberPackage[]>>({});
```

c) Dans `load()` (lignes 92-104), ajouter l'appel et le `set`. Remplacer le bloc :

```typescript
      const [detail, res, resv, mem] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetResources(clubId, token),
        api.adminGetReservations(clubId, date ? { date } : {}, token),
        api.adminGetMembers(clubId, token),
      ]);
      if (seq !== loadSeq.current) return resv.reservations;   // supplanté → ne pas écraser
      setClubDetail(detail);
      setTz(detail.timezone);
      setPeak(detail.offPeakHours ?? null);
      setResources(res.filter((r) => r.isActive));
      setMembers(mem);
      setData(resv);
```

par :

```typescript
      const [detail, res, resv, mem, pkgs] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetResources(clubId, token),
        api.adminGetReservations(clubId, date ? { date } : {}, token),
        api.adminGetMembers(clubId, token),
        api.adminGetActivePackages(clubId, token),
      ]);
      if (seq !== loadSeq.current) return resv.reservations;   // supplanté → ne pas écraser
      setClubDetail(detail);
      setTz(detail.timezone);
      setPeak(detail.offPeakHours ?? null);
      setResources(res.filter((r) => r.isActive));
      setMembers(mem);
      setPackagesByUser(indexPackagesByUser(pkgs));
      setData(resv);
```

d) Ajouter un rechargement léger des soldes après `reloadReservations` (après la ligne 123) :

```typescript
  // Recharge les soldes prépayés (après un encaissement par carnet/porte-monnaie,
  // pour que le solde affiché baisse). Best-effort.
  const reloadPackages = useCallback(async () => {
    if (!token || !clubId) return;
    try { setPackagesByUser(indexPackagesByUser(await api.adminGetActivePackages(clubId, token))); }
    catch { /* ignore */ }
  }, [token, clubId]);
```

e) Faire réconcilier les soldes. Remplacer `onMutated` (lignes 133-136) :

```typescript
  const onMutated = useCallback(async (updated?: ClubReservation) => {
    if (updated) patchReservation(updated);
    else await Promise.all([reloadReservations(), reloadPackages()]);
  }, [patchReservation, reloadReservations, reloadPackages]);
```

f) Idem pour la modale `refreshSelected` (lignes 170-174) :

```typescript
  const refreshSelected = useCallback(async (updated?: ClubReservation) => {
    if (updated) { patchReservation(updated); setSelected(updated); return; }
    const [list] = await Promise.all([reloadReservations(), reloadPackages()]);
    setSelected((cur) => (cur ? list.find((r) => r.id === cur.id) ?? cur : cur));
  }, [reloadReservations, patchReservation, reloadPackages]);
```

g) Passer la prop à `ReservationCollect` (ligne 309) — ajouter `packagesByUser={packagesByUser}` :

```typescript
          <ReservationCollect reservation={r} players={playersOf(r)} due={due} members={members} quickMethods={quickMethods}
            packagesByUser={packagesByUser}
            clubId={clubId!} token={token!} onChanged={onMutated}
            onOptimisticPay={(intent) => applyPaymentLocally(r.id, intent)}
            onOptimisticRefund={(ids) => applyRefundLocally(r.id, ids)}
            onOpenDetails={() => setSelected(r)}
            onCancel={() => setConfirmCancel(r)} onError={(m) => setError(m)} />
```

h) Passer la prop à `CollectPanel` (ligne 441) — ajouter `packagesByUser={packagesByUser}` :

```typescript
              <CollectPanel reservation={selected} due={dueOf(selected)} players={playersOf(selected)} members={members} quickMethods={quickMethods} packagesByUser={packagesByUser} clubId={clubId!} token={token!} onChanged={refreshSelected} onError={(msg) => setError(msg)} />
```

> Les props `packagesByUser` n'existent pas encore sur les composants → erreurs TS
> attendues, levées aux Tasks 6 et 7. La suite de tests de cette task ne dépend
> que du mock `adminGetActivePackages` ([]) ; les tests passent (aucun bouton
> prépayé).

- [ ] **Step 4 : Lancer la suite (doit toujours passer)**

Run: `npm --prefix frontend test -- AdminReservations`
Expected: PASS (les composants acceptent une prop inconnue sans planter au runtime ; TS sera vert après Tasks 6-7).

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/admin/reservations/page.tsx frontend/__tests__/AdminReservations.test.tsx
git commit -m "feat(caisse): page Encaissement charge et passe packagesByUser"
```

---

### Task 6 : Frontend — bouton prépayé par joueur dans `ReservationCollect`

**Files:**
- Modify: `frontend/components/admin/ReservationCollect.tsx`
- Test: `frontend/__tests__/AdminReservations.test.tsx`

- [ ] **Step 1 : Écrire le test (qui échoue)**

Ajouter dans `frontend/__tests__/AdminReservations.test.tsx` (après le test « encaisse la part d'un seul joueur ») :

```typescript
it("paie la part d'un joueur avec son porte-monnaie (WALLET + sourcePackageId + participantId)", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([{ id: 'court-1', name: 'C1', attributes: { format: 'single' }, isActive: true, price: '26.00', offPeakPrice: null, openHour: 8, closeHour: 22, slotStepMin: null, clubSport: { id: 'cs', slotStepMin: null, durationsMin: [60], sport: { key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } } }]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue({ reservations: [
    { id: 'rv-2', resourceId: 'court-1', startTime: '2099-06-22T16:00:00.000Z', endTime: '2099-06-22T17:00:00.000Z', status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '26.00', paidAmount: '0.00', dueAmount: '26.00', resource: { id: 'court-1', name: 'C1' }, user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' }, payments: [], participants: [
      { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '0.00', outstanding: '13.00' },
      { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', share: '13.00', paid: '0.00', outstanding: '13.00' },
    ] },
  ], summary: { total: '26', paid: '0', paidTotal: '0', outstanding: '26' } });
  (api.adminGetActivePackages as jest.Mock).mockResolvedValue([
    { id: 'pk-w', userId: 'u1', kind: 'WALLET', creditsTotal: null, creditsRemaining: null, amountTotal: '130.00', amountRemaining: '130.00', purchasedAt: '', expiresAt: null },
  ]);
  renderPage();
  await screen.findByText('C1');
  // 1re occurrence = ligne du joueur pt-1 (u1). pt-2 (u2) n'a pas de solde → pas de bouton.
  fireEvent.click(screen.getAllByRole('button', { name: /Porte-monnaie/ })[0]);
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
    'club-1', 'rv-2', expect.objectContaining({ method: 'WALLET', sourcePackageId: 'pk-w', participantId: 'pt-1', amount: 13 }), 'tok',
  ));
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `npm --prefix frontend test -- AdminReservations`
Expected: FAIL — aucun bouton « Porte-monnaie » trouvé.

- [ ] **Step 3 : Implémenter le bouton prépayé**

Dans `frontend/components/admin/ReservationCollect.tsx` :

a) Ajouter l'import du helper en tête (après l'import `lib/caisse`, ligne 4) :

```typescript
import { pickPackageFor, packageLabel } from '@/lib/packages';
import type { MemberPackage } from '@/lib/api';
```

b) Ajouter la prop à l'interface `ReservationCollectProps` (après `quickMethods: PaymentMethod[];`, ligne 36) :

```typescript
  /** soldes prépayés utilisables, indexés par userId (boutons porte-monnaie/carnet). */
  packagesByUser?: Record<string, MemberPackage[]>;
```

c) La déstructurer dans la signature du composant (ligne 58) — ajouter `packagesByUser` :

```typescript
export function ReservationCollect({ reservation, players, due, members, quickMethods, packagesByUser, clubId, token, onChanged, onOptimisticPay, onOptimisticRefund, onOpenDetails, onCancel, onError }: ReservationCollectProps) {
```

d) Étendre `pay` (lignes 116-126) pour porter un `sourcePackageId` :

```typescript
  const pay = (amountCents: number, method: PaymentMethod, participantId?: string, sourcePackageId?: string) => {
    if (amountCents <= 0) return;
    onOptimisticPay?.({ amountCents, method, participantId: participantId ?? null });
    enqueue(async () => {
      try {
        const body: AddPaymentBody = { amount: amountCents / 100, method };
        if (participantId) body.participantId = participantId;
        if (sourcePackageId) body.sourcePackageId = sourcePackageId;
        await api.adminAddPayment(clubId, reservation.id, body, token);
      } catch (e) { onError(mapPayError(e, !!participantId)); }
    });
  };
```

e) Étendre `quickRow` (lignes 197-212) pour ajouter un bouton prépayé contextuel. Remplacer toute la fonction par :

```typescript
  const quickRow = (amountCents: number, participantId?: string, userId?: string, allowEntries = true) => {
    const pkgs = userId ? (packagesByUser?.[userId] ?? []) : [];
    // Porte-monnaie d'abord (débit € exact) ; carnet seulement si autorisé (1 entrée = 1 part).
    const pk = pickPackageFor(pkgs, amountCents, 'WALLET') ?? (allowEntries ? pickPackageFor(pkgs, amountCents, 'ENTRIES') : null);
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {methods.map((m) => {
          const primary = m === methods[0];
          return (
            <button key={m} type="button" disabled={anyBusy} onClick={() => pay(amountCents, m, participantId)}
              style={{ height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0 11px', border: 'none', borderRadius: 9,
                cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.5 : 1,
                background: primary ? th.accent : th.surface, color: primary ? th.onAccent : th.text,
                boxShadow: primary ? 'none' : `inset 0 0 0 1.5px ${th.lineStrong}`, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
              <Icon name={METHOD_ICON[m]} size={13} color={primary ? th.onAccent : th.textMute} />{QUICK_METHOD_LABEL[m]}
            </button>
          );
        })}
        {pk && (
          <button key="prepaid" type="button" disabled={anyBusy}
            onClick={() => pay(amountCents, pk.kind === 'ENTRIES' ? 'PACK_CREDIT' : 'WALLET', participantId, pk.id)}
            title={`Régler avec ${packageLabel(pk)}`}
            style={{ height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0 11px', border: 'none', borderRadius: 9,
              cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.5 : 1, background: th.surface, color: th.text,
              boxShadow: `inset 0 0 0 1.5px ${th.accent}`, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
            <Icon name="ticket" size={13} color={th.accent} />{pk.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie'}
          </button>
        )}
      </div>
    );
  };
```

f) Passer le `userId` (et `allowEntries`) aux appels de `quickRow`. Modifier les 4 sites :

- Place vide (ligne 243) : inchangée — `quickRow(shareAmt)` (place générique, pas de userId).
- Place titulaire (« holder », ligne 254) : remplacer `quickRow(shareAmt)` par
  `quickRow(shareAmt, undefined, reservation.user?.id ?? undefined, true)`.
- Place nommée (participant, ligne 272) : remplacer
  `quickRow(Math.min(playerRemaining, remaining), s.participantId)` par
  `quickRow(Math.min(playerRemaining, remaining), s.participantId, bills.find((b) => b.id === s.participantId)?.userId, true)`.
- Ligne « Tout solder » (ligne 288) : remplacer `quickRow(remaining)` par
  `quickRow(remaining, undefined, reservation.user?.id ?? undefined, false)`.

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `npm --prefix frontend test -- AdminReservations`
Expected: PASS (nouveau test + tous les existants).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/admin/ReservationCollect.tsx frontend/__tests__/AdminReservations.test.tsx
git commit -m "feat(caisse): bouton porte-monnaie/carnet par joueur sur la page Encaissement"
```

---

### Task 7 : Frontend — `CollectPanel` (prop, fix montant, promotion)

**Files:**
- Modify: `frontend/components/admin/CollectPanel.tsx`
- Test: `frontend/__tests__/CollectPanel.test.tsx`

- [ ] **Step 1 : Mettre à jour les tests existants + ajouter le test de non-régression**

Dans `frontend/__tests__/CollectPanel.test.tsx` :

a) Remplacer le test « paiement par carnet » (lignes 81-91) par une version qui passe `packagesByUser` :

```typescript
  it('paiement par carnet → adminAddPayment en PACK_CREDIT avec sourcePackageId', async () => {
    const carnet = { id: 'pk-1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 5, amountTotal: null, amountRemaining: null, purchasedAt: '', expiresAt: null };
    renderPanel(
      { user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' } },
      { packagesByUser: { u1: [carnet] } },
    );
    const btn = await screen.findByRole('button', { name: /Carnet/ });
    fireEvent.click(btn);
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ method: 'PACK_CREDIT', sourcePackageId: 'pk-1', amount: 52 }), 'tok',
    ));
  });

  it('porte-monnaie : encaisse le montant affiché (« / joueur »), pas le total', async () => {
    const wallet = { id: 'pk-w', kind: 'WALLET', creditsTotal: null, creditsRemaining: null, amountTotal: '130.00', amountRemaining: '130.00', purchasedAt: '', expiresAt: null };
    renderPanel(
      { user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' } },
      { packagesByUser: { u1: [wallet] } },
    );
    fireEvent.click(screen.getByRole('button', { name: '/ joueur 13 €' }));
    fireEvent.click(screen.getByRole('button', { name: /Porte-monnaie/ }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ method: 'WALLET', sourcePackageId: 'pk-w', amount: 13 }), 'tok',
    ));
  });
```

- [ ] **Step 2 : Lancer la suite, vérifier l'échec**

Run: `npm --prefix frontend test -- CollectPanel`
Expected: FAIL — la prop `packagesByUser` n'existe pas / le bouton n'apparaît pas / le porte-monnaie encaisse 52 au lieu de 13.

- [ ] **Step 3 : Implémenter les changements**

Dans `frontend/components/admin/CollectPanel.tsx` :

a) Ajouter la prop à `CollectPanelProps` (après `quickMethods?`, ligne 30) :

```typescript
  /** soldes prépayés utilisables, indexés par userId (résolus pour la cible courante). */
  packagesByUser?: Record<string, MemberPackage[]>;
```

b) La déstructurer dans la signature (ligne 38) — ajouter `packagesByUser` :

```typescript
export function CollectPanel({ reservation, due, players, members, clubId, token, quickMethods, packagesByUser, onChanged, onPaid, onError }: CollectPanelProps) {
```

c) Supprimer l'état et l'effet de fetch interne. Retirer les lignes 50-51 :

```typescript
  const [selPackages, setSelPackages] = useState<MemberPackage[]>([]);
  const [pkgLoading, setPkgLoading] = useState(false);
```

et retirer tout le bloc effet (lignes 66-75) :

```typescript
  // Carnets/porte-monnaie utilisables du joueur de la résa.
  const userId = reservation.user?.id ?? null;
  useEffect(() => {
    if (!userId) { setSelPackages([]); return; }
    setPkgLoading(true);
    api.adminGetMemberPackages(clubId, userId, token)
      .then((pkgs) => setSelPackages(pkgs.filter((p) => isUsable(p))))
      .catch(() => setSelPackages([]))
      .finally(() => setPkgLoading(false));
  }, [userId, clubId, token]);
```

d) Calculer `selPackages` depuis la map, pour la cible courante. Après la ligne `const settled = …;` (ligne 85), ajouter :

```typescript
  // Soldes prépayés utilisables de la cible courante (joueur sélectionné, sinon titulaire).
  const targetUserId = activePart?.userId ?? reservation.user?.id ?? null;
  const selPackages = (targetUserId ? (packagesByUser?.[targetUserId] ?? []) : []).filter((p) => isUsable(p));
```

e) Corriger `payWithPackage` (lignes 107-123) — encaisser le montant affiché :

```typescript
  const payWithPackage = async (pkg: MemberPackage) => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { fail('Montant invalide.'); return; }
    setBusy(true);
    try {
      await api.adminAddPayment(clubId, reservation.id, {
        amount,
        method: pkg.kind === 'ENTRIES' ? 'PACK_CREDIT' : 'WALLET',
        sourcePackageId: pkg.id,
        participantId: payParticipantId ?? undefined,
      }, token);
      setPayParticipantId(null);
      onChanged(); onPaid?.();
    } catch (e) {
      fail((e as Error).message === 'INSUFFICIENT_BALANCE' ? 'Solde du package insuffisant.'
        : (e as Error).message === 'PAYMENT_EXCEEDS_DUE' ? (payParticipantId ? 'Le montant dépasse la part du joueur.' : 'Le montant dépasse le prix de la réservation.')
        : (e as Error).message);
    } finally { setBusy(false); }
  };
```

f) Supprimer `coverAmt` (ligne 190) :

```typescript
  const coverAmt = activePart ? toCents(activePart.outstanding) / 100 : remaining / 100;
```

g) Promouvoir les boutons prépayés dans la rangée primaire. Dans le bloc de la rangée des moyens primaires (lignes 333-345), ajouter les boutons prépayés **après** le `.map(primaryMethods)`, à l'intérieur du même `<div>` :

```typescript
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {primaryMethods.map((m) => (
              <button key={m} type="button" disabled={cannotPay} title={capTitle}
                onClick={() => (m === 'VOUCHER' ? setVoucherOpen((v) => !v) : payNow(m))}
                style={{ flex: '1 1 130px', minWidth: 124, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', borderRadius: 11,
                  cursor: cannotPay ? 'default' : 'pointer', opacity: cannotPay ? 0.45 : 1, background: th.accent, color: th.onAccent,
                  fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, boxShadow: th.neon ? `0 6px 20px ${th.accent}33` : 'none',
                  outline: m === 'VOUCHER' && voucherOpen ? `2px solid ${th.text}` : 'none', outlineOffset: 2 }}>
                {METHOD_ICON[m] && <Icon name={METHOD_ICON[m]!} size={16} color={th.onAccent} />}
                {METHOD_LABEL[m]}
              </button>
            ))}
            {selPackages.map((p) => {
              const ok = !cannotPay && canCover(p, amountC / 100);
              return (
                <button key={p.id} type="button" disabled={!ok} title={ok ? `Régler avec ${packageLabel(p)}` : 'Solde insuffisant'}
                  onClick={() => payWithPackage(p)}
                  style={{ flex: '1 1 130px', minWidth: 124, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', borderRadius: 11,
                    cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.45, background: th.accent, color: th.onAccent,
                    fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, boxShadow: th.neon ? `0 6px 20px ${th.accent}33` : 'none' }}>
                  <Icon name="ticket" size={16} color={th.onAccent} />{packageLabel(p)}
                </button>
              );
            })}
          </div>
```

h) Remplacer l'ancien bloc « Carnets / porte-monnaie prépayés » du bas (lignes 374-392) par le seul message de repli :

```typescript
          {/* Repli : aucun solde prépayé utilisable pour la cible */}
          {selPackages.length === 0 && (() => {
            const msg = prepaidHint(!!targetUserId, 0, maxPayable);
            return msg ? <div style={{ marginTop: 14, fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>{msg}</div> : null;
          })()}
```

i) Nettoyer les imports inutiles : si `useEffect` n'est plus utilisé ailleurs dans le fichier, retirer-le de l'import `react` (ligne 2). Vérifier — `useEffect` reste utilisé pour la réinitialisation du montant (lignes 59-64), donc **le garder**. `adminGetMemberPackages` n'est plus appelé (c'était via `api`, pas un import nommé → rien à retirer).

- [ ] **Step 4 : Lancer la suite, vérifier le succès**

Run: `npm --prefix frontend test -- CollectPanel`
Expected: PASS (tests mis à jour + nouveau test + existants).

- [ ] **Step 5 : Vérifier la compilation TS de la page Encaissement (prop désormais reconnue)**

Run: `npx --prefix frontend tsc --noEmit`
Expected: pas d'erreur sur `ReservationCollect`/`CollectPanel` (les props `packagesByUser` existent maintenant).

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/admin/CollectPanel.tsx frontend/__tests__/CollectPanel.test.tsx
git commit -m "fix(caisse): CollectPanel honore le montant payé au porte-monnaie + bouton promu en primaire"
```

---

### Task 8 : Frontend — câblage de la page Planning

**Files:**
- Modify: `frontend/app/admin/planning/page.tsx`

- [ ] **Step 1 : Câbler le chargement et le passage de prop**

Dans `frontend/app/admin/planning/page.tsx` :

a) Ajouter l'import (près des autres imports `@/lib/...`) :

```typescript
import { indexPackagesByUser } from '@/lib/packages';
```

et s'assurer que `MemberPackage` est importé depuis `@/lib/api` (l'ajouter à l'import existant si absent).

b) Ajouter l'état (près de `const [quickMethods, …]`, ligne 95) :

```typescript
  const [packagesByUser, setPackagesByUser] = useState<Record<string, MemberPackage[]>>({});
```

c) Dans `load()` (lignes 133-144), ajouter l'appel et le `set`. Remplacer :

```typescript
      const [c, res, resv, mem] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetResources(clubId, token),
        api.adminGetReservations(clubId, { date }, token),
        api.adminGetMembers(clubId, token),
      ]);
      setTz(c.timezone);
      setPeak(c.offPeakHours ?? null);
      setQuickMethods(c.quickPaymentMethods?.length ? c.quickPaymentMethods : DEFAULT_QUICK_METHODS);
      setResources(res.filter((r) => r.isActive));
      setRes(resv.reservations);
      setMembers(mem);
```

par :

```typescript
      const [c, res, resv, mem, pkgs] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetResources(clubId, token),
        api.adminGetReservations(clubId, { date }, token),
        api.adminGetMembers(clubId, token),
        api.adminGetActivePackages(clubId, token),
      ]);
      setTz(c.timezone);
      setPeak(c.offPeakHours ?? null);
      setQuickMethods(c.quickPaymentMethods?.length ? c.quickPaymentMethods : DEFAULT_QUICK_METHODS);
      setResources(res.filter((r) => r.isActive));
      setRes(resv.reservations);
      setMembers(mem);
      setPackagesByUser(indexPackagesByUser(pkgs));
```

> `refreshSelected` appelle déjà `load()` → les soldes se rafraîchissent après un
> encaissement depuis la modale du planning, sans changement supplémentaire.

d) Passer la prop à `CollectPanel` (vers la ligne 598-609) — ajouter `packagesByUser={packagesByUser}` :

```typescript
                <CollectPanel
                  reservation={selected}
                  due={dueOf(selected)}
                  players={playersOf(selected)}
                  members={members}
                  quickMethods={quickMethods}
                  packagesByUser={packagesByUser}
                  clubId={clubId!}
                  token={token!}
                  onChanged={refreshSelected}
                  onPaid={() => setSelected(null)}
                  onError={(msg) => setError(msg)}
                />
```

- [ ] **Step 2 : Vérifier la compilation TS**

Run: `npx --prefix frontend tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 3 : Commit**

```bash
git add frontend/app/admin/planning/page.tsx
git commit -m "feat(caisse): planning passe packagesByUser au CollectPanel"
```

---

### Task 9 : Vérification finale (suites complètes)

**Files:** aucun (vérification)

- [ ] **Step 1 : Suite backend complète**

Run: `npm --prefix backend test`
Expected: PASS (dont `package.service`).

- [ ] **Step 2 : Suite frontend complète**

Run: `npm --prefix frontend test`
Expected: PASS (dont `packages`, `AdminReservations`, `CollectPanel`, `caisse`).

- [ ] **Step 3 : Type-check global front**

Run: `npx --prefix frontend tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 4 : (si tout vert) commit de clôture éventuel**

Aucun changement de code attendu ici ; si des ajustements ont été nécessaires
pour faire passer une suite, les committer avec un message `fix(caisse): …`.

---

## Self-review (rempli par l'auteur du plan)

- **Couverture spec :** endpoint masse (Task 1-2), type+API (Task 3), helpers (Task 4),
  bouton par joueur page (Task 5-6), fix modale + promotion (Task 7), planning (Task 8),
  règle carnet (`allowEntries=false` sur « Tout solder », Task 6.f). ✔
- **Pas de placeholder :** tout le code est fourni. ✔
- **Cohérence des types/signatures :** `pickPackageFor(packages, amountCents, kind?, now?)`,
  `indexPackagesByUser(rows)`, `pay(amountCents, method, participantId?, sourcePackageId?)`,
  prop `packagesByUser?: Record<string, MemberPackage[]>` sur les deux composants. ✔
- **Décision actée :** la modale n'utilise PLUS `adminGetMemberPackages` (fetch interne
  remplacé par la prop `packagesByUser`) — le test carnet est mis à jour en conséquence (Task 7.a). ✔
