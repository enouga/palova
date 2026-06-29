# Réserver — payer avec son solde + voir ce qu'il reste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur le `BookingModal` joueur, afficher le solde restant projeté à la sélection d'un carnet/porte-monnaie, signaler un porte-monnaie insuffisant, et confirmer en rappelant le moyen utilisé + le restant.

**Architecture:** 100 % frontend. La consommation est déterministe (carnet −1 entrée, porte-monnaie −total€), donc le restant se calcule côté client à partir du `MemberPackage` sélectionné et du `totalEuros` du modal. Deux helpers purs dans `lib/packages.ts`, branchés dans `BookingModal`, et un résumé optionnel remonté à `ClubReserve` via `onConfirmed`. Aucun changement backend, aucune migration.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Jest + React Testing Library.

> ⚠️ **Commits :** la copie de travail sur `main` contient des changements en cours **non liés** (ClubNav, QuotaStatus, StatPill…). Ne committer **que si l'utilisateur le demande** ; créer d'abord une branche de feature ; faire `git add` **uniquement des fichiers listés** dans chaque tâche — **jamais** `git add -A`.

---

## File Structure

- `frontend/lib/packages.ts` — **Modify** : +`remainingAfterLabel`, +`paidWithLabel` (helpers purs).
- `frontend/__tests__/packages.test.ts` — **Modify** : tests des 2 helpers.
- `frontend/components/BookingModal.tsx` — **Modify** : projection à la sélection (Avenue 3), mention « solde insuffisant », résumé passé à `onConfirmed`, signature `onConfirmed` élargie.
- `frontend/__tests__/BookingModal.packages.test.tsx` — **Modify** : projection, mention insuffisant, `onConfirmed` reçoit le résumé.
- `frontend/components/ClubReserve.tsx` — **Modify** : bannière « Réservation confirmée ! » + ligne de résumé.

---

### Task 1: Helpers purs `remainingAfterLabel` / `paidWithLabel`

**Files:**
- Modify: `frontend/lib/packages.ts`
- Test: `frontend/__tests__/packages.test.ts`

- [ ] **Step 1: Write the failing tests**

Dans `frontend/__tests__/packages.test.ts`, modifier la 1ʳᵉ ligne d'import pour ajouter les deux helpers :

```ts
import { packageLabel, isUsable, canCover, prepaidHint, pickPackageFor, indexPackagesByUser, remainingAfterLabel, paidWithLabel } from '@/lib/packages';
```

Puis ajouter ces deux blocs `describe` (les fabriques `entries(...)` et `wallet(...)` existent déjà en haut du fichier) :

```ts
describe('remainingAfterLabel', () => {
  it('carnet : -1 entrée (pluriel/singulier, jamais négatif)', () => {
    expect(remainingAfterLabel(entries(7), 25)).toBe('il restera 6 entrées');
    expect(remainingAfterLabel(entries(2), 25)).toBe('il restera 1 entrée');
    expect(remainingAfterLabel(entries(1), 25)).toBe('il restera 0 entrée');
  });
  it('porte-monnaie : -montant €', () => {
    expect(remainingAfterLabel(wallet('53.50'), 25)).toBe('il restera 28,50 €');
    expect(remainingAfterLabel(wallet('25.00'), 25)).toBe('il restera 0,00 €');
  });
});

describe('paidWithLabel', () => {
  it('carnet : moyen + entrées restantes', () => {
    expect(paidWithLabel(entries(7), 25)).toBe('Payé avec votre carnet · 6 entrées restantes');
    expect(paidWithLabel(entries(2), 25)).toBe('Payé avec votre carnet · 1 entrée restante');
  });
  it('porte-monnaie : moyen + solde restant', () => {
    expect(paidWithLabel(wallet('53.50'), 25)).toBe('Payé avec votre porte-monnaie · solde restant 28,50 €');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx jest packages.test.ts -t "remainingAfterLabel|paidWithLabel"`
Expected: FAIL — `remainingAfterLabel is not a function` / `paidWithLabel is not a function`.

- [ ] **Step 3: Implement the helpers**

À la fin de `frontend/lib/packages.ts`, ajouter :

