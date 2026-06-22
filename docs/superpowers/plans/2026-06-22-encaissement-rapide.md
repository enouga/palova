# Encaissement rapide (Réservations & paiements) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre la page `/admin/reservations` au niveau de la pop-up planning pour l'encaissement (composant partagé `CollectPanel`), avec filtres comptoir (plage horaire + « En ce moment » + « À encaisser » + recherche), bouton « Solder » 1-clic et reçu imprimable.

**Architecture :** Extraire l'encaissement riche du planning dans `components/admin/CollectPanel.tsx` consommé par les deux pages (approche A). Filtres = helpers purs `lib/collect.ts` appliqués côté client. Aucun changement backend, aucune migration.

**Tech Stack :** Next.js 16 (Turbopack) / React 19 / TypeScript, Jest + React Testing Library. Montants en **centimes** via `lib/caisse.ts`. Tout en français (UI + commentaires).

**Spec :** `docs/superpowers/specs/2026-06-22-encaissement-rapide-design.md`

---

## File Structure

- **Create** `frontend/components/admin/CollectPanel.tsx` — panneau d'encaissement riche partagé (état + handlers + rendu). Responsabilité unique : encaisser une réservation.
- **Create** `frontend/__tests__/CollectPanel.test.tsx` — tests composant.
- **Create** `frontend/lib/collect.ts` — helpers purs de filtrage (plage horaire, à-encaisser, recherche).
- **Create** `frontend/__tests__/collect.test.ts` — tests des helpers purs.
- **Modify** `frontend/app/admin/planning/page.tsx` — remplace l'encaissement inline (≈ lignes 703-845 + handlers/état associés) par `<CollectPanel>`.
- **Modify** `frontend/app/admin/reservations/page.tsx` — chargement aligné planning, modale `<CollectPanel>`, dû via `dueCents`, défaut aujourd'hui, filtres, « Solder », reçu.

Conventions de test (existantes) : `jest.mock('@/lib/api', () => ({ api: { … }, assetUrl: (u) => u }))`, rendu sous `<ThemeProvider>`. Lancer un test : `npm test -- <fichier>` depuis `frontend/`.

---

## LOT 1 — Composant partagé `CollectPanel` + branchement planning

### Task 1 : Créer `CollectPanel` (TDD)

**Files:**
- Create: `frontend/components/admin/CollectPanel.tsx`
- Test: `frontend/__tests__/CollectPanel.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

```tsx
// frontend/__tests__/CollectPanel.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CollectPanel } from '../components/admin/CollectPanel';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, ClubReservation } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'p1' }),
    adminGetMemberPackages: jest.fn().mockResolvedValue([]),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    adminAssignReservationMember: jest.fn(),
    adminAddReservationParticipant: jest.fn(),
    adminRemoveReservationParticipant: jest.fn(),
    adminCreateMember: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

const RV = (over: Partial<ClubReservation> = {}): ClubReservation => ({
  id: 'rv-1', resourceId: 'court-1',
  startTime: '2026-06-22T14:00:00.000Z', endTime: '2026-06-22T15:00:00.000Z',
  status: 'CONFIRMED', type: 'COURT', title: null,
  totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00',
  resource: { id: 'court-1', name: 'Court 1' },
  user: null, payments: [], participants: [], ...over,
});

function renderPanel(over: Partial<ClubReservation> = {}, props: Record<string, unknown> = {}) {
  const onChanged = jest.fn(); const onPaid = jest.fn(); const onError = jest.fn();
  render(
    <ThemeProvider>
      <CollectPanel reservation={RV(over)} due={5200} players={4} members={[]}
        clubId="club-1" token="tok" onChanged={onChanged} onPaid={onPaid} onError={onError} {...props} />
    </ThemeProvider>,
  );
  return { onChanged, onPaid, onError };
}

describe('CollectPanel', () => {
  it('préremplit le montant avec le reste dû et encaisse en 1 clic (Carte)', async () => {
    const { onChanged, onPaid } = renderPanel();
    expect((screen.getByLabelText(/Encaisser/i) as HTMLInputElement).value).toBe('52');
    fireEvent.click(screen.getByRole('button', { name: 'Carte' }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ amount: 52, method: 'CARD' }), 'tok',
    ));
    expect(onChanged).toHaveBeenCalled();
    expect(onPaid).toHaveBeenCalled();
  });

  it('désactive les moyens au-delà du plafond', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/Encaisser/i), { target: { value: '80' } });
    expect(screen.getByRole('button', { name: 'Espèces' })).toBeDisabled();
  });
});
```

- [ ] **Step 2 : Lancer le test → échec attendu**

Run: `npm test -- CollectPanel.test.tsx`
Expected: FAIL — `Cannot find module '../components/admin/CollectPanel'`.

- [ ] **Step 3 : Créer le composant**

```tsx
// frontend/components/admin/CollectPanel.tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, ClubReservation, Member, MemberPackage, CreateMemberBody, PaymentMethod } from '@/lib/api';
import { packageLabel, isUsable, canCover, prepaidHint } from '@/lib/packages';
import { toCents, centsToInput, quickAmounts, fmtEuros, validatePaymentAmount } from '@/lib/caisse';
import { useTheme } from '@/lib/ThemeProvider';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import { SETTLED_COLOR } from '@/components/admin/PaymentDots';
import { Btn } from '@/components/ui/atoms';

const METHOD_LABEL: Record<string, string> = { CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', VOUCHER: 'Ticket CE', MEMBER: 'Abo / Membre', OTHER: 'Autre' };
const COUNTER_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'VOUCHER', 'MEMBER', 'OTHER'];

