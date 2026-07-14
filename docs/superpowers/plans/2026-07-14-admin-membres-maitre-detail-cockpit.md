# Membres admin — maître-détail + fiche cockpit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer `/admin/members` en écran unique maître-détail (liste compacte à gauche, fiche 360° « cockpit » à droite) — le panneau latéral `MemberPanel` et la page à onglets `/admin/members/[userId]` disparaissent.

**Architecture:** Backend quasi intact — un seul ajout additif `finance.unpaid[]` dans `MemberStatsService.getMemberHistory` (aucune migration, aucune route nouvelle). Frontend : la page liste est réécrite en maître-détail avec URL `?m=<userId>`, clavier ↑↓/Échap, mobile plein écran ; la fiche est un nouvel orchestrateur `MemberCockpit` + 4 cartes (Argent / Vie au club / Jeu / Notes & infos) qui réutilisent tous les dialogs et graphiques existants. L'encaissement inline passe par `adminAddPayment` existant (montants en **euros** : `amountCents / 100`, pattern `CashRegister`).

**Tech Stack:** Next.js 16 (Turbopack), React inline-styles maison (`useTheme().th`), Jest + RTL (frontend, sans type-check → `tsc --noEmit` séparé), Jest + prismaMock (backend).

**Spec:** `docs/superpowers/specs/2026-07-14-admin-membres-maitre-detail-cockpit-design.md`

**⚠️ Rappels environnement** (mémoires projet) :
- Shims `node_modules/.bin` cassés → lancer `node node_modules/jest/bin/jest.js …` et `node node_modules/typescript/bin/tsc --noEmit` directement.
- PowerShell : le cwd se réinitialise entre les commandes → toujours préfixer `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend;` (ou `\frontend;`).
- La suite complète frontend a un flake connu BookingModal → vérifier par suites scoped.
- L'utilisateur édite le repo en parallèle → `git status` avant chaque commit, ne stager que ses fichiers.

**Écart de spec assumé (documenté ici) :** la spec dit « réservations COURT/COACHING » pour `finance.unpaid[]` ; on colle plutôt **exactement** à l'accumulation d'`outstanding` existante (tout statut CONFIRMED, tous types) pour garantir `Σ unpaid.dueAmount === finance.outstanding` — le bouton « Encaisser N € » du header (alimenté par `outstanding`) correspond ainsi toujours à la somme des lignes affichées.

---

## File Structure

**Backend (modifiés) :**
- `backend/src/services/memberStats.service.ts` — interface `MemberUnpaidReservation` + collecte `unpaid[]`
- `backend/src/services/__tests__/memberStats.service.test.ts` — bloc « finance.unpaid »

**Frontend (créés) :**
- `frontend/lib/memberCockpit.ts` — helpers purs (résas 30 j, dépensé 12 mois, fiabilité, total impayés)
- `frontend/components/admin/members/FileDashboard.tsx` — état vide du panneau droit
- `frontend/components/admin/members/CockpitHeader.tsx` — identité + actions + menu ⋯
- `frontend/components/admin/members/MoneyCard.tsx` — impayés/soldes/abonnement + dépliant graphiques
- `frontend/components/admin/members/LifeCard.tsx` — activités + heatmap + dépliant historique
- `frontend/components/admin/members/GameCard.tsx` — niveau/matchs + dépliant courbe & correction
- `frontend/components/admin/members/NotesCard.tsx` — infos éditables + fil de notes
- `frontend/components/admin/members/MemberCockpit.tsx` — orchestrateur fiche (fetch + layout)
- `frontend/__tests__/memberCockpit.test.ts`, `frontend/__tests__/MemberCockpit.test.tsx`

**Frontend (modifiés) :**
- `frontend/lib/api.ts` — type `MemberUnpaidReservation` + `finance.unpaid`
- `frontend/app/admin/members/page.tsx` — réécrit en maître-détail
- `frontend/components/admin/members/MemberRow.tsx` — une seule zone cliquable, actions abonnés retirées
- `frontend/app/admin/members/[userId]/page.tsx` — réduit à une redirection
- `frontend/__tests__/AdminMembersNav.test.tsx`, `AdminMembersFilters.test.tsx`, `AdminMembersStaff.test.tsx`, `MemberRow.test.tsx` — adaptés

**Frontend (supprimés) :**
- `frontend/components/admin/members/MemberPanel.tsx`
- `frontend/__tests__/MemberHistory.test.tsx`, `frontend/__tests__/AdminMemberLevel.test.tsx` (comportements repris par `MemberCockpit.test.tsx`)

---

### Task 1 : Backend — `finance.unpaid[]` dans MemberHistory

**Files:**
- Modify: `backend/src/services/memberStats.service.ts`
- Test: `backend/src/services/__tests__/memberStats.service.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à la fin du `describe('MemberStatsService.getMemberHistory', …)` :

```ts
  it('finance.unpaid : une ligne par résa CONFIRMED à reste dû, Σ = outstanding ; soldées et annulées absentes', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { // titulaire, payé 12/20 → reste 8
        id: 'r1', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-20T18:00:00Z'), endTime: D('2026-06-20T19:00:00Z'),
        totalPrice: 20, cancelledAt: null, userId: 'u1',
        resource: { name: 'Court 1', price: 20, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [],
        payments: [{ amount: 12, method: 'CARD', participantId: null, createdAt: D('2026-06-20T19:00:00Z'), refunds: [] }],
      },
      { // participant avec share 5, rien payé → reste 5 (attribué à SA place)
        id: 'r2', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-21T18:00:00Z'), endTime: D('2026-06-21T19:00:00Z'),
        totalPrice: 20, cancelledAt: null, userId: 'other',
        resource: { name: 'Court 2', price: 20, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'p-me', userId: 'u1', share: 5, isOrganizer: false }],
        payments: [],
      },
      { // soldée → absente
        id: 'r3', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-22T18:00:00Z'), endTime: D('2026-06-22T19:00:00Z'),
        totalPrice: 20, cancelledAt: null, userId: 'u1',
        resource: { name: 'Court 3', price: 20, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [],
        payments: [{ amount: 20, method: 'CASH', participantId: null, createdAt: D('2026-06-22T19:00:00Z'), refunds: [] }],
      },
      { // annulée → absente
        id: 'r4', status: 'CANCELLED', type: 'COURT',
        startTime: D('2026-06-23T08:00:00Z'), endTime: D('2026-06-23T09:00:00Z'),
        totalPrice: 20, cancelledAt: D('2026-06-22T08:00:00Z'), userId: 'u1',
        resource: { name: 'Court 1', price: 20, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [], payments: [],
      },
    ] as any);

    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.finance.unpaid).toEqual([
      { reservationId: 'r1', participantId: null, startTime: '2026-06-20T18:00:00.000Z', resourceName: 'Court 1', dueAmount: '8.00' },
      { reservationId: 'r2', participantId: 'p-me', startTime: '2026-06-21T18:00:00.000Z', resourceName: 'Court 2', dueAmount: '5.00' },
    ]);
    expect(out.finance.outstanding).toBe('13.00'); // Σ unpaid === outstanding
  });
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/memberStats.service.test.ts -t "finance.unpaid"`
Expected: FAIL — `finance.unpaid` est `undefined`.

- [ ] **Step 3 : Implémentation**

Dans `memberStats.service.ts` :

1. Après l'interface `MemberHistoryReservation`, ajouter :

```ts
export interface MemberUnpaidReservation {
  reservationId: string;
  participantId: string | null; // part d'un participant, null = dû du titulaire
  startTime: string;
  resourceName: string;
  dueAmount: string;            // reste dû du joueur (string décimale)
}
```

2. Dans l'interface `MemberHistory`, sous `outstanding: string;`, ajouter :

```ts
    unpaid: MemberUnpaidReservation[];
```

3. Dans `getMemberHistory`, avant la boucle `const rows: MemberHistoryReservation[] = reservations.map(…)`, déclarer :

```ts
    const unpaid: MemberUnpaidReservation[] = [];
```

4. Remplacer la ligne existante

```ts
      if (r.status === 'CONFIRMED') outstandingCents += Math.max(0, myDue - attrCents);
```

par :

```ts
      if (r.status === 'CONFIRMED') {
        const restCents = Math.max(0, myDue - attrCents);
        outstandingCents += restCents;
        if (restCents > 0) {
          unpaid.push({
            reservationId: r.id,
            participantId: mine?.id ?? null,
            startTime: r.startTime.toISOString(),
            resourceName: r.resource.name,
            dueAmount: euros(restCents),
          });
        }
      }
```

5. Dans le `return`, bloc `finance`, sous `outstanding: euros(outstandingCents),`, ajouter :

```ts
        unpaid,
```

- [ ] **Step 4 : Vérifier que la suite passe**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/memberStats.service.test.ts`
Expected: PASS (tous les tests, anciens compris).

- [ ] **Step 5 : Commit**

```bash
git status   # vérifier qu'on ne stage que nos 2 fichiers
git add backend/src/services/memberStats.service.ts backend/src/services/__tests__/memberStats.service.test.ts
git commit -m "feat(admin): finance.unpaid[] par resa dans le passif membre (Σ = outstanding)"
```