```ts
/** Solde restant projeté après un paiement de `amountEuros` € (jamais négatif). */
export function remainingAfterLabel(p: MemberPackage, amountEuros: number): string {
  if (p.kind === 'ENTRIES') {
    const n = Math.max(0, (p.creditsRemaining ?? 0) - 1);
    return `il restera ${n} entrée${n > 1 ? 's' : ''}`;
  }
  const left = Math.max(0, Number(p.amountRemaining ?? 0) - amountEuros);
  return `il restera ${left.toFixed(2).replace('.', ',')} €`;
}

/** Résumé d'un paiement par solde (moyen + restant) — pour la confirmation. */
export function paidWithLabel(p: MemberPackage, amountEuros: number): string {
  if (p.kind === 'ENTRIES') {
    const n = Math.max(0, (p.creditsRemaining ?? 0) - 1);
    return `Payé avec votre carnet · ${n} entrée${n > 1 ? 's' : ''} restante${n > 1 ? 's' : ''}`;
  }
  const left = Math.max(0, Number(p.amountRemaining ?? 0) - amountEuros);
  return `Payé avec votre porte-monnaie · solde restant ${left.toFixed(2).replace('.', ',')} €`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx jest packages.test.ts`
Expected: PASS (tous les blocs, anciens et nouveaux).