export interface CollectPanelProps {
  reservation: ClubReservation;
  due: number;       // centimes — calculé par le parent (dueCents)
  players: number;   // nb de joueurs du terrain (single=2 / double=4)
  members: Member[];
  clubId: string;
  token: string;
  /** mutation joueurs/participants réussie → le parent recharge (et met à jour la résa si fournie). */
  onChanged: (updated?: ClubReservation) => void;
  /** un encaissement a été enregistré (le parent peut fermer la modale). */
  onPaid?: () => void;
  onError?: (msg: string) => void;
}

export function CollectPanel({ reservation, due, players, members, clubId, token, onChanged, onPaid, onError }: CollectPanelProps) {
  const { th } = useTheme();
  const [payAmount, setPayAmount] = useState('');
  const [payParticipantId, setPayParticipantId] = useState<string | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherRef, setVoucherRef] = useState('');
  const [voucherIssuer, setVoucherIssuer] = useState('');
  const [selPackages, setSelPackages] = useState<MemberPackage[]>([]);
  const [pkgLoading, setPkgLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((msg: string) => onError?.(msg), [onError]);
  const remaining = Math.max(0, due - toCents(reservation.paidAmount));

  // Réinitialise montant + voucher quand la résa cible change (ouverture / reload).
  useEffect(() => {
    setPayAmount(centsToInput(remaining));
    setPayParticipantId(null);
    setVoucherOpen(false); setVoucherRef(''); setVoucherIssuer('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation.id]);

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

  const bills = reservation.participants ?? [];
  const activePart = payParticipantId ? bills.find((p) => p.id === payParticipantId) ?? null : null;
  const maxPayable = activePart ? toCents(activePart.outstanding) : remaining;
  const amountC = toCents(payAmount);
  const overCap = due > 0 && amountC > maxPayable;
  const cannotPay = busy || !validatePaymentAmount(amountC, maxPayable);
  const capTitle = overCap ? `Plafond : ${fmtEuros(maxPayable)}` : undefined;

  const payNow = async (method: PaymentMethod) => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { fail('Montant invalide.'); return; }
    setBusy(true);
    try {
      await api.adminAddPayment(clubId, reservation.id, {
        amount, method,
        participantId: payParticipantId ?? undefined,
        voucherRef: method === 'VOUCHER' ? voucherRef.trim() || undefined : undefined,
        voucherIssuer: method === 'VOUCHER' ? voucherIssuer.trim() || undefined : undefined,
      }, token);
      setPayParticipantId(null);
      onChanged(); onPaid?.();
    } catch (e) {
      fail((e as Error).message === 'PAYMENT_EXCEEDS_DUE'
        ? (payParticipantId ? 'Le montant dépasse la part du joueur.' : 'Le montant dépasse le prix de la réservation.')
        : (e as Error).message);
    } finally { setBusy(false); }
  };

  const payWithPackage = async (pkg: MemberPackage) => {
    const rest = activePart ? toCents(activePart.outstanding) / 100 : remaining / 100;
    if (rest <= 0) { fail('Rien à encaisser.'); return; }
    setBusy(true);
    try {
      await api.adminAddPayment(clubId, reservation.id, {
        amount: rest,
        method: pkg.kind === 'ENTRIES' ? 'PACK_CREDIT' : 'WALLET',
        sourcePackageId: pkg.id,
        participantId: payParticipantId ?? undefined,
      }, token);
      setPayParticipantId(null);
      onChanged(); onPaid?.();
    } catch (e) {
      fail((e as Error).message === 'INSUFFICIENT_BALANCE' ? 'Solde du package insuffisant.' : (e as Error).message);
    } finally { setBusy(false); }
  };

  const participantErr = (code: string): string => ({
    TOO_MANY_PLAYERS: 'Terrain complet.',
    CANNOT_REMOVE_ORGANIZER: "Impossible de retirer l'organisateur.",
    RESERVATION_HAS_NO_MEMBER: "Associez d'abord un joueur à la réservation.",
    PARTNER_DUPLICATE: 'Ce joueur est déjà ajouté.',
    MEMBER_NOT_FOUND: "Ce joueur n'est pas membre actif du club.",
  }[code] ?? code);

  const assignPlayer = async (m: Member) => {
    setBusy(true);
    try { onChanged(await api.adminAssignReservationMember(clubId, reservation.id, m.userId, token)); }
    catch (e) { fail((e as Error).message === 'MEMBER_NOT_FOUND' ? "Ce joueur n'est pas membre actif du club." : (e as Error).message); }
    finally { setBusy(false); }
  };
  const addParticipant = async (m: Member) => {
    setBusy(true);
    try { onChanged(await api.adminAddReservationParticipant(clubId, reservation.id, m.userId, token)); }
    catch (e) { fail(participantErr((e as Error).message)); }
    finally { setBusy(false); }
  };
  const removeParticipant = async (participantId: string) => {
    setBusy(true);
    try {
      const updated = await api.adminRemoveReservationParticipant(clubId, reservation.id, participantId, token);
      if (payParticipantId === participantId) setPayParticipantId(null);
      onChanged(updated);
    } catch (e) { fail(participantErr((e as Error).message)); }
    finally { setBusy(false); }
  };

  // Création à la volée : crée le membre, le retrouve, applique l'action (assign/ajout).
  const createThen = async (body: CreateMemberBody, then: (m: Member) => Promise<void>) => {
    const r = await api.adminCreateMember(clubId, body, token);
    const mem = await api.adminGetMembers(clubId, token);
    const created = mem.find((m) => m.email.toLowerCase() === body.email.toLowerCase());
    if (created) await then(created);
    return r;
  };
  const createAndAssign = (body: CreateMemberBody) => createThen(body, assignPlayer);
  const createAndAddParticipant = (body: CreateMemberBody) => createThen(body, addParticipant);

  const input = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '7px 10px', fontFamily: th.fontUI, fontSize: 14 } as const;
  const tint = (hex: string) => (th.mode === 'floodlit' ? `${hex}2e` : `${hex}24`);

  return (
    <div>
      {/* joueur rattaché */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: th.textMute, marginBottom: 4 }}>Joueur</div>
        <PlayerPicker
          members={members}
          value={reservation.user ? { firstName: reservation.user.firstName, lastName: reservation.user.lastName } : null}
          onSelect={assignPlayer} onClear={() => {}} onCreate={createAndAssign}
          placeholder="Cliquez pour voir les membres, ou tapez un nom…"
        />
      </div>

      {/* par joueur */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute, marginBottom: 8 }}>Par joueur</div>
        {bills.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bills.map((p) => {
              const rest = toCents(p.outstanding);
              const settled = rest <= 0;
              const on = payParticipantId === p.id;
              const canRemove = !(p.isOrganizer && bills.length > 1);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 9, background: on ? tint(th.text) : th.surface2, border: `1px solid ${on ? th.text : 'transparent'}` }}>
                  <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text, flex: 1 }}>
                    {p.firstName} {p.lastName}{p.isOrganizer ? <span style={{ color: th.textFaint }}> · orga</span> : null}
                  </span>
                  <span style={{ fontFamily: th.fontMono, fontSize: 12.5, color: settled ? SETTLED_COLOR : th.textMute }}>
                    {fmtEuros(toCents(p.paid))} / {fmtEuros(toCents(p.share))}
                  </span>
                  {settled ? (
                    <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: SETTLED_COLOR }}>réglé</span>
                  ) : (
                    <button type="button" disabled={busy}
                      onClick={() => { setPayParticipantId(p.id); setPayAmount(centsToInput(rest)); }}
                      style={{ border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 8, padding: '5px 10px', cursor: busy ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
                      Régler
                    </button>
                  )}
                  {canRemove && (
                    <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur"
                      onClick={() => removeParticipant(p.id)}
                      style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textMute, fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {activePart && (
          <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 12, color: th.text }}>
            Encaissement pour <b>{activePart.firstName} {activePart.lastName}</b> ·{' '}
            <button type="button" onClick={() => setPayParticipantId(null)} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, textDecoration: 'underline' }}>résa entière</button>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          {bills.length >= players ? (
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Terrain complet ({players} joueurs).</div>
          ) : (
            <PlayerPicker members={members} value={null} onSelect={addParticipant} onClear={() => {}} onCreate={createAndAddParticipant} placeholder="+ Ajouter un joueur…" />
          )}
        </div>
      </div>

      {/* montant + chips rapides */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Encaisser €
          <input type="number" min={0} step="0.1" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
            style={{ ...input, border: `1px solid ${overCap ? '#ff7a4d' : th.line}`, width: 90 }} />
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 3 }}>
          {quickAmounts(due, toCents(reservation.paidAmount), players).map((q) => (
            <button key={q.key} type="button" onClick={() => setPayAmount(centsToInput(q.cents))}
              style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 999, padding: '6px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* moyens 1-clic */}
      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {COUNTER_METHODS.map((m) => (
          <button key={m} type="button" disabled={cannotPay} title={capTitle}
            onClick={() => (m === 'VOUCHER' ? setVoucherOpen(true) : payNow(m))}
            style={{ border: `1.5px solid ${m === 'VOUCHER' && voucherOpen ? th.text : th.line}`, background: th.surface2, borderRadius: 10, padding: '8px 13px', cursor: cannotPay ? 'default' : 'pointer', opacity: cannotPay ? 0.5 : 1, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
            {METHOD_LABEL[m]}
          </button>
        ))}
      </div>
      {voucherOpen && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Référence
            <input type="text" value={voucherRef} onChange={(e) => setVoucherRef(e.target.value)} placeholder="N° ticket" style={{ ...input, width: 100 }} />
          </label>
          <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Émetteur
            <input type="text" value={voucherIssuer} onChange={(e) => setVoucherIssuer(e.target.value)} placeholder="ANCV…" style={{ ...input, width: 90 }} />
          </label>
          <Btn onClick={() => payNow('VOUCHER')} icon="check" disabled={cannotPay}>{busy ? '…' : 'Valider Ticket CE'}</Btn>
          <button type="button" onClick={() => setVoucherOpen(false)} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, paddingBottom: 10 }}>Annuler</button>
        </div>
      )}

      {/* prépayés */}
      {selPackages.length > 0 ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selPackages.map((p) => {
            const ok = canCover(p, remaining / 100);
            return (
              <button key={p.id} type="button" disabled={busy || !ok} onClick={() => payWithPackage(p)}
                title={ok ? 'Solder avec ce package' : 'Solde insuffisant'}
                style={{ border: `1.5px solid ${th.line}`, background: th.surface2, borderRadius: 10, padding: '7px 12px', cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.5, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
                {packageLabel(p)}
              </button>
            );
          })}
        </div>
      ) : (!pkgLoading && (() => {
        const msg = prepaidHint(!!reservation.user, selPackages.length, maxPayable);
        return msg ? <div style={{ marginTop: 12, fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>{msg}</div> : null;
      })())}
    </div>
  );
}
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `npm test -- CollectPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5 : tsc**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/admin/CollectPanel.tsx frontend/__tests__/CollectPanel.test.tsx
git commit -m "feat(caisse): composant partagé CollectPanel (encaissement riche)"
```

### Task 2 : Brancher le planning sur `CollectPanel`

**Files:**
- Modify: `frontend/app/admin/planning/page.tsx`

- [ ] **Step 1 : Importer le composant**

Ajouter en tête (près des autres imports `@/components/admin/*`) :
```tsx
import { CollectPanel } from '@/components/admin/CollectPanel';
```

- [ ] **Step 2 : Faire que `load()` retourne les réservations**

Dans `const load = useCallback(async () => { … })`, après `setRes(resv.reservations);` … `finally { setLoading(false); }`, faire renvoyer la liste : ajouter `return resv.reservations;` juste avant le `catch`, et `return [] as ClubReservation[];` dans le `catch`. Le type du callback devient `Promise<ClubReservation[]>`.

- [ ] **Step 3 : Ajouter le handler de rafraîchissement de la modale**

Sous `load`, ajouter :
```tsx
// Après une mutation du CollectPanel : recharge et garde la modale à jour.
const refreshSelected = useCallback(async (updated?: ClubReservation) => {
  const list = await load();
  setSelected((cur) => (updated ?? (cur ? list.find((r) => r.id === cur.id) ?? cur : cur)));
}, [load]);
```

- [ ] **Step 4 : Simplifier `openRes`**

Remplacer le corps de `openRes` (qui préremplit montant/voucher/packages) par la version minimale — `CollectPanel` gère son propre état :
```tsx
const openRes = (rv: ClubReservation) => { setSelected(rv); setConfirmCancel(false); setError(null); };
```

- [ ] **Step 5 : Remplacer le bloc d'encaissement inline par `<CollectPanel>`**

Dans la modale détail, **supprimer** le bloc « joueur rattaché » (le `{selected.status !== 'CANCELLED' && ( <div>…Joueur…PlayerPicker…</div> )}`) **et** tout le bloc IIFE « encaissement rapide » `{selected.status !== 'CANCELLED' && (() => { … })()}` (≈ lignes 703-845). Les remplacer par :
```tsx
{selected.status !== 'CANCELLED' && (
  <div style={{ marginTop: 16 }}>
    <CollectPanel
      reservation={selected}
      due={dueOf(selected)}
      players={playersOf(selected)}
      members={members}
      clubId={clubId!}
      token={token!}
      onChanged={refreshSelected}
      onPaid={() => setSelected(null)}
      onError={(msg) => setError(msg)}
    />
  </div>
)}
```

- [ ] **Step 6 : Supprimer le code mort du planning**

Supprimer les handlers et états désormais portés par `CollectPanel` : `payNow`, `payWithPackage`, `assignPlayer`, `addParticipant`, `removeParticipant`, `createAndAssign`, `createAndAddParticipant`, `participantErr`, et les états `payParticipantId`, `payAmount`, `voucherOpen`, `voucherRef`, `voucherIssuer`, `selPackages`, `pkgLoading`. **Garder** : `members`, `createForResa` (formulaire de création de résa), `busy` (utilisé par changeType/doCancel/cancelSeries/submitCreate), et les imports encore utilisés ailleurs (`PlayerPicker` reste utilisé par le formulaire de création ; `toCents`, `centsToInput`, `dueCents`, `fmtEuros`, `paymentDots`, `quickAmounts`, `validatePaymentAmount` — retirer de l'import **uniquement** ceux qui ne sont plus référencés).

- [ ] **Step 7 : Vérifier la compilation (révèle les imports/refs morts)**

Run: `npx tsc --noEmit`
Expected: aucune erreur. Corriger les imports inutilisés signalés (ex. `quickAmounts`, `validatePaymentAmount`, `centsToInput` si plus référencés) jusqu'à 0 erreur.

- [ ] **Step 8 : Lancer la suite frontend complète (non-régression)**

Run: `npm test`
Expected: tous verts (aucun test planning dédié ; on s'appuie sur tsc + suite globale).

- [ ] **Step 9 : Commit**

```bash
git add frontend/app/admin/planning/page.tsx
git commit -m "refactor(planning): encaissement via CollectPanel partagé"
```

---

## LOT 2 — Page « Réservations & paiements » sur `CollectPanel` + reçu

### Task 3 : Chargement aligné planning + dû via `dueCents` + défaut aujourd'hui

**Files:**
- Modify: `frontend/app/admin/reservations/page.tsx`

- [ ] **Step 1 : Imports + état contexte**

Remplacer les imports du haut par (ajouts : ressources/club/caisse/courtType/types) :
```tsx
'use client';
import { useState, useEffect, useCallback, Fragment, CSSProperties } from 'react';
import { api, ClubReservation, ClubReservationsResponse, PaymentMethod, AdminResource, OffPeakHours, Member, ClubAdminDetail } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { DateField } from '@/components/ui/DateField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CollectPanel } from '@/components/admin/CollectPanel';
import { dueCents, toCents, fmtEuros } from '@/lib/caisse';
import { playerCount } from '@/lib/courtType';
```

Ajouter une constante `todayISO` en haut du fichier (sous `fmt`) :
```tsx
function todayISO(): string { return new Date().toISOString().slice(0, 10); }
```

- [ ] **Step 2 : États : défaut aujourd'hui + contexte chargé**

Dans le composant, remplacer `const [date, setDate] = useState('');` par `const [date, setDate] = useState(todayISO());` et ajouter :
```tsx
const [resources, setResources] = useState<AdminResource[]>([]);
const [peak, setPeak]           = useState<OffPeakHours | null>(null);
const [tz, setTz]               = useState('Europe/Paris');
const [members, setMembers]     = useState<Member[]>([]);
const [clubDetail, setClubDetail] = useState<ClubAdminDetail | null>(null);
const [selected, setSelected]   = useState<ClubReservation | null>(null);
```
Supprimer l'état du vieux panneau : `openId`, `form`, `saving` (remplacés par la modale `CollectPanel`).

- [ ] **Step 3 : `load()` charge tout (club/ressources/résas/membres) et retourne la liste**

```tsx
const load = useCallback(async (): Promise<ClubReservation[]> => {
  if (!token || !clubId) return [];
  setLoading(true);
  try {
    setError(null);
    const [detail, res, resv, mem] = await Promise.all([
      api.adminGetClub(clubId, token),
      api.adminGetResources(clubId, token),
      api.adminGetReservations(clubId, date ? { date } : {}, token),
      api.adminGetMembers(clubId, token),
    ]);
    setClubDetail(detail);
    setTz(detail.timezone);
    setPeak(detail.offPeakHours ?? null);
    setResources(res.filter((r) => r.isActive));
    setMembers(mem);
    setData(resv);
    return resv.reservations;
  } catch (e) { setError((e as Error).message); return []; }
  finally { setLoading(false); }
}, [token, clubId, date]);
```
> Note : `ClubAdminDetail` expose `offPeakHours` ; si TypeScript signale son absence, lire `frontend/lib/api.ts` `interface ClubAdminDetail` et utiliser le champ réel (le planning lit `c.offPeakHours` via `adminGetClub`, donc le champ existe).

- [ ] **Step 4 : Helpers dû/joueurs + rafraîchissement modale**

```tsx
const resById = new Map(resources.map((r) => [r.id, r]));
const dueOf = (r: ClubReservation) => dueCents(r, resById.get(r.resourceId), peak, tz);
const playersOf = (r: ClubReservation) => playerCount(typeof resById.get(r.resourceId)?.attributes?.format === 'string' ? (resById.get(r.resourceId)!.attributes.format as string) : undefined);

const refreshSelected = useCallback(async (updated?: ClubReservation) => {
  const list = await load();
  setSelected((cur) => (updated ?? (cur ? list.find((r) => r.id === cur.id) ?? cur : cur)));
}, [load]);
```

- [ ] **Step 5 : tsc (du code mort apparaîtra — traité en Task 4)**

Run: `npx tsc --noEmit`
Expected: erreurs **uniquement** sur l'ancien JSX (`openId`, `form`, `addPayment`, `openPanel`) — corrigées en Task 4. Ne pas committer encore.

### Task 4 : Table + modale `CollectPanel` + reçu imprimable

**Files:**
- Modify: `frontend/app/admin/reservations/page.tsx`

- [ ] **Step 1 : Supprimer l'ancien panneau inline et ses handlers**

Supprimer `openPanel`, `addPayment`, et dans le JSX de la table : la colonne d'expansion `{open && (<tr>…formulaire…</tr>)}` et le `Fragment`/`open` associés. Le bouton « Encaisser » d'une ligne appellera `setSelected(r)`.

- [ ] **Step 2 : Construire l'adaptateur reçu + état modale reçu**

Ajouter en haut du composant :
```tsx
const [receiptTarget, setReceiptTarget] = useState<{ payment: import('@/lib/api').Payment; rv: ClubReservation } | null>(null);
```
Et un helper pur (sous `todayISO`, hors composant) :
```tsx
import type { Payment, CaissePayment } from '@/lib/api';
function toCaissePayment(p: Payment, rv: ClubReservation): CaissePayment {
  return {
    ...p,
    reservation: { id: rv.id, startTime: rv.startTime, resource: { name: rv.resource.name }, user: rv.user ? { firstName: rv.user.firstName, lastName: rv.user.lastName } : null },
    memberPackage: null,
  };
}
```
Importer `Receipt` : `import { Receipt } from '@/components/admin/Receipt';`

- [ ] **Step 3 : Bouton « Encaisser » → ouvre la modale**

Dans la cellule actions, remplacer le bouton « Encaisser » par :
```tsx
{r.status !== 'CANCELLED' && (
  <button onClick={() => setSelected(r)} style={{ border: 'none', cursor: 'pointer', borderRadius: 9, padding: '6px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, background: th.accent, color: th.onAccent, marginRight: 8 }}>
    Encaisser{r.payments.length ? ` (${r.payments.length})` : ''}
  </button>
)}
```
Et remplacer l'affichage « reste » de la colonne Payé pour utiliser `dueOf` :
```tsx
{(() => { const rest = Math.max(0, dueOf(r) - toCents(r.paidAmount)); const fullyPaid = rest <= 0 && r.status !== 'CANCELLED' && dueOf(r) > 0;
  return (<>
    <span style={{ fontWeight: 600, color: fullyPaid ? (th.mode === 'floodlit' ? th.accent : th.ink) : th.text }}>{fmtEuros(toCents(r.paidAmount))}</span>
    {r.status !== 'CANCELLED' && rest > 0 && <span style={{ fontSize: 12, color: '#ff7a4d', marginLeft: 6 }}>reste {fmtEuros(rest)}</span>}
    {fullyPaid && <span style={{ fontSize: 12, color: th.textMute, marginLeft: 6 }}>✓</span>}
  </>); })()}
```
(La colonne Montant peut afficher `{fmtEuros(dueOf(r))}` au lieu de `{r.totalPrice} €`.)

- [ ] **Step 4 : Modale d'encaissement (CollectPanel + paiements + reçus)**

Avant `{confirmCancel && (…)}`, ajouter :
```tsx
{selected && (
  <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: 28, fontFamily: th.fontUI, maxHeight: '90vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, color: th.text }}>{selected.resource.name}</div>
          <div style={{ fontFamily: th.fontMono, fontSize: 13, color: th.textMute, marginTop: 2 }}>{fmt(selected.startTime)} · {STATUS_LABEL[selected.status]}</div>
        </div>
        <button onClick={() => setSelected(null)} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 32, height: 32, color: th.textMute, fontSize: 16 }}>✕</button>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 18, fontFamily: th.fontUI, fontSize: 13 }}>
        <span style={{ color: th.textMute }}>Total : <b style={{ color: th.text }}>{fmtEuros(dueOf(selected))}</b></span>
        <span style={{ color: th.textMute }}>Payé : <b style={{ color: th.text }}>{fmtEuros(toCents(selected.paidAmount))}</b></span>
        <span style={{ color: th.textMute }}>Reste : <b style={{ color: '#ff7a4d' }}>{fmtEuros(Math.max(0, dueOf(selected) - toCents(selected.paidAmount)))}</b></span>
      </div>
      <div style={{ marginTop: 16 }}>
        <CollectPanel reservation={selected} due={dueOf(selected)} players={playersOf(selected)} members={members} clubId={clubId!} token={token!} onChanged={refreshSelected} onError={(msg) => setError(msg)} />
      </div>
      {selected.payments.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute, marginBottom: 8 }}>Encaissements</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selected.payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
                <span style={{ fontWeight: 700, minWidth: 64 }}>{fmtEuros(toCents(p.amount))}</span>
                <span style={{ color: th.textMute }}>{METHOD_LABEL[p.method]}</span>
                <button type="button" onClick={() => setReceiptTarget({ payment: p, rv: selected })} style={{ marginLeft: 'auto', border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 9, padding: '4px 9px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600 }}>Reçu</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  </div>
)}
{receiptTarget && clubDetail && (
  <>
    <style>{`@media print { body * { visibility: hidden !important; } .receipt-print-overlay, .receipt-print-overlay * { visibility: visible !important; } .receipt-print-overlay { position: absolute; inset: 0; background: #fff !important; } .receipt-print-overlay .no-print { display: none !important; } }`}</style>
    <div className="receipt-print-overlay" onClick={() => setReceiptTarget(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 18, boxShadow: '0 8px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <Receipt payment={toCaissePayment(receiptTarget.payment, receiptTarget.rv)} clubName={clubDetail.name} clubAddress={clubDetail.address} />
        <div className="no-print" style={{ display: 'flex', gap: 10, padding: '12px 24px 20px', background: '#fff' }}>
          <button type="button" onClick={() => window.print()} style={{ flex: 1, border: 'none', background: '#111', color: '#fff', borderRadius: 10, padding: '10px 0', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700 }}>Imprimer</button>
          <button type="button" onClick={() => setReceiptTarget(null)} style={{ border: '1px solid #ccc', background: 'transparent', color: '#555', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: 14 }}>Fermer</button>
        </div>
      </div>
    </div>
  </>
)}
```
> `METHOD_LABEL` existe déjà en haut du fichier. `STATUS_LABEL` aussi.

- [ ] **Step 5 : tsc + suite**

Run: `npx tsc --noEmit` puis `npm test`
Expected: 0 erreur tsc ; suite verte.

- [ ] **Step 6 : Commit**

```bash
git add frontend/app/admin/reservations/page.tsx
git commit -m "feat(caisse): page Réservations sur CollectPanel + reçu imprimable + défaut aujourd'hui"
```

---

## LOT 3 — Filtres comptoir + « Solder » 1-clic

### Task 5 : Helpers purs `lib/collect.ts` (TDD)

**Files:**
- Create: `frontend/lib/collect.ts`
- Test: `frontend/__tests__/collect.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// frontend/__tests__/collect.test.ts
import { overlapsHourWindow, outstandingFilter, matchesQuery } from '@/lib/collect';

const TZ = 'Europe/Paris';
// jeudi 22/06/2026 18h-19h Paris (UTC+2) = 16:00Z-17:00Z
const rv = { startTime: '2026-06-22T16:00:00.000Z', endTime: '2026-06-22T17:00:00.000Z' };

describe('overlapsHourWindow', () => {
  it('vrai si le créneau recoupe la fenêtre', () => {
    expect(overlapsHourWindow(rv, 18, 22, TZ)).toBe(true);  // créneau 18-19 ⊂ [18,22)
    expect(overlapsHourWindow(rv, 17, 22, TZ)).toBe(true);  // [17,22) couvre 18-19
  });
  it('faux si la fenêtre est entièrement avant ou après', () => {
    expect(overlapsHourWindow(rv, 8, 12, TZ)).toBe(false);  // fenêtre avant le créneau
    expect(overlapsHourWindow(rv, 19, 22, TZ)).toBe(false); // créneau finit à 19 = borne basse exclue
  });
});

describe('outstandingFilter', () => {
  it('mode "due" garde les restes dus non annulés', () => {
    expect(outstandingFilter('due', 5200, 0, false)).toBe(true);
    expect(outstandingFilter('due', 5200, 5200, false)).toBe(false);
    expect(outstandingFilter('due', 5200, 0, true)).toBe(false);
  });
  it('mode "paid" garde les soldés payants', () => {
    expect(outstandingFilter('paid', 5200, 5200, false)).toBe(true);
    expect(outstandingFilter('paid', 0, 0, false)).toBe(false);
  });
  it('mode "all" garde tout', () => {
    expect(outstandingFilter('all', 0, 0, true)).toBe(true);
  });
});

describe('matchesQuery', () => {
  const r = { title: null, user: { firstName: 'Élodie', lastName: 'Martin', email: 'e@x.fr' } };
  it('insensible casse/accents sur nom', () => {
    expect(matchesQuery(r, 'elodie')).toBe(true);
    expect(matchesQuery(r, 'MARTIN')).toBe(true);
  });
  it('cherche aussi dans l\'intitulé et vide = tout', () => {
    expect(matchesQuery({ title: 'Tournoi P100', user: null }, 'p100')).toBe(true);
    expect(matchesQuery(r, '')).toBe(true);
  });
});
```
> Sémantique de recouvrement (demi-ouvert) : une résa recoupe `[fromHour, toHour)` ssi `début < toHour` ET `fin > fromHour`. Borne basse incluse, borne haute exclue — voir l'implémentation au Step 3.

- [ ] **Step 2 : Lancer → échec**

Run: `npm test -- collect.test.ts`
Expected: FAIL — module `@/lib/collect` introuvable.

- [ ] **Step 3 : Implémenter**

```ts
// frontend/lib/collect.ts
// Helpers purs de filtrage de la page Réservations & paiements (côté client).

/** Minutes locales (fuseau club) depuis minuit pour un instant ISO. */
function localMinutes(iso: string, tz: string): number {
  const f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
  const [h, m] = f.split(':').map(Number);
  return h * 60 + m;
}

/** La résa recoupe-t-elle la fenêtre horaire [fromHour, toHour) (heures locales club) ? */
export function overlapsHourWindow(rv: { startTime: string; endTime: string }, fromHour: number, toHour: number, tz: string): boolean {
  const s = localMinutes(rv.startTime, tz);
  let e = localMinutes(rv.endTime, tz);
  if (e <= s) e = 24 * 60; // créneau franchissant minuit
  return s < toHour * 60 && e > fromHour * 60;
}

export type OutstandingMode = 'all' | 'due' | 'paid';

/** Filtre par état d'encaissement (montants en centimes). */
export function outstandingFilter(mode: OutstandingMode, due: number, paid: number, cancelled: boolean): boolean {
  if (mode === 'all') return true;
  if (cancelled) return false;
  const rest = Math.max(0, due - paid);
  return mode === 'due' ? rest > 0 : rest <= 0 && due > 0;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Recherche texte sur nom/prénom/email du joueur et l'intitulé. Vide = tout. */
export function matchesQuery(rv: { title: string | null; user: { firstName: string; lastName: string; email: string } | null }, q: string): boolean {
  const needle = norm(q.trim());
  if (!needle) return true;
  const hay = norm([rv.title ?? '', rv.user ? `${rv.user.firstName} ${rv.user.lastName} ${rv.user.email}` : ''].join(' '));
  return hay.includes(needle);
}
```

- [ ] **Step 4 : Lancer → succès**

Run: `npm test -- collect.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/collect.ts frontend/__tests__/collect.test.ts
git commit -m "feat(caisse): helpers purs de filtrage (plage horaire, à-encaisser, recherche)"
```

### Task 6 : Brancher les filtres + « Solder » 1-clic sur la page Réservations

**Files:**
- Modify: `frontend/app/admin/reservations/page.tsx`

- [ ] **Step 1 : Imports filtres + état**

Ajouter aux imports : `import { overlapsHourWindow, outstandingFilter, matchesQuery, OutstandingMode } from '@/lib/collect';` et `PaymentMethod` est déjà importé.
Ajouter l'état :
```tsx
const [query, setQuery]   = useState('');
const [outMode, setOut]   = useState<OutstandingMode>('all');
const [fromHour, setFrom] = useState<number | null>(null);
const [toHour, setTo]     = useState<number | null>(null);
const [solderMethod, setSolderMethod] = useState<PaymentMethod>('CASH');
// moyen « Solder » par défaut mémorisé
useEffect(() => { const v = typeof window !== 'undefined' ? window.localStorage.getItem('palova:solder-method') : null; if (v) setSolderMethod(v as PaymentMethod); }, []);
const pickSolder = (m: PaymentMethod) => { setSolderMethod(m); try { window.localStorage.setItem('palova:solder-method', m); } catch {} };
```

- [ ] **Step 2 : Liste filtrée + résumé recalculé**

Juste avant le `return`, calculer :
```tsx
const open = resources.length ? Math.min(...resources.map((r) => r.openHour)) : 8;
const close = resources.length ? Math.max(...resources.map((r) => r.closeHour)) : 22;
const visible = (data?.reservations ?? []).filter((r) =>
  matchesQuery(r, query) &&
  outstandingFilter(outMode, dueOf(r), toCents(r.paidAmount), r.status === 'CANCELLED') &&
  (fromHour == null || toHour == null || overlapsHourWindow(r, fromHour, toHour, tz)),
);
const sumDue = visible.reduce((s, r) => s + dueOf(r), 0);
const sumPaid = visible.reduce((s, r) => s + toCents(r.paidAmount), 0);
const nowHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date()));
```
Remplacer `data?.reservations.map(...)` par `visible.map(...)` dans le `<tbody>`, et le bandeau résumé par `Total dû {fmtEuros(sumDue)} · Encaissé {fmtEuros(sumPaid)} · Reste dû {fmtEuros(Math.max(0, sumDue - sumPaid))}`.

- [ ] **Step 3 : Barre de filtres (UI)**

Sous le filtre « Jour » existant, ajouter une rangée :
```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Rechercher un client…" style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 14, minWidth: 220 }} />
  {(['all', 'due', 'paid'] as OutstandingMode[]).map((m) => (
    <button key={m} type="button" onClick={() => setOut(m)} style={{ border: `1px solid ${outMode === m ? th.accent : th.line}`, background: outMode === m ? `${th.accent}22` : 'transparent', color: th.text, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
      {m === 'all' ? 'Tout' : m === 'due' ? 'À encaisser' : 'Payées'}
    </button>
  ))}
  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
    De
    <select value={fromHour ?? ''} onChange={(e) => setFrom(e.target.value === '' ? null : Number(e.target.value))} style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '6px 8px' }}>
      <option value="">—</option>
      {Array.from({ length: close - open }, (_, i) => open + i).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>)}
    </select>
    à
    <select value={toHour ?? ''} onChange={(e) => setTo(e.target.value === '' ? null : Number(e.target.value))} style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '6px 8px' }}>
      <option value="">—</option>
      {Array.from({ length: close - open + 1 }, (_, i) => open + i).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>)}
    </select>
  </span>
  <button type="button" onClick={() => { setDate(todayISO()); setFrom(nowHour()); setTo(close); }} style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>En ce moment</button>
  {(fromHour != null || toHour != null || outMode !== 'all' || query) && (
    <button type="button" onClick={() => { setFrom(null); setTo(null); setOut('all'); setQuery(''); }} style={{ border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Effacer</button>
  )}
</div>
```

- [ ] **Step 4 : Bouton « Solder » 1-clic dans la cellule actions**

Dans la cellule actions, **avant** le bouton « Encaisser », ajouter (uniquement si reste dû) :
```tsx
{(() => { const rest = Math.max(0, dueOf(r) - toCents(r.paidAmount)); if (r.status === 'CANCELLED' || rest <= 0) return null;
  const solder = async () => { if (!token || !clubId) return; try { setError(null); await api.adminAddPayment(clubId, r.id, { amount: rest / 100, method: solderMethod }, token); await load(); } catch (e) { setError((e as Error).message); } };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 }}>
      <button onClick={solder} title={`Solder ${fmtEuros(rest)} en ${solderMethod}`} style={{ border: `1px solid ${th.line}`, background: th.surface2, cursor: 'pointer', borderRadius: 9, padding: '6px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>Solder</button>
      <select value={solderMethod} onChange={(e) => pickSolder(e.target.value as PaymentMethod)} title="Moyen par défaut" style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '5px 4px', fontSize: 12 }}>
        {(['CASH', 'CARD', 'TRANSFER'] as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
      </select>
    </span>
  ); })()}
```

- [ ] **Step 5 : tsc + suite**

Run: `npx tsc --noEmit` puis `npm test`
Expected: 0 erreur ; suite verte.

- [ ] **Step 6 : Commit**

```bash
git add frontend/app/admin/reservations/page.tsx
git commit -m "feat(caisse): filtres (plage horaire/à-encaisser/recherche) + Solder 1-clic"
```

### Task 7 : Test page Réservations (filtres + solder)

**Files:**
- Create: `frontend/__tests__/AdminReservations.test.tsx`

- [ ] **Step 1 : Écrire le test**

```tsx
// frontend/__tests__/AdminReservations.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminReservationsPage from '../app/admin/reservations/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetClub: jest.fn().mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris', offPeakHours: null }),
    adminGetResources: jest.fn().mockResolvedValue([{ id: 'court-1', name: 'C1', attributes: {}, isActive: true, price: '52.00', offPeakPrice: null, openHour: 8, closeHour: 22, slotStepMin: null, clubSport: { id: 'cs', slotStepMin: null, durationsMin: [60], sport: { key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } } }]),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    adminGetReservations: jest.fn().mockResolvedValue({ reservations: [
      { id: 'rv-1', resourceId: 'court-1', startTime: '2026-06-22T16:00:00.000Z', endTime: '2026-06-22T17:00:00.000Z', status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00', resource: { id: 'court-1', name: 'C1' }, user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' }, payments: [], participants: [] },
    ], summary: { total: '52', paid: '0', paidTotal: '0', outstanding: '52' } }),
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'p1' }),
    adminGetMemberPackages: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));