---

### Task 2 : Types frontend — `finance.unpaid` dans `lib/api.ts`

**Files:**
- Modify: `frontend/lib/api.ts` (interface `MemberHistory`, ~ligne 1362)

- [ ] **Step 1 : Ajouter le type**

Au-dessus de `export interface MemberHistory {` :

```ts
export interface MemberUnpaidReservation {
  reservationId: string;
  participantId: string | null;
  startTime: string;
  resourceName: string;
  dueAmount: string;
}
```

Dans `MemberHistory.finance`, sous `outstanding: string;` :

```ts
    unpaid: MemberUnpaidReservation[];
```

- [ ] **Step 2 : Type-check**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur **dans nos fichiers** (ignorer d'éventuelles erreurs de WIP parallèle hors périmètre — grep scoped).

- [ ] **Step 3 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(admin): type MemberUnpaidReservation cote client"
```

---

### Task 3 : Helpers purs `lib/memberCockpit.ts` (TDD)

**Files:**
- Create: `frontend/lib/memberCockpit.ts`
- Test: `frontend/__tests__/memberCockpit.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
import { resasLast30, spent12moCents, reliabilityPct, unpaidTotalCents } from '../lib/memberCockpit';

const NOW = new Date('2026-07-14T12:00:00Z').getTime();

describe('memberCockpit helpers', () => {
  it('resasLast30 : confirmées dans [now−30j, now], annulées et futures exclues', () => {
    const rows = [
      { status: 'CONFIRMED' as const, startTime: '2026-07-01T18:00:00Z' },  // ✓
      { status: 'CONFIRMED' as const, startTime: '2026-06-20T18:00:00Z' },  // ✓ (24 j)
      { status: 'CONFIRMED' as const, startTime: '2026-05-01T18:00:00Z' },  // trop vieux
      { status: 'CONFIRMED' as const, startTime: '2026-07-20T18:00:00Z' },  // futur
      { status: 'CANCELLED' as const, startTime: '2026-07-05T18:00:00Z' },  // annulée
    ];
    expect(resasLast30(rows, NOW)).toBe(2);
  });

  it('spent12moCents : somme des 12 derniers mois calendaires, mois plus vieux exclus', () => {
    const series = [
      { month: '2026-07', net: '20.00' },
      { month: '2026-01', net: '10.50' },
      { month: '2025-08', net: '5.00' },   // il y a 11 mois → inclus
      { month: '2025-07', net: '99.00' },  // il y a 12 mois → exclu
    ];
    expect(spent12moCents(series, NOW)).toBe(3550);
  });

  it('reliabilityPct : 100 − taux d\'annulation, arrondi', () => {
    expect(reliabilityPct(0)).toBe(100);
    expect(reliabilityPct(0.038)).toBe(96);
    expect(reliabilityPct(1)).toBe(0);
  });

  it('unpaidTotalCents : somme des restes dus', () => {
    expect(unpaidTotalCents([{ dueAmount: '8.00' }, { dueAmount: '5.50' }])).toBe(1350);
    expect(unpaidTotalCents([])).toBe(0);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/memberCockpit.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémentation `frontend/lib/memberCockpit.ts`**

```ts
// Helpers purs de la fiche cockpit membre (admin). Paramétrés par nowMs — jamais de Date.now() ici.

const DAY_MS = 86_400_000;

/** Résas confirmées commencées dans les 30 derniers jours (bornes incluses, futur exclu). */
export function resasLast30(
  reservations: Array<{ status: string; startTime: string }>,
  nowMs: number,
): number {
  const from = nowMs - 30 * DAY_MS;
  let n = 0;
  for (const r of reservations) {
    if (r.status !== 'CONFIRMED') continue;
    const t = new Date(r.startTime).getTime();
    if (t >= from && t <= nowMs) n++;
  }
  return n;
}

/** Somme (centimes) du CA des 12 derniers mois calendaires (clés "yyyy-MM"). */
export function spent12moCents(
  revenueByMonth: Array<{ month: string; net: string }>,
  nowMs: number,
): number {
  const now = new Date(nowMs);
  const cur = now.getUTCFullYear() * 12 + now.getUTCMonth();
  let sum = 0;
  for (const { month, net } of revenueByMonth) {
    const idx = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1);
    if (idx > cur || idx <= cur - 12) continue;
    sum += Math.round(Number(net) * 100);
  }
  return sum;
}

/** Fiabilité affichée = 100 − taux d'annulation (0..1), arrondie. */
export function reliabilityPct(cancellationRate: number): number {
  return Math.round((1 - cancellationRate) * 100);
}

/** Total (centimes) des restes dus ligne par ligne. */
export function unpaidTotalCents(unpaid: Array<{ dueAmount: string }>): number {
  return unpaid.reduce((s, u) => s + Math.round(Number(u.dueAmount) * 100), 0);
}
```

- [ ] **Step 4 : Vérifier que ça passe**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/memberCockpit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/memberCockpit.ts frontend/__tests__/memberCockpit.test.ts
git commit -m "feat(admin): helpers purs de la fiche cockpit membre"
```

---

### Task 4 : `FileDashboard.tsx` — état vide du panneau droit

**Files:**
- Create: `frontend/components/admin/members/FileDashboard.tsx`

Pas de suite dédiée (composant purement présentationnel) : il est couvert par le test de page (Task 10, « sans sélection → tableau de bord »).

- [ ] **Step 1 : Implémentation**

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';

const CORAL = '#ff7a4d';

/** État vide du panneau droit : le fichier-membres en chiffres (jamais d'écran blanc). */
export function FileDashboard({ kpis, watchCount }: {
  kpis: { total: number; subscribers: number; activeRecent: number; blocked: number };
  watchCount: number;
}) {
  const { th } = useTheme();
  const tile = (label: string, value: number, color: string) => (
    <div style={{ flex: 1, minWidth: 130, background: th.surface, borderRadius: 16, padding: '18px 20px', boxShadow: th.shadow }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>{label}</div>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 36, fontWeight: 600, letterSpacing: -0.5, marginTop: 6, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {tile('Membres', kpis.total, th.text)}
        {tile('Abonnés', kpis.subscribers, th.accent)}
        {tile('Actifs 30 j', kpis.activeRecent, th.text)}
        {tile('Bloqués', kpis.blocked, kpis.blocked > 0 ? CORAL : th.textFaint)}
      </div>
      {watchCount > 0 && (
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
          👁 {watchCount} membre{watchCount > 1 ? 's' : ''} à surveiller
        </div>
      )}
      <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, margin: '4px 0 0' }}>
        Sélectionnez un membre dans la liste pour ouvrir sa fiche — ↑↓ pour naviguer, Échap pour revenir ici.
      </p>
    </div>
  );
}
```

- [ ] **Step 2 : Commit**

```bash
git add frontend/components/admin/members/FileDashboard.tsx
git commit -m "feat(admin): FileDashboard, etat vide du panneau membres"
```

---

### Task 5 : `CockpitHeader.tsx` — identité, actions, menu ⋯

**Files:**
- Create: `frontend/components/admin/members/CockpitHeader.tsx`

Couvert par `MemberCockpit.test.tsx` (Task 9). Le menu ⋯ suit le pattern popover local (fermeture au clic extérieur via backdrop transparent, pas de dépendance).

- [ ] **Step 1 : Implémentation**

```tsx
'use client';
import { useState, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { Member, MemberHistory } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { colorForSeed } from '@/lib/playerColors';
import { STAFF_LABEL } from '@/lib/members';
import { fmtEuros } from '@/lib/caisse';
import { openDm } from '@/lib/messages';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { StaffRoleMenu, StaffRole } from '@/components/admin/StaffRoleMenu';

const CORAL = '#ff7a4d';
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

export function CockpitHeader({ member, history, watch, unpaidCents, canManageStaff, viewerUserId, onToggleWatch, onToggleBlocked, onSetRole, onDelete, onCollect, onClose }: {
  member: Member;
  history: MemberHistory;
  watch: boolean;
  unpaidCents: number;
  canManageStaff: boolean;
  viewerUserId: string | null;
  onToggleWatch: () => void;
  onToggleBlocked: () => void;
  onSetRole: (role: StaffRole) => void;
  onDelete: () => void;
  onCollect: () => void;          // scrolle vers la carte Argent
  onClose?: () => void;           // mobile : bouton retour
}) {
  const { th } = useTheme();
  const router = useRouter();
  const isDesktop = useIsDesktop(900);
  const [menuOpen, setMenuOpen] = useState(false);
  const [roleAnchor, setRoleAnchor] = useState<{ top: number; bottom: number; right: number } | null>(null);

  const m = history.member;
  const blocked = member.status === 'BLOCKED';
  const showRole = canManageStaff && member.staffRole !== 'OWNER' && member.userId !== viewerUserId;

  const actionBtn: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer',
    borderRadius: 999, padding: '8px 14px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700,
  };
  const menuItem: CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
    cursor: 'pointer', padding: '9px 14px', fontFamily: th.fontUI, fontSize: 13.5, color: th.text,
  };

  const contact = [m.email, m.phone, m.membershipNo ? `n° ${m.membershipNo}` : null].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {onClose && (
          <button onClick={onClose} aria-label="Retour à la liste" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 22, lineHeight: 1, padding: 4 }}>←</button>
        )}
        <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl} size={52} color={colorForSeed(m.userId)} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, letterSpacing: -0.4, color: th.text }}>{m.firstName} {m.lastName}</span>
            {member.staffRole && <Chip tone="accent">{STAFF_LABEL[member.staffRole]}</Chip>}
            {(member.isSubscriber || member.hasActiveSubscription) && (
              <Chip tone="accent">{member.subscriptionPlan ? `Abonné · ${member.subscriptionPlan}` : 'Abonné'}</Chip>
            )}
            {m.hasActivePackage && <Chip tone="line">Carnet</Chip>}
            {blocked && <Chip tone="line">Bloqué</Chip>}
            {watch && <span title="À surveiller" style={{ fontSize: 15 }}>👁</span>}
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {contact} · membre depuis {fmtDate(m.since)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
        {unpaidCents > 0 && (
          <button onClick={onCollect} style={{ ...actionBtn, background: CORAL, color: '#fff' }}>
            💶 Encaisser {fmtEuros(unpaidCents)}
          </button>
        )}
        <button
          onClick={() => openDm(member.userId, { isDesktop, navigate: (href) => router.push(href) })}
          style={{ ...actionBtn, background: th.accent, color: th.onAccent }}
        >💬 Message</button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Plus d'actions"
          style={{ ...actionBtn, background: th.surface, color: th.text, boxShadow: `inset 0 0 0 1px ${th.line}` }}
        >⋯</button>

        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
            <div role="menu" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 31, background: th.surface, borderRadius: 12, boxShadow: th.shadow, minWidth: 220, padding: '6px 0' }}>
              <button role="menuitem" style={menuItem} onClick={() => { setMenuOpen(false); onToggleWatch(); }}>
                👁 {watch ? 'Ne plus surveiller' : 'Marquer à surveiller'}
              </button>
              <button role="menuitem" style={menuItem} onClick={() => { setMenuOpen(false); onToggleBlocked(); }}>
                {blocked ? 'Débloquer' : 'Bloquer'}
              </button>
              {showRole && (
                <button
                  role="menuitem" style={menuItem}
                  aria-label={`Rôle staff de ${m.firstName} ${m.lastName}`}
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenuOpen(false); setRoleAnchor({ top: r.top, bottom: r.bottom, right: r.right }); }}
                >Rôle…</button>
              )}
              <button role="menuitem" style={{ ...menuItem, color: CORAL }} onClick={() => { setMenuOpen(false); onDelete(); }}>
                Supprimer le membre
              </button>
            </div>
          </>
        )}

        {roleAnchor && (
          <StaffRoleMenu
            current={(member.staffRole ?? null) as StaffRole}
            anchor={roleAnchor}
            onPick={(r) => { setRoleAnchor(null); onSetRole(r); }}
            onClose={() => setRoleAnchor(null)}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Type-check puis commit**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit`

```bash
git add frontend/components/admin/members/CockpitHeader.tsx
git commit -m "feat(admin): CockpitHeader (identite + actions + menu overflow)"
```

---

### Task 6 : `MoneyCard.tsx` — impayés, soldes, abonnement, dépliant graphiques

**Files:**
- Create: `frontend/components/admin/members/MoneyCard.tsx`

Comportements clés : encaissement inline **euros** (`amountCents / 100`, pattern `CashRegister`), `payAtClubOnly` → bouton unique méthode `CLUB`, sinon moyens rapides du club (`quickPaymentMethods`, repli `DEFAULT_QUICK_METHODS`) ; verrou `busyKey` anti double-clic ; après succès → `onChanged()` (le cockpit recharge l'history, la page recharge la liste).

- [ ] **Step 1 : Implémentation**

```tsx
'use client';
import { useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import {
  api, Member, MemberHistory, MemberUnpaidReservation, PaymentMethod,
  SubscriptionPlanSummary,
} from '@/lib/api';
import { fmtEuros, toCents, DEFAULT_QUICK_METHODS, QUICK_METHOD_LABEL } from '@/lib/caisse';
import { daysUntil } from '@/lib/subscriptionAdmin';
import { methodLabel } from '@/lib/memberStats';
import { MonthlyRevenueChart } from '@/components/admin/stats/MonthlyRevenueChart';
import { PaymentMethodChart } from '@/components/admin/stats/PaymentMethodChart';
import { PackageBalanceDialog } from '@/components/admin/members/PackageBalanceDialog';
import { SubscriptionActions } from '@/components/admin/subscriptions/SubscriptionActions';

const CORAL = '#ff7a4d';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const money = (v: string) => fmtEuros(toCents(v));

type SubAction = 'renew' | 'change' | 'cancel';
type Bal = MemberHistory['finance']['prepaid']['balances'][number];

export function MoneyCard({ member, history, clubId, token, quickMethods, payAtClubOnly, onChanged, onError }: {
  member: Member;
  history: MemberHistory;
  clubId: string;
  token: string;
  quickMethods: PaymentMethod[];
  payAtClubOnly: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const { th } = useTheme();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pkgAction, setPkgAction] = useState<{ mode: 'recharge' | 'adjust'; bal: Bal } | null>(null);
  const [subAction, setSubAction] = useState<SubAction | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanSummary[] | null>(null);

  const f = history.finance;
  const methods: PaymentMethod[] = payAtClubOnly ? ['CLUB'] : (quickMethods.length ? quickMethods : DEFAULT_QUICK_METHODS);

  const collect = async (u: MemberUnpaidReservation, method: PaymentMethod) => {
    const key = `${u.reservationId}:${u.participantId ?? 'org'}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      await api.adminAddPayment(clubId, u.reservationId, {
        amount: toCents(u.dueAmount) / 100,
        method,
        participantId: u.participantId ?? undefined,
      }, token);
      onChanged();
    } catch (e) {
      onError((e as Error).message === 'PAYMENT_EXCEEDS_DUE'
        ? 'Le reste dû a changé — fiche rechargée.' : (e as Error).message);
      onChanged();
    } finally { setBusyKey(null); }
  };

  const openSubAction = async (kind: SubAction) => {
    if (plans === null) {
      try {
        const p = await api.adminGetSubscriptionPlans(clubId, token);
        setPlans(p.map((x) => ({
          id: x.id, name: x.name, monthlyPrice: x.monthlyPrice, benefit: x.benefit,
          discountPercent: x.discountPercent, sportKeys: x.sportKeys, isActive: x.isActive, activeCount: 0,
        })));
      } catch { setPlans([]); }
    }
    setSubAction(kind);
  };

  const lbl: CSSProperties = { fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute };
  const line: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13, color: th.text };
  const smallBtn: CSSProperties = { border: `1px solid ${th.lineStrong}`, background: th.surface, color: th.text, borderRadius: 999, padding: '4px 10px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };

  const sub = member.subscription ?? null;
  const subDays = sub ? daysUntil(sub.expiresAt, Date.now()) : null;

  return (
    <div id="cockpit-money" style={{ background: th.surface, borderRadius: 16, padding: 16, boxShadow: th.shadow }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={lbl}>💶 Argent</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
          {money(f.totalSpent)} au total · panier moyen {money(f.averageBasket)}
        </span>
      </div>

      {/* Impayés */}
      {f.unpaid.length === 0 ? (
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, padding: '6px 0' }}>✓ Rien à encaisser.</div>
      ) : f.unpaid.map((u) => {
        const key = `${u.reservationId}:${u.participantId ?? 'org'}`;
        return (
          <div key={key} style={line}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: CORAL, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 140 }}>{u.resourceName} · {fmtDateTime(u.startTime)}</span>
            <b>{money(u.dueAmount)}</b>
            <span style={{ display: 'flex', gap: 5 }}>
              {methods.map((mth) => (
                <button key={mth} disabled={busyKey !== null} onClick={() => collect(u, mth)}
                  aria-label={`Encaisser ${money(u.dueAmount)} — ${payAtClubOnly ? 'Au club' : QUICK_METHOD_LABEL[mth] ?? mth}`}
                  style={{ ...smallBtn, opacity: busyKey && busyKey !== key ? 0.5 : 1 }}>
                  {busyKey === key ? '…' : payAtClubOnly ? `Encaissé · ${money(u.dueAmount)}` : (QUICK_METHOD_LABEL[mth] ?? mth)}
                </button>
              ))}
            </span>
          </div>
        );
      })}

      {/* Soldes prépayés */}
      {f.prepaid.balances.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {f.prepaid.balances.map((b) => {
            const expired = !!b.expiresAt && new Date(b.expiresAt).getTime() < Date.now();
            return (
              <div key={b.id} style={line}>
                <span style={{ flex: 1, minWidth: 140 }}>{b.name}</span>
                <b>{b.kind === 'ENTRIES' ? `${b.creditsRemaining ?? 0} entrée(s)` : `${b.amountRemaining ? money(b.amountRemaining) : '0,00 €'}`}</b>
                {b.expiresAt && <span style={{ fontSize: 12, color: expired ? CORAL : th.textFaint }}>{expired ? 'expiré' : `→ ${fmtDate(b.expiresAt)}`}</span>}
                <button style={smallBtn} disabled={expired} onClick={() => setPkgAction({ mode: 'recharge', bal: b })}>Recharger</button>
                <button style={{ ...smallBtn, color: th.textMute }} onClick={() => setPkgAction({ mode: 'adjust', bal: b })}>Corriger</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Abonnement géré */}
      {sub && (
        <div style={{ ...line, borderBottom: 'none', marginTop: 4 }}>
          <span style={{ flex: 1, minWidth: 140 }}>{sub.planName}</span>
          <span style={{
            fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px',
            background: subDays !== null && subDays <= 30 ? '#fdeee2' : '#e3f0e6',
            color: subDays !== null && subDays <= 30 ? '#b45309' : '#2c7a44',
          }}>
            {subDays !== null && subDays <= 30 ? `Expire dans ${subDays} j` : `Actif → ${fmtDate(sub.expiresAt)}`}
          </span>
          <button style={smallBtn} onClick={() => openSubAction('renew')}>Renouveler</button>
          <button style={smallBtn} onClick={() => openSubAction('change')}>Changer</button>
          <button style={{ ...smallBtn, color: CORAL, borderColor: '#f0b8a4' }} onClick={() => openSubAction('cancel')}>Résilier</button>
        </div>
      )}

      {/* Dépliant : graphiques + consommation */}
      <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, padding: '10px 0 0' }}>
        {expanded ? 'Réduire ▴' : 'Détails (CA, moyens de paiement) ▾'}
      </button>
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <MonthlyRevenueChart series={f.revenueByMonth} />
          <PaymentMethodChart byMethod={f.paymentsByMethod} />
          {f.prepaid.consumption.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {f.prepaid.consumption.slice(0, 10).map((c, i) => (
                <li key={i} style={{ display: 'flex', gap: 8, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                  <span>{fmtDateTime(c.at)}</span><span>· {c.packageName}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600, color: th.text }}>{methodLabel(c.method)} {money(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pkgAction && (
        <PackageBalanceDialog clubId={clubId} userId={member.userId} token={token}
          mode={pkgAction.mode} bal={pkgAction.bal}
          onClose={() => setPkgAction(null)} onDone={() => { setPkgAction(null); onChanged(); }} />
      )}
      {subAction && sub && plans !== null && (
        <SubscriptionActions action={subAction}
          sub={{ id: sub.id, planId: sub.planId, planName: sub.planName, expiresAt: sub.expiresAt, monthlyPriceSnapshot: sub.monthlyPriceSnapshot }}
          plans={plans} clubId={clubId} token={token}
          onClose={() => setSubAction(null)} onDone={() => { setSubAction(null); onChanged(); }} />
      )}
    </div>
  );
}
```

Note : en mode `payAtClubOnly`, `methods = ['CLUB']` → un **seul** bouton par ligne, libellé « Encaissé · {montant} » (miroir CashRegister/CollectPanel).

- [ ] **Step 2 : Type-check puis commit**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit`

```bash
git add frontend/components/admin/members/MoneyCard.tsx
git commit -m "feat(admin): MoneyCard (impayes inline, soldes, abonnement, depliant)"
```

---

### Task 7 : `LifeCard.tsx` + `GameCard.tsx`

**Files:**
- Create: `frontend/components/admin/members/LifeCard.tsx`
- Create: `frontend/components/admin/members/GameCard.tsx`

- [ ] **Step 1 : `LifeCard.tsx`**

```tsx
'use client';
import { useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { MemberHistory } from '@/lib/api';
import { Chip } from '@/components/ui/atoms';
import { DayHourHeatmap } from '@/components/admin/stats/DayHourHeatmap';
import { weekdayLabel, cancellationLabel } from '@/lib/memberStats';
import { fmtEuros, toCents } from '@/lib/caisse';

const STATUS_FR: Record<string, string> = { CONFIRMED: 'Confirmée', CANCELLED: 'Annulée', PENDING: 'En attente' };
const TYPE_FR: Record<string, string> = { COURT: 'Terrain', COACHING: 'Cours', TOURNAMENT: 'Tournoi', EVENT: 'Event' };
const TYPE_ICON: Record<string, string> = { COURT: '🎾', COACHING: '📋', TOURNAMENT: '🏆', EVENT: '⚡' };
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export function LifeCard({ history, multiSport }: { history: MemberHistory; multiSport: boolean }) {
  const { th } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [onlyLate, setOnlyLate] = useState(false);

  const { counts, favorites, loyalty } = history;
  const recent = history.reservations.slice(0, 4);
  const full = onlyLate ? history.reservations.filter((r) => r.lateCancel) : history.reservations;

  const lbl: CSSProperties = { fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute };
  const line: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13, color: th.text };
  const td: CSSProperties = { padding: '7px 10px', fontFamily: th.fontUI, fontSize: 12.5, color: th.text, whiteSpace: 'nowrap' };

  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: 16, boxShadow: th.shadow }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={lbl}>📅 Vie au club</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
          {counts.confirmed} confirmées · {counts.upcoming} à venir · annule {cancellationLabel(loyalty.cancellationRate)}
        </span>
      </div>

      {recent.length === 0 ? (
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, padding: '6px 0' }}>Aucune activité pour l'instant.</div>
      ) : recent.map((r) => (
        <div key={r.id} style={{ ...line, opacity: r.status === 'CANCELLED' ? 0.6 : 1 }}>
          <span aria-hidden>{TYPE_ICON[r.type] ?? '🎾'}</span>
          <span style={{ flex: 1, minWidth: 120 }}>{r.resourceName} · {fmtDateTime(r.startTime)}</span>
          <Chip tone={r.status === 'CANCELLED' ? 'line' : 'accent'}>{STATUS_FR[r.status] ?? r.status}{r.lateCancel ? ' (tardive)' : ''}</Chip>
        </div>
      ))}

      <div style={{ marginTop: 12 }}>
        <DayHourHeatmap matrix={history.heatmap} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {favorites.weekday && <Chip tone="mute">Plutôt le {weekdayLabel(favorites.weekday)}</Chip>}
        {favorites.resource && <Chip tone="mute">{favorites.resource.name} favori</Chip>}
        {multiSport && favorites.sportKey && <Chip tone="mute">Sport : {favorites.sportKey}</Chip>}
      </div>

      <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, padding: '10px 0 0' }}>
        {expanded ? 'Réduire ▴' : `Tout l'historique (${counts.total}) ▾`}
      </button>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyLate} onChange={(e) => setOnlyLate(e.target.checked)} style={{ width: 15, height: 15, accentColor: th.accent, cursor: 'pointer' }} />
            Annulations tardives seulement ({counts.lateCancelled})
          </label>
          <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
              <tbody>
                {full.map((r) => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${th.line}`, opacity: r.status === 'CANCELLED' ? 0.6 : 1 }}>
                    <td style={td}>{fmtDateTime(r.startTime)}</td>
                    <td style={td}>{r.resourceName}</td>
                    <td style={td}>{TYPE_FR[r.type] ?? r.type}</td>
                    <td style={td}>{STATUS_FR[r.status] ?? r.status}{r.lateCancel ? ' (tardive)' : ''}</td>
                    <td style={{ ...td, fontWeight: 600, textAlign: 'right' }}>{fmtEuros(toCents(r.attributedAmount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, marginTop: 6 }}>
            {counts.cancelled} annulées · {counts.lateCancelled} tardives · {counts.noShow} no-show (estimation)
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : `GameCard.tsx`**

```tsx
'use client';
import { useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { MemberHistory, AdminMemberLevel, UserLevel } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { winRate } from '@/lib/memberStats';
import { LevelHistoryChart } from '@/components/player/LevelHistoryChart';
import { ReliabilityMeter } from '@/components/player/ReliabilityMeter';
import { LevelOverrideForm } from '@/components/admin/LevelOverrideForm';

export function GameCard({ history, levelData, clubId, userId, token, clubSports, onSaved }: {
  history: MemberHistory;
  levelData: AdminMemberLevel | null;
  clubId: string;
  userId: string;
  token: string;
  clubSports: { key: string; name: string }[];
  onSaved: () => void;
}) {
  const { th } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const g = history.game;
  const wr = winRate(g.wins, g.losses);

  const lbl: CSSProperties = { fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute };
  const stat = (label: string, value: string) => (
    <div style={{ minWidth: 70 }}>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 20, fontWeight: 600, color: th.text }}>{value}</div>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>{label}</div>
    </div>
  );

  const nameByKey = new Map(clubSports.map((s) => [s.key, s.name]));
  const formSports = clubSports.length > 0
    ? clubSports
    : Object.keys(levelData?.levels ?? {}).map((key) => ({ key, name: key }));
  const levelEntries: [string, UserLevel][] = Object.entries(levelData?.levels ?? {});

  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: 16, boxShadow: th.shadow }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={lbl}>🎾 Jeu</span>
        {g.isProvisional && <span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textFaint }}>en calibrage</span>}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {stat('niveau', g.level != null ? g.level.toFixed(1) : '—')}
        {stat('matchs', String(g.matchesPlayed))}
        {stat('V – D', `${g.wins}–${g.losses}`)}
        {stat('victoires', wr != null ? `${wr} %` : '—')}
      </div>
      {g.frequentPartners.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {g.frequentPartners.slice(0, 3).map((p) => (
            <div key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
              <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={null} size={24} color={colorForSeed(p.userId)} />
              {p.firstName} {p.lastName}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: th.textMute }}>×{p.count}</span>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, padding: '10px 0 0' }}>
        {expanded ? 'Réduire ▴' : 'Progression & correction ▾'}
      </button>
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <LevelHistoryChart points={g.levelPoints} />
          {levelEntries.map(([key, lvl]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontFamily: th.fontUI, fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: th.textMute, minWidth: 70 }}>{nameByKey.get(key) ?? key}</span>
              <span style={{ fontFamily: th.fontDisplay, fontSize: 18, fontWeight: 700, color: th.text }}>{lvl.level.toFixed(1)}</span>
              <span style={{ color: th.textMute }}>{lvl.tier}</span>
              <ReliabilityMeter pct={lvl.reliability} />
            </div>
          ))}
          <LevelOverrideForm clubId={clubId} userId={userId} token={token} sports={formSports} onSaved={onSaved} />
          {(levelData?.history ?? []).length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(levelData?.history ?? []).map((h) => (
                <li key={h.id} style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                  <b style={{ color: th.text }}>{h.previousLevel != null ? h.previousLevel.toFixed(1) : '—'} → {h.newLevel.toFixed(1)}</b>
                  {' '}· par {h.staffFirstName} {h.staffLastName}
                  {h.reason ? ` · ${h.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3 : Type-check puis commit**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit`

```bash
git add frontend/components/admin/members/LifeCard.tsx frontend/components/admin/members/GameCard.tsx
git commit -m "feat(admin): LifeCard (activites + heatmap) et GameCard (niveau + correction)"
```

---

### Task 8 : `NotesCard.tsx` — infos éditables + fil de notes

**Files:**
- Create: `frontend/components/admin/members/NotesCard.tsx`

Reprend l'édition de l'ex-`MemberPanel` (téléphone / n° adhérent / note / case Abonné, via `api.adminUpdateMember` sur `member.id`) et le fil de notes de l'ex-onglet Notes (`adminGetMemberNotes`/`adminAddMemberNote`/`adminDeleteMemberNote` — les notes sont chargées par le cockpit et passées en props).

- [ ] **Step 1 : Implémentation**

```tsx
'use client';
import { useState, useEffect, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, Member, MemberNote } from '@/lib/api';

const CORAL = '#ff7a4d';
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export function NotesCard({ member, notes, clubId, token, onChanged, onNotesChanged, onError }: {
  member: Member;
  notes: MemberNote[];
  clubId: string;
  token: string;
  onChanged: () => void;                       // infos enregistrées → recharge liste + fiche
  onNotesChanged: (next: MemberNote[]) => void;
  onError: (msg: string) => void;
}) {
  const { th } = useTheme();
  const [draft, setDraft] = useState({ phone: '', membershipNo: '', note: '', isSubscriber: false });
  const [busy, setBusy] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    setDraft({ phone: member.phone ?? '', membershipNo: member.membershipNo ?? '', note: member.note ?? '', isSubscriber: member.isSubscriber });
  }, [member.userId, member.phone, member.membershipNo, member.note, member.isSubscriber]);

  const save = async () => {
    setBusy(true);
    try {
      await api.adminUpdateMember(clubId, member.id, {
        phone: draft.phone || null, membershipNo: draft.membershipNo || null,
        note: draft.note || null, isSubscriber: draft.isSubscriber,
      }, token);
      onChanged();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  const addNote = async () => {
    if (!noteBody.trim()) return;
    setAddingNote(true);
    try {
      const created = await api.adminAddMemberNote(clubId, member.userId, noteBody.trim(), token);
      onNotesChanged([created, ...notes]);
      setNoteBody('');
    } catch (e) { onError((e as Error).message); }
    finally { setAddingNote(false); }
  };

  const deleteNote = async (id: string) => {
    try {
      await api.adminDeleteMemberNote(clubId, member.userId, id, token);
      onNotesChanged(notes.filter((n) => n.id !== id));
      setConfirmDelete(null);
    } catch (e) { onError((e as Error).message); }
  };

  const lbl: CSSProperties = { fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute };
  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 9, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 13.5, width: '100%' };
  const fieldLbl: CSSProperties = { ...lbl, display: 'block', marginBottom: 4, fontSize: 10.5 };

  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: 16, boxShadow: th.shadow }}>
      <div style={{ marginBottom: 10 }}><span style={lbl}>📝 Notes & infos</span></div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <span style={fieldLbl}>Téléphone</span>
            <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="—" style={input} />
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <span style={fieldLbl}>N° adhérent</span>
            <input value={draft.membershipNo} onChange={(e) => setDraft({ ...draft, membershipNo: e.target.value })} placeholder="—" style={input} />
          </div>
        </div>
        <div>
          <span style={fieldLbl}>Note</span>
          <textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="—" rows={2} style={{ ...input, resize: 'vertical' }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
          <input type="checkbox" checked={draft.isSubscriber} onChange={(e) => setDraft({ ...draft, isSubscriber: e.target.checked })} style={{ width: 16, height: 16, accentColor: th.accent, cursor: 'pointer' }} />
          Abonné (fenêtre de réservation élargie)
        </label>
        <div>
          <button onClick={save} disabled={busy}
            style={{ border: 'none', cursor: busy ? 'default' : 'pointer', borderRadius: 10, padding: '9px 16px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, background: th.accent, color: th.onAccent, opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${th.line}`, marginTop: 14, paddingTop: 12 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Ajouter un commentaire…" style={{ ...input, flex: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }} />
          <button onClick={addNote} disabled={addingNote || !noteBody.trim()}
            style={{ border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 10, padding: '0 14px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: addingNote || !noteBody.trim() ? 0.5 : 1 }}>
            {addingNote ? '…' : 'Ajouter'}
          </button>
        </div>
        {notes.length === 0 ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, margin: 0 }}>Aucun commentaire du staff.</p>
        ) : notes.map((n) => (
          <div key={n.id} style={{ borderLeft: `3px solid ${th.line}`, paddingLeft: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: th.fontUI }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: th.text }}>{n.author ? `${n.author.firstName} ${n.author.lastName}` : 'Staff'}</span>
              <span style={{ fontSize: 11.5, color: th.textFaint }}>{fmtDateTime(n.createdAt)}</span>
              {confirmDelete === n.id ? (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button onClick={() => deleteNote(n.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: CORAL, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700 }}>Confirmer</button>
                  <button onClick={() => setConfirmDelete(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 11.5 }}>Annuler</button>
                </span>
              ) : (
                <button onClick={() => setConfirmDelete(n.id)} aria-label="Supprimer le commentaire"
                  style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5 }}>Supprimer</button>
              )}
            </div>
            <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text, marginTop: 2, whiteSpace: 'pre-wrap' }}>{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Type-check puis commit**

```bash
git add frontend/components/admin/members/NotesCard.tsx
git commit -m "feat(admin): NotesCard (infos editables + fil de notes staff)"
```

---

### Task 9 : `MemberCockpit.tsx` — orchestrateur + suite RTL

**Files:**
- Create: `frontend/components/admin/members/MemberCockpit.tsx`
- Test: `frontend/__tests__/MemberCockpit.test.tsx`

- [ ] **Step 1 : Écrire la suite RTL (échoue : module manquant)**

Points couverts : chargement parallèle, header + KPI, encaissement inline (appel `adminAddPayment` euros + `participantId`), `payAtClubOnly` → bouton unique, gating carte Jeu, erreur API. Mock `lib/api` complet (exposer `assetUrl` — piège connu) :

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemberCockpit } from '../components/admin/members/MemberCockpit';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const HISTORY = {
  member: {
    userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr', phone: '0601020304',
    avatarUrl: null, isSubscriber: true, membershipNo: 'PAR1001', status: 'ACTIVE',
    watch: false, hasActivePackage: true, since: '2022-07-01T00:00:00Z',
  },
  reservations: [
    { id: 'r1', status: 'CONFIRMED', type: 'COURT', startTime: '2026-07-10T18:00:00Z', endTime: '2026-07-10T19:00:00Z', cancelledAt: null, lateCancel: false, resourceName: 'Court 1', sportKey: 'padel', isOrganizer: true, attributedAmount: '12.00' },
  ],
  counts: { total: 1, confirmed: 1, cancelled: 0, lateCancelled: 0, noShow: 0, upcoming: 0 },
  heatmap: Array.from({ length: 7 }, () => new Array(24).fill(0)),
  favorites: { resource: { name: 'Court 1', count: 1 }, sportKey: 'padel', weekday: 4 },
  finance: {
    totalSpent: '120.00', averageBasket: '12.00', outstanding: '8.00',
    unpaid: [{ reservationId: 'r1', participantId: 'p-me', startTime: '2026-07-10T18:00:00Z', resourceName: 'Court 1', dueAmount: '8.00' }],
    paymentsByMethod: { CARD: '120.00' },
    revenueByMonth: [{ month: '2026-07', net: '20.00' }],
    prepaid: { balances: [], consumption: [] },
  },
  game: { sportKey: 'padel', level: 5.5, tier: 'Confirmé', isProvisional: false, matchesPlayed: 20, levelPoints: [], wins: 14, losses: 6, frequentPartners: [] },
  loyalty: { firstVisitAt: '2022-07-01T00:00:00Z', lastVisitAt: '2026-07-10T18:00:00Z', daysSinceLastVisit: 4, tenureDays: 1474, playsPerMonth: 4, cancellationRate: 0.04, atRisk: false },
};

const MEMBER = {
  id: 'mship-1', userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr',
  phone: '0601020304', isSubscriber: true, membershipNo: 'PAR1001', status: 'ACTIVE' as const,
  note: null, staffRole: null, avatarUrl: null, subscription: null, hasActiveSubscription: false,
};

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    adminGetMemberHistory: jest.fn(),
    adminGetMemberNotes: jest.fn().mockResolvedValue([]),
    adminGetMemberLevel: jest.fn().mockResolvedValue(null),
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'pay-1' }),
    adminGetSubscriptionPlans: jest.fn().mockResolvedValue([]),
    adminUpdateMember: jest.fn(),
    adminAddMemberNote: jest.fn(),
    adminDeleteMemberNote: jest.fn(),
  },
}));
// Club mutable : chaque test peut ajuster levelSystemEnabled / payAtClubOnly sans spy fragile.
let CLUB: Record<string, unknown> = {};
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: CLUB }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('../lib/api');