- [ ] **Step 5: Commit** (voir l'avertissement « Commits » en tête de plan)

```bash
git add frontend/lib/packages.ts frontend/__tests__/packages.test.ts
git commit -m "feat(packages): helpers de solde restant (projection + résumé paiement)"
```

---

### Task 2: Projection + « solde insuffisant » dans `BookingModal`

**Files:**
- Modify: `frontend/components/BookingModal.tsx` (Avenue 3 — carnets prépayés)
- Test: `frontend/__tests__/BookingModal.packages.test.tsx`

- [ ] **Step 1: Write the failing tests**

Dans `frontend/__tests__/BookingModal.packages.test.tsx`, ajouter l'import des helpers n'est pas requis. Ajouter une fabrique de porte-monnaie insuffisant après la déclaration de `pkg` :

```tsx
const poorWallet: MemberPackage = {
  id: 'w-1', kind: 'WALLET', creditsTotal: null, creditsRemaining: null,
  amountTotal: '10.00', amountRemaining: '10.00', purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt: null, template: { name: 'Porte-monnaie' },
};
```

Puis ajouter ces deux tests dans le `describe('BookingModal — paiement par carnet', …)` :

```tsx
it('affiche le solde restant projeté à la sélection du carnet', async () => {
  renderWithPackages([pkg]);
  fireEvent.click(await screen.findByRole('button', { name: /Carnet — 7 entrées/ }));
  expect(screen.getByText(/il restera 6 entrées/)).toBeInTheDocument();
});

it('porte-monnaie insuffisant : puce désactivée + mention « solde insuffisant »', async () => {
  renderWithPackages([poorWallet]);
  await screen.findByText(/Créneau bloqué/);
  expect(screen.getByRole('button', { name: /Porte-monnaie/ })).toBeDisabled();
  expect(screen.getByText(/solde insuffisant/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx jest BookingModal.packages.test.tsx -t "solde restant projeté|solde insuffisant"`
Expected: FAIL — les textes « il restera 6 entrées » et « solde insuffisant » n'existent pas encore.

- [ ] **Step 3: Implement — réécrire le bloc « Avenue 3 »**

Dans `frontend/components/BookingModal.tsx`, remplacer **tout** le bloc Avenue 3 actuel :

```tsx
                  {/* Avenue 3 — carnets prépayés (paient le TOTAL depuis le solde). */}
                  {packages.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {packages.map((p) => {
                        const ok = canCover(p, totalEuros);
                        const sel = paySource === p.id;
                        return (
                          <button key={p.id} type="button" disabled={!ok} onClick={() => { setUseSub(false); setPaySource(p.id); setPayMode('club'); }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1.5px solid ${sel ? th.accent : th.lineStrong}`, background: sel ? `${th.accent}14` : th.surface, borderRadius: 12, padding: '9px 12px', cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.5, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
                            <Icon name="ticket" size={15} color={sel ? th.accent : th.textMute} />
                            {packageLabel(p)}
                            {sel && <Icon name="check" size={13} color={th.accent} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
```

par celui-ci (puce enrichie + légende de projection sous la rangée) :

```tsx
                  {/* Avenue 3 — carnets prépayés (paient le TOTAL depuis le solde). */}
                  {packages.length > 0 && (() => {
                    const selPkg = paySource ? packages.find((p) => p.id === paySource) ?? null : null;
                    return (
                    <div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {packages.map((p) => {
                          const ok = canCover(p, totalEuros);
                          const sel = paySource === p.id;
                          return (
                            <button key={p.id} type="button" disabled={!ok} onClick={() => { setUseSub(false); setPaySource(p.id); setPayMode('club'); }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1.5px solid ${sel ? th.accent : th.lineStrong}`, background: sel ? `${th.accent}14` : th.surface, borderRadius: 12, padding: '9px 12px', cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.5, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
                              <Icon name="ticket" size={15} color={sel ? th.accent : th.textMute} />
                              {packageLabel(p)}
                              {!ok && <span style={{ color: th.textFaint, fontWeight: 600 }}>· solde insuffisant</span>}
                              {sel && <Icon name="check" size={13} color={th.accent} />}
                            </button>
                          );
                        })}
                      </div>
                      {selPkg && (
                        <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 8 }}>
                          Après paiement : {remainingAfterLabel(selPkg, totalEuros)}
                        </div>
                      )}
                    </div>
                    );
                  })()}
```

Mettre à jour l'import des helpers en tête de fichier :

```tsx
import { packageLabel, canCover, remainingAfterLabel, paidWithLabel } from '@/lib/packages';
```

(`paidWithLabel` sera utilisé en Task 3 ; l'ajouter maintenant évite un second edit de la ligne d'import.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx jest BookingModal.packages.test.tsx`
Expected: PASS (les 5 tests — 3 anciens + 2 nouveaux).

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit** (voir l'avertissement « Commits » en tête de plan)

```bash
git add frontend/components/BookingModal.tsx frontend/__tests__/BookingModal.packages.test.tsx
git commit -m "feat(reserver): solde restant projeté + mention solde insuffisant dans BookingModal"
```

---

### Task 3: Résumé après paiement (`onConfirmed` → bannière `ClubReserve`)

**Files:**
- Modify: `frontend/components/BookingModal.tsx` (type `onConfirmed`, `handleConfirm`)
- Modify: `frontend/components/ClubReserve.tsx` (état + bannière)
- Test: `frontend/__tests__/BookingModal.packages.test.tsx`

- [ ] **Step 1: Write the failing test**

Dans `frontend/__tests__/BookingModal.packages.test.tsx`, ajouter ce test (avec son propre mock `onConfirmed`) :

```tsx
it('confirme avec un carnet → onConfirmed reçoit le résumé du solde restant', async () => {
  const onConfirmed = jest.fn();
  render(
    <ThemeProvider>
      <BookingModal slot={mockSlot} resourceId="court-1" price="25" duration={60}
        token="jwt-token" packages={[pkg]} onClose={jest.fn()} onConfirmed={onConfirmed} />
    </ThemeProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Carnet — 7 entrées/ }));
  fireEvent.click(screen.getByRole('button', { name: /Confirmer avec mon solde/ }));
  await waitFor(() => {
    expect(onConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'res-1' }),
      { label: 'Payé avec votre carnet · 6 entrées restantes' },
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx jest BookingModal.packages.test.tsx -t "onConfirmed reçoit le résumé"`
Expected: FAIL — `onConfirmed` est appelé avec un seul argument (`('res-1'…)`), pas de second `{ label }`.

- [ ] **Step 3: Élargir la signature `onConfirmed`**

Dans `frontend/components/BookingModal.tsx`, dans `interface BookingModalProps`, remplacer :

```tsx
  onConfirmed: (reservation: Reservation) => void;
```

par :

```tsx
  /** `paid` (optionnel) résume un règlement par solde prépayé (moyen + restant). */
  onConfirmed: (reservation: Reservation, paid?: { label: string }) => void;
```

- [ ] **Step 4: Passer le résumé dans `handleConfirm`**

Dans `frontend/components/BookingModal.tsx`, dans `handleConfirm`, remplacer le bloc :

```tsx
      const confirmed = await api.confirmReservation(
        reservation.id, token, paymentSource ? { paymentSource } : undefined,
      );
      settled.current = true; // réservation confirmée → le cleanup ne doit pas l'annuler
      onConfirmed(confirmed);
```

par :

```tsx
      const usedPkg = paySource ? packages.find((p) => p.id === paySource) ?? null : null;
      const confirmed = await api.confirmReservation(
        reservation.id, token, paymentSource ? { paymentSource } : undefined,
      );
      settled.current = true; // réservation confirmée → le cleanup ne doit pas l'annuler
      onConfirmed(confirmed, usedPkg ? { label: paidWithLabel(usedPkg, totalEuros) } : undefined);
```

(`paidWithLabel` a déjà été importé en Task 2.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx jest BookingModal.packages.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: Brancher la bannière dans `ClubReserve`**

Dans `frontend/components/ClubReserve.tsx`, ajouter un état à côté de `const [confirmed, setConfirmed] = useState(false);` :

```tsx
  const [confirmedNote, setConfirmedNote] = useState<string | null>(null);
```

Mettre à jour le `onConfirmed` du `<BookingModal>` — remplacer :

```tsx
          onConfirmed={() => {
            setBooking(null);
            setConfirmed(true);
            if (token) { api.getMyClubPackages(club.slug, token).then(setMyPackages).catch(() => {}); }
            refreshQuota();
            reloadAll();
```

par :

```tsx
          onConfirmed={(_res, paid) => {
            setBooking(null);
            setConfirmed(true);
            setConfirmedNote(paid?.label ?? null);
            if (token) { api.getMyClubPackages(club.slug, token).then(setMyPackages).catch(() => {}); }
            refreshQuota();
            reloadAll();
```

Remplacer la bannière de confirmation :

```tsx
        {confirmed && (
          <div style={{ margin: '14px 20px 0', display: 'flex', alignItems: 'center', gap: 10, background: th.accent, color: th.onAccent, borderRadius: 14, padding: '12px 14px' }}>
            <Icon name="check" size={18} color={th.onAccent} stroke={2.4} />
            <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600 }}>Réservation confirmée !</span>
          </div>
        )}
```

par :

```tsx
        {confirmed && (
          <div style={{ margin: '14px 20px 0', display: 'flex', alignItems: 'flex-start', gap: 10, background: th.accent, color: th.onAccent, borderRadius: 14, padding: '12px 14px' }}>
            <Icon name="check" size={18} color={th.onAccent} stroke={2.4} />
            <div>
              <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600 }}>Réservation confirmée !</span>
              {confirmedNote && (
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 500, opacity: 0.92, marginTop: 2 }}>{confirmedNote}</div>
              )}
            </div>
          </div>
        )}
```

- [ ] **Step 7: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur (le 2ᵉ paramètre `onConfirmed` est optionnel → l'appelant `courts/[id]/page.tsx` reste valide).

- [ ] **Step 8: Run the related suites**

Run: `cd frontend && npx jest packages.test.ts BookingModal.packages.test.tsx ClubReserve`
Expected: PASS.

- [ ] **Step 9: Commit** (voir l'avertissement « Commits » en tête de plan)

```bash
git add frontend/components/BookingModal.tsx frontend/components/ClubReserve.tsx frontend/__tests__/BookingModal.packages.test.tsx
git commit -m "feat(reserver): rappel du moyen + solde restant à la confirmation de réservation"
```

---

## Notes de vérification finale

- Suites ciblées (rapides, fiables) : `npx jest packages.test.ts BookingModal.packages.test.tsx ClubReserve` + `npx tsc --noEmit`.
- ⚠️ La suite complète `npx jest` montre ~6 échecs `BookingModal` qui sont un flake de pré-existant (isolation des tests) — vérifier par suites ciblées, pas par la suite entière.
- Aucun test backend : aucune modification backend.