const renderPage = () => render(<ThemeProvider><AdminReservationsPage /></ThemeProvider>);

it('filtre « À encaisser » garde les impayés et « Solder » encaisse le reste', async () => {
  renderPage();
  await screen.findByText('C1');
  fireEvent.click(screen.getByRole('button', { name: 'À encaisser' }));
  expect(screen.getByText('C1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Solder' }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1', expect.objectContaining({ amount: 52 }), 'tok'));
});

it('recherche par nom masque les non-correspondants', async () => {
  renderPage();
  await screen.findByText('C1');
  fireEvent.change(screen.getByPlaceholderText(/Rechercher/i), { target: { value: 'zzz' } });
  expect(screen.queryByText('C1')).not.toBeInTheDocument();
});
```

- [ ] **Step 2 : Lancer → succès**

Run: `npm test -- AdminReservations.test.tsx`
Expected: PASS (ajuster les libellés si l'UI diffère légèrement).

- [ ] **Step 3 : Commit**

```bash
git add frontend/__tests__/AdminReservations.test.tsx
git commit -m "test(caisse): filtres + Solder page Réservations"
```

---

## Revue finale (obligatoire)

- [ ] **Revue holistique end-to-end** (les revues par-lot ne suffisent pas — cf. bugs cross-layer rattrapés sur les features précédentes) : vérifier le flux complet sur le dev local (planning **et** page Réservations) — encaissement 1-clic, par joueur, Ticket CE, carnet, Solder, filtres, reçu. Lancer la **gate complète** : `cd frontend && npx tsc --noEmit && npm test`.
- [ ] **Non-régression planning** : ouvrir une résa dans le planning, vérifier que l'encaissement riche fonctionne à l'identique (le `CollectPanel` est partagé).

---

## Self-Review (rempli par l'auteur du plan)

**Couverture spec :**
- §2 CollectPanel → Task 1 (création) + Task 2 (branchement planning). ✅
- §3 page Réservations (chargement aligné, dueCents, défaut aujourd'hui, modale) → Tasks 3-4. ✅
- §4 filtres (plage + « En ce moment » + à-encaisser + recherche) → Tasks 5-6. ✅
- §3 « Solder » 1-clic → Task 6. ✅
- §5 reçu imprimable → Task 4. ✅
- §Tests → Tasks 1, 5, 7 + revue finale. ✅

**Placeholders :** aucun TODO/TBD ; code complet à chaque étape.

**Cohérence des types :** `CollectPanelProps` (Task 1) réutilisé à l'identique dans planning (Task 2) et Réservations (Task 4). `dueOf`/`playersOf`/`refreshSelected` définis en Task 3 avant usage en Task 4. `OutstandingMode` défini en Task 5, importé en Task 6. `toCaissePayment` défini en Task 4 avant usage.

**Risque dev parallèle :** le planning étant en dev parallèle actif, exécuter dans un **worktree hors OneDrive** (skill using-git-worktrees), pousser en FF sur `main` après gate verte.