const baseProps = {
  member: MEMBER as never,
  viewerUserId: 'viewer-1',
  canManageStaff: true,
  onChanged: jest.fn(),
  onSetRole: jest.fn(),
  onToggleBlocked: jest.fn(),
  onDelete: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  CLUB = {
    id: 'club-1', levelSystemEnabled: true, quickPaymentMethods: ['CARD', 'CASH'], payAtClubOnly: false,
    clubSports: [{ sport: { key: 'padel', name: 'Padel' } }],
  };
  api.adminGetMemberHistory.mockResolvedValue(JSON.parse(JSON.stringify(HISTORY)));
  api.adminGetMemberNotes.mockResolvedValue([]);
  api.adminGetMemberLevel.mockResolvedValue(null);
});

// ⚠️ fmtEuros insère des espaces insécables (« 8,00 € ») → toujours matcher par regex
// souple /Encaisser/ + /CB/, jamais par égalité stricte de chaîne avec montant.
describe('MemberCockpit', () => {
  it('charge et affiche header + KPI + cartes', async () => {
    render(<MemberCockpit {...baseProps} />);
    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getByText(/Encaisser/)).toBeInTheDocument();              // action header (dû > 0)
    expect(screen.getByText(/💶 Argent/)).toBeInTheDocument();
    expect(screen.getByText(/Vie au club/)).toBeInTheDocument();
    expect(screen.getByText(/🎾 Jeu/)).toBeInTheDocument();
    expect(screen.getByText(/Notes & infos/)).toBeInTheDocument();
  });

  it('encaisse une ligne impayée : adminAddPayment en euros avec participantId, puis onChanged', async () => {
    render(<MemberCockpit {...baseProps} />);
    await screen.findByText('Jean Dupont');
    fireEvent.click(screen.getByRole('button', { name: /Encaisser .*CB/ }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'r1', { amount: 8, method: 'CARD', participantId: 'p-me' }, 'tok',
    ));
    await waitFor(() => expect(baseProps.onChanged).toHaveBeenCalled());
  });

  it('carte Jeu masquée si le club a désactivé le niveau', async () => {
    CLUB = { ...CLUB, levelSystemEnabled: false };
    render(<MemberCockpit {...baseProps} />);
    await screen.findByText('Jean Dupont');
    expect(screen.queryByText(/🎾 Jeu/)).not.toBeInTheDocument();
  });

  it('payAtClubOnly : un seul bouton « Encaissé » par ligne, méthode CLUB', async () => {
    CLUB = { ...CLUB, payAtClubOnly: true };
    render(<MemberCockpit {...baseProps} />);
    await screen.findByText('Jean Dupont');
    const btns = screen.getAllByRole('button', { name: /Encaisser .*Au club/ });
    expect(btns).toHaveLength(1);
    fireEvent.click(btns[0]);
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'r1', { amount: 8, method: 'CLUB', participantId: 'p-me' }, 'tok',
    ));
  });

  it('échec du chargement → message d\'erreur, pas d\'écran blanc', async () => {
    api.adminGetMemberHistory.mockRejectedValue(new Error('MEMBER_NOT_FOUND'));
    render(<MemberCockpit {...baseProps} />);
    expect(await screen.findByText(/Membre introuvable/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/MemberCockpit.test.tsx`
Expected: FAIL — `MemberCockpit` introuvable.

- [ ] **Step 3 : Implémentation `MemberCockpit.tsx`**

```tsx
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { api, Member, MemberHistory, MemberNote, AdminMemberLevel } from '@/lib/api';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { resasLast30, spent12moCents, reliabilityPct, unpaidTotalCents } from '@/lib/memberCockpit';
import { fmtEuros } from '@/lib/caisse';
import { StaffRole } from '@/components/admin/StaffRoleMenu';
import { CockpitHeader } from './CockpitHeader';
import { MoneyCard } from './MoneyCard';
import { LifeCard } from './LifeCard';
import { GameCard } from './GameCard';
import { NotesCard } from './NotesCard';

const CORAL = '#ff7a4d';

export function MemberCockpit({ member, viewerUserId, canManageStaff, onChanged, onSetRole, onToggleBlocked, onDelete, onClose }: {
  member: Member;
  viewerUserId: string | null;
  canManageStaff: boolean;
  onChanged: () => void;            // recharge la liste côté page
  onSetRole: (role: StaffRole) => void;
  onToggleBlocked: () => void;
  onDelete: () => void;
  onClose?: () => void;             // mobile
}) {
  const { th } = useTheme();
  const { token } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const levelEnabled = club?.levelSystemEnabled !== false;
  const multiSport = clubIsMultiSport(club as Parameters<typeof clubIsMultiSport>[0]);
  const clubSports = ((club as { clubSports?: { sport: { key: string; name: string } }[] } | null)?.clubSports ?? [])
    .map((cs) => ({ key: cs.sport.key, name: cs.sport.name }));

  const [history, setHistory] = useState<MemberHistory | null>(null);
  const [notes, setNotes] = useState<MemberNote[]>([]);
  const [levelData, setLevelData] = useState<AdminMemberLevel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watch, setWatch] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      setError(null);
      const [h, n, lvl] = await Promise.all([
        api.adminGetMemberHistory(clubId, member.userId, token),
        api.adminGetMemberNotes(clubId, member.userId, token).catch(() => [] as MemberNote[]),
        levelEnabled ? api.adminGetMemberLevel(clubId, member.userId, token).catch(() => null) : Promise.resolve(null),
      ]);
      if (reqId !== reqIdRef.current) return;
      setHistory(h); setNotes(n); setLevelData(lvl); setWatch(h.member.watch); setNowMs(Date.now());
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError((e as Error).message === 'MEMBER_NOT_FOUND' ? 'Membre introuvable dans ce club.' : (e as Error).message);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [token, clubId, member.userId, levelEnabled]);

  useEffect(() => { load(); }, [load]);

  const toggleWatch = async () => {
    if (!token || !clubId) return;
    const next = !watch;
    setWatch(next);
    try { await api.adminSetMemberWatch(clubId, member.userId, next, token); onChanged(); }
    catch (e) { setWatch(!next); setError((e as Error).message); }
  };

  const refresh = () => { load(); onChanged(); };

  if (loading && !history) return <div style={{ padding: '28px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (error && !history) return <div style={{ padding: '18px 0', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: CORAL }}>{error}</div>;
  if (!history || !token || !clubId) return null;

  const unpaidCents = unpaidTotalCents(history.finance.unpaid);
  const kpi = (label: string, value: string, coral?: boolean) => (
    <div style={{ flex: 1, minWidth: 96, background: th.surface, borderRadius: 12, padding: '8px 12px', boxShadow: th.shadow }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>{label}</div>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 19, fontWeight: 600, marginTop: 2, color: coral ? CORAL : th.text, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <CockpitHeader
        member={member} history={history} watch={watch} unpaidCents={unpaidCents}
        canManageStaff={canManageStaff} viewerUserId={viewerUserId}
        onToggleWatch={toggleWatch} onToggleBlocked={onToggleBlocked} onSetRole={onSetRole} onDelete={onDelete}
        onCollect={() => document.getElementById('cockpit-money')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        onClose={onClose}
      />

      {error && <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: CORAL }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {kpi('Résas 30 j', String(resasLast30(history.reservations, nowMs)))}
        {kpi('Reste dû', fmtEuros(unpaidCents), unpaidCents > 0)}
        {kpi('Niveau', history.game.level != null ? history.game.level.toFixed(1) : '—')}
        {kpi('Fiabilité', `${reliabilityPct(history.loyalty.cancellationRate)} %`)}
        {kpi('Dépensé 12 mois', fmtEuros(spent12moCents(history.finance.revenueByMonth, nowMs)))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, alignItems: 'start' }}>
        <MoneyCard member={member} history={history} clubId={clubId} token={token}
          quickMethods={club?.quickPaymentMethods ?? []} payAtClubOnly={club?.payAtClubOnly === true}
          onChanged={refresh} onError={setError} />
        <LifeCard history={history} multiSport={multiSport} />
        {levelEnabled && (
          <GameCard history={history} levelData={levelData} clubId={clubId} userId={member.userId}
            token={token} clubSports={clubSports} onSaved={refresh} />
        )}
        <NotesCard member={member} notes={notes} clubId={clubId} token={token}
          onChanged={refresh} onNotesChanged={setNotes} onError={setError} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Vérifier que la suite passe**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/MemberCockpit.test.tsx`
Expected: PASS (5 tests). Si `useIsDesktop`/`IntersectionObserver` râlent, les stubs de `jest.setup.ts` couvrent déjà `matchMedia`/observers.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/admin/members/MemberCockpit.tsx frontend/__tests__/MemberCockpit.test.tsx
git commit -m "feat(admin): MemberCockpit, fiche 360 en place (fetch parallele + 4 cartes)"
```

---

### Task 10 : Page maître-détail — réécriture de `page.tsx` + `MemberRow` simplifiée + suppression `MemberPanel`

**Files:**
- Modify: `frontend/app/admin/members/page.tsx`
- Modify: `frontend/components/admin/members/MemberRow.tsx`
- Delete: `frontend/components/admin/members/MemberPanel.tsx`
- Modify: `frontend/__tests__/AdminMembersNav.test.tsx` (réécrit), `frontend/__tests__/AdminMembersFilters.test.tsx`, `frontend/__tests__/AdminMembersStaff.test.tsx`, `frontend/__tests__/MemberRow.test.tsx` (adaptés)

- [ ] **Step 1 : Réécrire `AdminMembersNav.test.tsx` (échoue d'abord)**

Remplacer le contenu par :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminMembersPage from '../app/admin/members/page';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ club: { id: 'club-1', levelSystemEnabled: true, quickPaymentMethods: [], payAtClubOnly: false, clubSports: [] } }),
}));
jest.mock('../lib/useIsDesktop', () => ({ useIsDesktop: () => true }));

const MEMBERS = [
  { id: 'm1', userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr', phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, staffRole: null, watch: false },
  { id: 'm2', userId: 'u2', firstName: 'Sarah', lastName: 'Petit', email: 's@p.fr', phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, staffRole: null, watch: false },
];

const HISTORY = {
  member: { userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr', phone: null, avatarUrl: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', watch: false, hasActivePackage: false, since: '2024-01-01T00:00:00Z' },
  reservations: [], counts: { total: 0, confirmed: 0, cancelled: 0, lateCancelled: 0, noShow: 0, upcoming: 0 },
  heatmap: Array.from({ length: 7 }, () => new Array(24).fill(0)),
  favorites: { resource: null, sportKey: null, weekday: null },
  finance: { totalSpent: '0.00', averageBasket: '0.00', outstanding: '0.00', unpaid: [], paymentsByMethod: {}, revenueByMonth: [], prepaid: { balances: [], consumption: [] } },
  game: { sportKey: 'padel', level: null, tier: null, isProvisional: false, matchesPlayed: 0, levelPoints: [], wins: 0, losses: 0, frequentPartners: [] },
  loyalty: { firstVisitAt: null, lastVisitAt: null, daysSinceLastVisit: null, tenureDays: 0, playsPerMonth: 0, cancellationRate: 0, atRisk: false },
};

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    adminGetMembers: jest.fn(),
    getMyClubs: jest.fn().mockResolvedValue([{ clubId: 'club-1', role: 'OWNER' }]),
    getMyProfile: jest.fn().mockResolvedValue({ id: 'viewer-1' }),
    adminGetMemberHistory: jest.fn(),
    adminGetMemberNotes: jest.fn().mockResolvedValue([]),
    adminGetMemberLevel: jest.fn().mockResolvedValue(null),
    adminGetSubscriptionPlans: jest.fn().mockResolvedValue([]),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('../lib/api');

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/admin/members');
  api.adminGetMembers.mockResolvedValue(JSON.parse(JSON.stringify(MEMBERS)));
  api.adminGetMemberHistory.mockResolvedValue(JSON.parse(JSON.stringify(HISTORY)));
});

describe('AdminMembers — maître-détail', () => {
  it('sans sélection : tableau de bord du fichier dans le panneau droit', async () => {
    render(<AdminMembersPage />);
    await screen.findByText('Jean Dupont');
    expect(screen.getByText(/Sélectionnez un membre/)).toBeInTheDocument();
  });

  it('clic sur une ligne → fiche cockpit à droite + ?m= dans l\'URL', async () => {
    render(<AdminMembersPage />);
    fireEvent.click(await screen.findByText('Jean Dupont'));
    await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalledWith('club-1', 'u1', 'tok'));
    expect(window.location.search).toContain('m=u1');
  });

  it('deep-link ?m=u2 au montage → fiche de Sarah ouverte', async () => {
    window.history.replaceState(null, '', '/admin/members?m=u2');
    api.adminGetMemberHistory.mockResolvedValue({ ...JSON.parse(JSON.stringify(HISTORY)), member: { ...HISTORY.member, userId: 'u2', firstName: 'Sarah', lastName: 'Petit' } });
    render(<AdminMembersPage />);
    await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalledWith('club-1', 'u2', 'tok'));
  });

  it('Échap désélectionne (retour au tableau de bord)', async () => {
    render(<AdminMembersPage />);
    fireEvent.click(await screen.findByText('Jean Dupont'));
    await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalled());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText(/Sélectionnez un membre/)).toBeInTheDocument();
    expect(window.location.search).not.toContain('m=');
  });

  it('↓ sélectionne le membre suivant de la liste visible', async () => {
    render(<AdminMembersPage />);
    fireEvent.click(await screen.findByText('Jean Dupont'));
    await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalledWith('club-1', 'u1', 'tok'));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(api.adminGetMemberHistory).toHaveBeenCalledWith('club-1', 'u2', 'tok'));
  });
});
```

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/AdminMembersNav.test.tsx`
Expected: FAIL (la page actuelle ouvre le `MemberPanel`, pas de cockpit ni de `?m=`).

- [ ] **Step 2 : Simplifier `MemberRow.tsx`**

Supprimer : le prop `onNavigate`, le `<span role="link">` (le nom devient un simple `<span>` avec les mêmes styles), les boutons `subActionBtn`/`onSubAction`/`SubActionKind` du bloc `subscriptionContext` (garder **seulement** la pastille échéance + date). Signature finale :

```tsx
export function MemberRow({ m, selected, nowMs, onOpen, subscriptionContext }: {
  m: Member;
  selected: boolean;
  nowMs: number;
  onOpen: () => void;
  /** En contexte abonnés : la ligne montre l'échéance de l'abonnement (les actions vivent dans la fiche). */
  subscriptionContext?: boolean;
})
```

Le bloc `subscriptionContext && m.subscription` ne rend plus que la pastille « Expire dans N j »/« Actif » + la ligne « échéance {date} » (code existant, boutons retirés). Supprimer les imports devenus inutiles (`Theme`, `subActionBtn`) et l'export `SubActionKind`.

- [ ] **Step 3 : Réécrire `page.tsx` en maître-détail**

Points de structure (le reste — état, `load`, filtres, virtualisation, CSV, `AddMemberDialog`, `ConfirmDialog`, `STAFF_ERRORS` — est conservé tel quel) :

1. **Imports** : retirer `MemberPanel`/`MemberDraft`, `SubscriptionActions`, `SubActionKind` ; ajouter `MemberCockpit`, `FileDashboard`.
2. **Sélection + URL** — remplacer `setSelectedUserId` par :

```tsx
  const select = useCallback((uid: string | null) => {
    setSelectedUserId(uid);
    const url = new URL(window.location.href);
    if (uid) url.searchParams.set('m', uid); else url.searchParams.delete('m');
    window.history.replaceState(null, '', url.toString());
  }, []);

  // Deep-link ?m= (et ?plan= existant) — one-shot au montage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const planId = sp.get('plan');
    if (planId) { setSeg('subs'); setPlanFilter(planId); }
    const m = sp.get('m');
    if (m) setSelectedUserId(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

3. **Clavier** :

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape') { select(null); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const idx = visible.findIndex((m) => m.userId === selectedUserId);
      const next = e.key === 'ArrowDown' ? Math.min(visible.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (visible[next]) select(visible[next].userId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selectedUserId, select]);
```

4. **Suppression** des handlers `save` (migré dans NotesCard) et de l'état `subAction` + du rendu `SubscriptionActions` (migrés dans MoneyCard). `toggleBlocked`, `setRole`, `remove`, `confirmRemove` restent (passés au cockpit) ; après `remove`, appeler `select(null)`.
5. **Bandeau KPI du header supprimé** (les fonctions `kpiStat`/`kpiSep` disparaissent) — le `<h1>` reste seul avec le sous-titre.
6. **Layout** — remplacer le bloc « Liste + panneau » :

```tsx
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {/* Colonne liste */}
            <div style={{ flex: isDesktop ? '0 0 360px' : 1, minWidth: 0 }}>
              {/* … liste virtualisée existante, MemberRow sans onNavigate :
                   onOpen={() => select(m.userId)} … */}
            </div>

            {/* Panneau droit (desktop) */}
            {isDesktop && (
              <div style={{ flex: 1, minWidth: 0 }}>
                {selected ? (
                  <MemberCockpit
                    member={selected} viewerUserId={viewer?.userId ?? null} canManageStaff={canManageStaff}
                    onChanged={load} onSetRole={setRole} onToggleBlocked={toggleBlocked}
                    onDelete={() => setConfirmRemove(selected)}
                  />
                ) : seg === 'subs' ? (
                  <SubscriberInsights th={th} subscribers={subsBase} plans={plans} nowMs={nowMs} multiSport={multiSport} sportName={sportName}
                    planFilter={planFilter} onPlanFilter={setPlanFilter}
                    expiringOnly={expiringOnly} onToggleExpiring={() => setExpiringOnly((v) => !v)}
                    sportFilter={sportFilter} onSportFilter={setSportFilter} />
                ) : (
                  <FileDashboard kpis={kpis} watchCount={counts.watch} />
                )}
              </div>
            )}
          </div>
```

   La toolbar (recherche/tri/CSV/Ajouter) et les segments passent **dans la colonne liste** (au-dessus de la liste), la recherche en pleine largeur de colonne (`maxWidth` retiré).
7. **Mobile** — après le bloc principal :

```tsx
      {selected && !isDesktop && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: th.bg, overflowY: 'auto', padding: 16, animation: 'sp-sheet-in .25s ease' }}>
          <MemberCockpit
            member={selected} viewerUserId={viewer?.userId ?? null} canManageStaff={canManageStaff}
            onChanged={load} onSetRole={setRole} onToggleBlocked={toggleBlocked}
            onDelete={() => setConfirmRemove(selected)} onClose={() => select(null)}
          />
        </div>
      )}
```

8. **`SubscriberInsights` en contexte abonnés** : n'est plus rendu au-dessus de la liste — il vit dans le panneau droit quand rien n'est sélectionné (cf. layout ci-dessus). En mobile, le rendre au-dessus de la liste comme avant (`{!isDesktop && seg === 'subs' && <SubscriberInsights …/>}`).
9. Supprimer le fichier `frontend/components/admin/members/MemberPanel.tsx`.

- [ ] **Step 4 : Adapter les suites existantes**

- `AdminMembersFilters.test.tsx` / `AdminMembersStaff.test.tsx` : ajouter aux mocks `lib/api` : `adminGetMemberHistory` (résout le `HISTORY` minimal ci-dessus), `adminGetMemberNotes` (→ `[]`), `adminGetMemberLevel` (→ `null`), `adminGetSubscriptionPlans` (→ `[]`), et `assetUrl` si absent. Les assertions qui cliquaient « Rôle… »/« Bloquer »/« Supprimer le membre » dans le panneau passent par le menu **« ⋯ »** du cockpit : `fireEvent.click(screen.getByRole('button', { name: /Plus d'actions/ }))` puis cliquer l'item de menu. Les assertions sur les actions abonnés de la ligne (Renouveler/Changer/Résilier) déménagent : sélectionner le membre puis chercher ces boutons dans la carte Argent (mocker `member.subscription` dans la fixture).
- `MemberRow.test.tsx` : retirer les cas « nom = lien vers la fiche » et « boutons abonnés » ; garder/ajuster « clic ligne → onOpen », « pastille échéance en contexte abonnés ».

- [ ] **Step 5 : Vérifier les suites**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/AdminMembersNav.test.tsx __tests__/AdminMembersFilters.test.tsx __tests__/AdminMembersStaff.test.tsx __tests__/MemberRow.test.tsx __tests__/MemberCockpit.test.tsx __tests__/memberCockpit.test.ts`
Expected: PASS.

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur dans nos fichiers (une référence résiduelle à `MemberPanel`/`SubActionKind` = oubli à corriger).

- [ ] **Step 6 : Commit**

```bash
git status   # ne stager que nos fichiers
git add frontend/app/admin/members/page.tsx frontend/components/admin/members/MemberRow.tsx frontend/__tests__/AdminMembersNav.test.tsx frontend/__tests__/AdminMembersFilters.test.tsx frontend/__tests__/AdminMembersStaff.test.tsx frontend/__tests__/MemberRow.test.tsx
git rm frontend/components/admin/members/MemberPanel.tsx
git commit -m "feat(admin): page Membres en maitre-detail (liste + cockpit, ?m=, clavier, mobile)"
```

---

### Task 11 : Redirection `[userId]` + suppression des anciennes suites

**Files:**
- Modify: `frontend/app/admin/members/[userId]/page.tsx` (remplacé intégralement)
- Delete: `frontend/__tests__/MemberHistory.test.tsx`, `frontend/__tests__/AdminMemberLevel.test.tsx`

- [ ] **Step 1 : Remplacer la page par une redirection**

```tsx
'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

// La fiche membre vit désormais dans le maître-détail : /admin/members?m=<userId>.
// Cette route ne subsiste que pour les liens/bookmarks historiques.
export default function MemberRedirect() {
  const params = useParams();
  const router = useRouter();
  const userId = Array.isArray(params.userId) ? params.userId[0] : (params.userId as string);
  useEffect(() => { if (userId) router.replace(`/admin/members?m=${userId}`); }, [router, userId]);
  return null;
}
```

- [ ] **Step 2 : Supprimer les suites obsolètes**

`MemberHistory.test.tsx` (page à onglets) et `AdminMemberLevel.test.tsx` (correction de niveau dans la page) : comportements repris par `MemberCockpit.test.tsx` (la correction de niveau est rendue par `GameCard` via le `LevelOverrideForm` réutilisé — sa propre suite `LevelOverrideForm` existante, si présente, reste).

Avant suppression, vérifier qu'`AdminMemberLevel.test.tsx` ne teste QUE la page `[userId]` (import en tête) — si elle teste aussi `LevelOverrideForm` isolément, déplacer ces cas dans une suite `LevelOverrideForm.test.tsx` au lieu de les perdre.

- [ ] **Step 3 : Vérifier + commit**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/MemberCockpit.test.tsx __tests__/AdminMembersNav.test.tsx __tests__/AdminMembersFilters.test.tsx __tests__/AdminMembersStaff.test.tsx __tests__/MemberRow.test.tsx`
Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit`

```bash
git add "frontend/app/admin/members/[userId]/page.tsx"
git rm frontend/__tests__/MemberHistory.test.tsx frontend/__tests__/AdminMemberLevel.test.tsx
git commit -m "refactor(admin): /admin/members/[userId] devient une redirection vers ?m="
```

---

### Task 12 : Vérifications finales + CLAUDE.md

- [ ] **Step 1 : Suites scoped backend + frontend**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/memberStats.service.test.ts`
Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/memberCockpit.test.ts __tests__/MemberCockpit.test.tsx __tests__/AdminMembersNav.test.tsx __tests__/AdminMembersFilters.test.tsx __tests__/AdminMembersStaff.test.tsx __tests__/MemberRow.test.tsx __tests__/members.test.ts`
Expected: PASS partout.

- [ ] **Step 2 : Type-check global**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit` et `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur dans les fichiers touchés (grep scoped si du WIP parallèle pollue).

- [ ] **Step 3 : Vérification visuelle (skill `verify`)**

Lancer la skill `verify` : `/admin/members` connecté `test@palova.fr` (Gérant), thème clair + sombre, desktop 1280 + mobile 390. Vérifier : tableau de bord sans sélection, sélection → cockpit (4 cartes + KPI + heatmap), bouton « Encaisser » si dû (le seed abonnés `backend/scripts/seed-subscribers.ts` peut fournir des impayés), contexte Abonnés → `SubscriberInsights` dans le panneau, mobile plein écran avec retour, **scrollWidth ≤ viewport partout** (piège connu : émulation CDP `mobile:true` masque l'overflow réel → `mobile:false` + width 390).

- [ ] **Step 4 : CLAUDE.md**

Ajouter une entrée « Évolution (2026-07-14) — Membres en maître-détail + fiche cockpit » dans la section fusion Membres+Abonnés de `CLAUDE.md` : écran unique `?m=`, cockpit 4 cartes, `finance.unpaid[]` additif, MemberPanel + page onglets supprimés, redirection `[userId]`, encaissement inline = 4ᵉ porte du même registre.

- [ ] **Step 5 : Commit final**

```bash
git status
git add CLAUDE.md
git commit -m "docs: evolution Membres maitre-detail + fiche cockpit (CLAUDE.md)"
```
