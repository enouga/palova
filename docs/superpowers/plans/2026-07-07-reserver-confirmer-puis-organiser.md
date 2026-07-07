# Réserver « Confirmer d'abord, organiser ensuite » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réduire la modale de réservation à un écran de confirmation (paiement replié à défaut intelligent + interrupteur « Partie ouverte ») et transformer la feuille, après confirmation, en panneau d'organisation réutilisant `ReservationPlayersInline`/`OpenMatchToggle`.

**Architecture:** 100 % frontend, aucune route ni migration. `BookingModal.tsx` perd toute la section Joueurs (MatchTeams/AddPlayerSheet/PartnerSearch/drafts) au profit d'un switch unique ; le paiement existant est enveloppé dans un état replié/déplié ; une nouvelle phase `'confirmed'` rend le nouveau composant `components/booking/BookingSuccess.tsx` (fetch `getMyReservations` → `ReservationPlayersInline` tel quel). Spec : `docs/superpowers/specs/2026-07-07-reserver-confirmer-puis-organiser-design.md`.

**Tech Stack:** Next.js 16 / React 19, jest + React Testing Library (ts-jest, PAS de type-check → `tsc --noEmit` séparé).

**⚠️ Environnement (pièges connus du repo) :**
- Shims `node_modules/.bin` cassés : lancer `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc` (jamais `npx jest`/`npx tsc`). Toujours depuis `frontend/`.
- La suite complète `jest` a un flake BookingModal connu (isolation) : on valide par **suites scopées**.
- Ne jamais committer sans vérifier `git branch --show-current` == branche de travail (l'utilisateur change parfois de branche en parallèle).

---

## File structure

| Fichier | Rôle |
|---|---|
| Modify `frontend/lib/reservations.ts` | + helper pur `quotaBites(status, offPeak)` |
| Modify `frontend/components/reservations/OpenMatchToggle.tsx` | `publish` enregistre `saveLevelPref` |
| Create `frontend/components/booking/BookingSuccess.tsx` | Écran de succès : bandeau + récap + `ReservationPlayersInline` + Terminé |
| Modify `frontend/components/BookingModal.tsx` | Refonte (retrait Joueurs, switch, paiement replié, phase `confirmed`) |
| Modify `frontend/__tests__/reservations.test.ts` | + bloc quotaBites |
| Modify `frontend/__tests__/OpenMatchToggle.test.tsx` | + cas saveLevelPref |
| Modify `frontend/__tests__/BookingModal.test.tsx` | Cas partenaires → cas switch ; confirm → Terminé |
| Create `frontend/__tests__/BookingModal.paydefault.test.tsx` | Défauts de paiement + repli/dépli |
| Modify `frontend/__tests__/BookingModal.{payment,packages,subscription}.test.tsx` | Adaptations mécaniques (dépli avant clic avenue, Terminé après confirm, mock `getMyReservations`) |
| Create `frontend/__tests__/BookingSuccess.test.tsx` | Suite du nouveau composant |
| Modify `CLAUDE.md` | Note d'évolution |

---

### Task 1: Helper pur `quotaBites`

**Files:**
- Modify: `frontend/lib/reservations.ts`
- Test: `frontend/__tests__/reservations.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `frontend/__tests__/reservations.test.ts` (adapter l'import existant du fichier pour y ajouter `quotaBites`) :

```ts
import { quotaBites } from '../lib/reservations';

describe('quotaBites', () => {
  it('false sans statut ou sans compteur pour la classe du créneau', () => {
    expect(quotaBites(null, false)).toBe(false);
    expect(quotaBites(undefined, true)).toBe(false);
    expect(quotaBites({ model: 'WEEKLY', peak: { used: 4, limit: 5 }, offPeak: null }, true)).toBe(false);
  });

  it('true quand il reste ≤ 1 réservation possible pour la classe du créneau', () => {
    expect(quotaBites({ model: 'WEEKLY', peak: { used: 4, limit: 5 }, offPeak: null }, false)).toBe(true);   // reste 1
    expect(quotaBites({ model: 'UPCOMING', peak: { used: 5, limit: 5 }, offPeak: null }, false)).toBe(true); // plafond atteint
    expect(quotaBites({ model: 'WEEKLY', peak: null, offPeak: { used: 2, limit: 3 } }, true)).toBe(true);
  });

  it('false quand il reste ≥ 2 réservations', () => {
    expect(quotaBites({ model: 'WEEKLY', peak: { used: 1, limit: 5 }, offPeak: null }, false)).toBe(false);
    expect(quotaBites({ model: 'WEEKLY', peak: null, offPeak: { used: 0, limit: 2 } }, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run (depuis `frontend/`): `node node_modules/jest/bin/jest.js __tests__/reservations.test.ts`
Expected: FAIL — `quotaBites` n'est pas exporté.

- [ ] **Step 3: Implémenter**

Dans `frontend/lib/reservations.ts`, ajouter `MyQuotaStatus` à l'import de types existant depuis `@/lib/api` (ou `./api` selon le style du fichier), puis en fin de fichier :

```ts
/**
 * Le quota du joueur « mord »-il pour la classification du créneau (pleines/creuses) ?
 * true ssi le compteur concerné existe et qu'il reste ≤ 1 réservation possible —
 * c'est le seul cas où BookingModal affiche le compteur (sinon : bruit).
 */
export function quotaBites(status: MyQuotaStatus | null | undefined, offPeak: boolean): boolean {
  const count = offPeak ? status?.offPeak : status?.peak;
  return !!count && count.limit - count.used <= 1;
}
```

- [ ] **Step 4: Vérifier le PASS**

Run: `node node_modules/jest/bin/jest.js __tests__/reservations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/reservations.ts frontend/__tests__/reservations.test.ts
git commit -m "feat(reserve): helper quotaBites (quota affiche seulement s'il mord)"
```

---

### Task 2: `OpenMatchToggle.publish` mémorise la préférence de niveau

**Files:**
- Modify: `frontend/components/reservations/OpenMatchToggle.tsx`
- Test: `frontend/__tests__/OpenMatchToggle.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `frontend/__tests__/OpenMatchToggle.test.tsx` (le harnais `wrap`/`resa`/mocks existe déjà dans ce fichier) :

```ts
it('publish enregistre la préférence de niveau (localStorage palova:open-match-level)', async () => {
  localStorage.clear();
  wrap();
  fireEvent.click(screen.getByRole('button', { name: /Ouvrir aux joueurs du club/ }));
  fireEvent.click(screen.getByRole('switch', { name: /Limiter le niveau/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Publier$/ }));
  await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalled());
  expect(JSON.parse(localStorage.getItem('palova:open-match-level')!))
    .toEqual({ enabled: true, min: 3, max: 6 });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js __tests__/OpenMatchToggle.test.tsx`
Expected: FAIL — `localStorage.getItem(...)` est `null`.

- [ ] **Step 3: Implémenter**

Dans `frontend/components/reservations/OpenMatchToggle.tsx` :

Ajouter l'import :
```ts
import { saveLevelPref } from '@/lib/levelPrefs';
```

Remplacer la fonction `publish` :
```ts
const publish = () => run(() => {
  // C'est ici que la fourchette se choisit désormais → on mémorise le choix
  // (BookingModal ne fait que le relire pour son interrupteur « Partie ouverte »).
  saveLevelPref({ enabled: limit, min: lmin, max: lmax });
  return api.setReservationVisibility(
    reservation.id, 'PUBLIC', token,
    limit ? { targetLevelMin: lmin, targetLevelMax: lmax } : { targetLevelMin: null, targetLevelMax: null },
  );
});
```

- [ ] **Step 4: Vérifier le PASS (toute la suite)**

Run: `node node_modules/jest/bin/jest.js __tests__/OpenMatchToggle.test.tsx`
Expected: PASS (cas existants inclus).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/reservations/OpenMatchToggle.tsx frontend/__tests__/OpenMatchToggle.test.tsx
git commit -m "feat(reserve): OpenMatchToggle memorise la fourchette de niveau au publish"
```

---

### Task 3: BookingModal — retrait de la section Joueurs, interrupteur « Partie ouverte »

**Files:**
- Modify: `frontend/components/BookingModal.tsx`
- Test: `frontend/__tests__/BookingModal.test.tsx`

- [ ] **Step 1: Réécrire les tests concernés (ils échoueront)**

Dans `frontend/__tests__/BookingModal.test.tsx` :

**Supprimer** les cas : « partie ouverte : applyHoldSetup reçoit partnerUserIds + visibility », « padel : applyHoldSetup reçoit teams + slots… », « propose “Partie ouverte” sur un terrain padel multi-joueurs » (version bouton), « cache “Partie ouverte” sur un terrain non-padel » (version bouton), et tout autre cas qui interagit avec `PartnerSearch`/`MatchTeams`/`AddPlayerSheet`/« Alice Org » (recherche : `Alice Org`, `Ajouter un joueur à l'équipe`, `searchClubMembers`).

**Ajouter** :

```ts
it('padel multi-joueurs : interrupteur « Partie ouverte aux membres » présent, OFF par défaut', async () => {
  renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
  await screen.findByText(/Créneau bloqué/);
  const sw = screen.getByRole('switch', { name: /Partie ouverte aux membres/ });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByText(/partenaires s.ajoutent après la confirmation/i)).toBeInTheDocument();
});

it('non-padel : pas d interrupteur « Partie ouverte »', async () => {
  renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'tennis' });
  await screen.findByText(/Créneau bloqué/);
  expect(screen.queryByRole('switch', { name: /Partie ouverte/ })).not.toBeInTheDocument();
});

it('interrupteur OFF → confirmation sans applyHoldSetup', async () => {
  renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
  await screen.findByText(/Créneau bloqué/);
  fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
  await waitFor(() => expect(api.confirmReservation).toHaveBeenCalled());
  expect(api.applyHoldSetup).not.toHaveBeenCalled();
});

it('interrupteur ON → applyHoldSetup PUBLIC, partnerUserIds vide, niveaux de la préférence', async () => {
  localStorage.setItem('palova:open-match-level', JSON.stringify({ enabled: true, min: 4, max: 6 }));
  renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
  await screen.findByText(/Créneau bloqué/);
  fireEvent.click(screen.getByRole('switch', { name: /Partie ouverte aux membres/ }));
  expect(screen.getByText(/Niveau 4–6 · réglable après confirmation/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
  await waitFor(() => expect(api.applyHoldSetup).toHaveBeenCalledWith(
    'res-1', 'jwt-token',
    { partnerUserIds: [], visibility: 'PUBLIC', targetLevelMin: 4, targetLevelMax: 6 },
  ));
});

it('interrupteur ON, préférence « ouverte à tous » → targetLevel null', async () => {
  localStorage.setItem('palova:open-match-level', JSON.stringify({ enabled: false, min: 3, max: 5 }));
  renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
  await screen.findByText(/Créneau bloqué/);
  fireEvent.click(screen.getByRole('switch', { name: /Partie ouverte aux membres/ }));
  fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
  await waitFor(() => expect(api.applyHoldSetup).toHaveBeenCalledWith(
    'res-1', 'jwt-token',
    { partnerUserIds: [], visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null },
  ));
});
```

Note : `mockClub` reste `null` dans ces cas → `useLevelSystemEnabled()` vaut true par défaut (comportement existant de la suite).

- [ ] **Step 2: Vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingModal.test.tsx`
Expected: FAIL — pas de `role="switch"` « Partie ouverte aux membres ».

- [ ] **Step 3: Implémenter dans `BookingModal.tsx`**

**3a — Imports.** Supprimer les imports devenus inutiles : `ClubMemberSearchResult` (type), `PartnerSearch`, `MatchTeams`/`MatchPlayerData`, `AddPlayerSheet`/`PickedMember`, `Avatar`, `colorForSeed`, `LevelChip`, `LevelRangeSlider`, `Segmented` (garder `Btn`), `saveLevelPref` (garder `loadLevelPref`).

**3b — États et helpers supprimés** : `partners`, `visibility`, `me`, `teamsDraft`, `slotsDraft`, `addTarget`, `nextSide`, `addPartner`, `addPartnerTo`, `removePartner`, `buildPlayers`, `nbPlayers`, `atCap`, `spotsLeft`, `perPlayer`, l'effet `getMyProfile` (« Identité de l'organisateur ») et l'effet « L'organisateur occupe l'Équipe 1 ». Garder `cap`, `showPartners`, `isPadel`, `levelLimited`/`levelMin`/`levelMax` et l'effet de pré-remplissage de la fourchette (inchangé, y compris son gating `if (!showPartners || !levelForSport) return;`).

**3c — Nouvel état** :
```ts
// Interrupteur « Partie ouverte » : seule décision d'organisation restée dans la modale.
const [openMatch, setOpenMatch] = useState(false);
```

**3d — `persistHoldSetup` remplacé intégralement** :
```ts
// Publie la visibilité « partie ouverte » sur la résa PENDING avant confirmation (directe
// OU Stripe via beforeSubmit) — les joueurs, eux, s'ajoutent après coup (écran de succès).
// Interrupteur OFF → aucun appel : une réservation naît PRIVATE.
const persistHoldSetup = async () => {
  if (!showPartners || !isPadel || !openMatch || !reservation) return;
  const limiting = levelForSport && levelLimited;
  await api.applyHoldSetup(reservation.id, token, {
    partnerUserIds: [],
    visibility: 'PUBLIC',
    targetLevelMin: limiting ? levelMin : null,
    targetLevelMax: limiting ? levelMax : null,
  });
};
```

**3e — JSX.** Remplacer TOUT le bloc `{showPartners && ( <div style={{ marginTop: 20 }}> … </div> )}` (section Joueurs : sectionLabel users, MatchTeams, AddPlayerSheet, pastilles partenaires, PartnerSearch, Segmented visibilité, switch+slider niveau, chip « ≈ X € par joueur ») par :

```tsx
{/* Partie ouverte — seule décision d'organisation dans la modale (padel multi-joueurs).
    Partenaires/équipes/niveau s'organisent sur l'écran de succès, sans timer. */}
{showPartners && isPadel && (
  <div style={{ marginTop: 20 }}>
    {sectionLabel('users', 'Votre partie')}
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>Partie ouverte aux membres</span>
      <button type="button" role="switch" aria-checked={openMatch} aria-label="Partie ouverte aux membres"
        onClick={() => setOpenMatch((v) => !v)}
        style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 0, position: 'relative', background: openMatch ? th.accent : th.lineStrong, transition: 'background .15s', flex: '0 0 auto' }}>
        <span style={{ position: 'absolute', top: 3, left: openMatch ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
      </button>
    </div>
    <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 6, lineHeight: 1.4 }}>
      {openMatch
        ? (levelForSport
            ? (levelLimited
                ? `Niveau ${levelMin}–${levelMax} · réglable après confirmation.`
                : 'Ouverte à tous les niveaux · réglable après confirmation.')
            : 'Visible et rejoignable par les membres du club.')
        : 'Vos partenaires s’ajoutent après la confirmation.'}
    </div>
  </div>
)}
```

- [ ] **Step 4: Vérifier le PASS**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur dans `components/BookingModal.tsx` ni `__tests__/BookingModal.test.tsx` (ignorer les erreurs pré-existantes d'autres fichiers en cours de travaux parallèles, en vérifiant par grep sur les chemins touchés).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/BookingModal.tsx frontend/__tests__/BookingModal.test.tsx
git commit -m "feat(reserve): modale reduite - interrupteur partie ouverte remplace la section joueurs"
```

---

### Task 4: BookingModal — ligne de paiement repliée + défauts intelligents

**Files:**
- Modify: `frontend/components/BookingModal.tsx`
- Create: `frontend/__tests__/BookingModal.paydefault.test.tsx`
- Modify: `frontend/__tests__/BookingModal.payment.test.tsx`, `frontend/__tests__/BookingModal.packages.test.tsx`, `frontend/__tests__/BookingModal.subscription.test.tsx`

- [ ] **Step 1: Écrire la nouvelle suite (échouera)**

Créer `frontend/__tests__/BookingModal.paydefault.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingModal from '../components/BookingModal';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot, MemberPackage, Subscription } from '../lib/api';

jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'club-demo', club: null, loading: false }),
}));
jest.mock('../lib/api', () => ({
  api: {
    holdSlot:           jest.fn(),
    confirmReservation: jest.fn(),
    cancelReservation:  jest.fn(),
    applyHoldSetup:     jest.fn().mockResolvedValue({}),
    listClubFriends:    jest.fn().mockResolvedValue([]),
    getMyRating:        jest.fn().mockResolvedValue(null),
    getMyReservations:  jest.fn().mockResolvedValue([]),
    getClubPage:        jest.fn().mockResolvedValue({}),
  },
  assetUrl: (u: string | null) => u,
}));

const mockSlot: TimeSlot = {
  startTime: '2025-06-15T06:00:00.000Z', endTime: '2025-06-15T07:00:00.000Z',
  available: true, price: '25', offPeak: false,
};
const carnet: MemberPackage = {
  id: 'pkg-1', kind: 'ENTRIES', creditsRemaining: 7, amountRemaining: null, expiresAt: null,
} as unknown as MemberPackage;
const wallet2: MemberPackage = {
  id: 'pkg-2', kind: 'WALLET', creditsRemaining: null, amountRemaining: '10.00', expiresAt: null,
} as unknown as MemberPackage;
const sub: Subscription = {
  id: 'sub-1', benefit: 'INCLUDED', discountPercent: null, sports: null, offPeakOnly: false,
} as unknown as Subscription;

function renderModal(overrides: Partial<React.ComponentProps<typeof BookingModal>> = {}) {
  return render(
    <ThemeProvider>
      <BookingModal slot={mockSlot} resourceId="court-1" price="25" duration={60}
        token="jwt" onClose={jest.fn()} onConfirmed={jest.fn()} {...overrides} />
    </ThemeProvider>
  );
}

describe('BookingModal — paiement replié (défaut intelligent)', () => {
  beforeEach(() => {
    jest.clearAllMocks(); localStorage.clear();
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
  });

  it('sans abo ni carnet : « Régler au club » replié, CTA « Confirmer la réservation »', async () => {
    renderModal();
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText('Régler au club')).toBeInTheDocument();
    // Replié : l'avenue « Payer en ligne » n'est pas rendue.
    expect(screen.queryByText('Payer en ligne')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmer la réservation/ })).toBeInTheDocument();
  });

  it('abonnement couvrant : pré-choisi replié, CTA abonnement', async () => {
    renderModal({ sportKey: 'padel', subscriptions: [sub], packages: [carnet] });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText('Couvert par votre abonnement')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmer avec mon abonnement/ })).toBeInTheDocument();
  });

  it('sans abo, carnet couvrant : pré-choisi replié, CTA solde', async () => {
    renderModal({ packages: [carnet] });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText(/Carnet — 7 entrées/)).toBeInTheDocument();
    expect(screen.getByText(/il restera 6 entrées/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmer avec mon solde/ })).toBeInTheDocument();
  });

  it('porte-monnaie insuffisant (10 € < 25 €) : jamais pré-choisi → « Régler au club »', async () => {
    renderModal({ packages: [wallet2] });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText('Régler au club')).toBeInTheDocument();
  });

  it('« changer » déplie les avenues existantes (gating inchangé)', async () => {
    renderModal({ packages: [carnet], stripeActive: true });
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('button', { name: /changer/ }));
    expect(screen.getByText('Régler au club')).toBeInTheDocument();
    expect(screen.getByText('Payer en ligne')).toBeInTheDocument();
    expect(screen.getByText(/Carnet — 7 entrées/)).toBeInTheDocument();
    // Pas d'avenue abonnement sans abonnement couvrant.
    expect(screen.queryByText('Couvert par votre abonnement')).not.toBeInTheDocument();
  });

  it('sans alternative (ni abo, ni carnet, ni Stripe) : pas de bouton « changer »', async () => {
    renderModal();
    await screen.findByText(/Créneau bloqué/);
    expect(screen.queryByRole('button', { name: /changer/ })).not.toBeInTheDocument();
  });

  it('paiement en ligne imposé : « Payer en ligne » replié + part du joueur', async () => {
    renderModal({ requireOnlinePayment: true, stripeActive: true, sportKey: 'padel', format: 'double', maxPlayers: 4, slug: 'club-demo' });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText('Payer en ligne')).toBeInTheDocument();
    expect(screen.getByText(/Votre part : 6,25\s*€/)).toBeInTheDocument();
  });

  it('INSUFFICIENT_BALANCE à la confirmation : déplie et désélectionne le carnet', async () => {
    (api.confirmReservation as jest.Mock).mockRejectedValue(new Error('INSUFFICIENT_BALANCE'));
    renderModal({ packages: [carnet] });
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('button', { name: /Confirmer avec mon solde/ }));
    expect(await screen.findByText(/Solde insuffisant/)).toBeInTheDocument();
    // Déplié : l'avenue « Régler au club » est visible et le CTA redevient générique.
    expect(screen.getByText('Régler au club')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmer la réservation/ })).toBeInTheDocument();
  });
});
```

⚠️ Adapter les objets `carnet`/`wallet2`/`sub` aux types réels de `lib/api.ts` (`MemberPackage`, `Subscription`) : reprendre les champs utilisés par `packageLabel`/`isUsable`/`canCover`/`coveringSubscription` (voir `lib/packages.ts` / `lib/subscriptions.ts`) — le cast `as unknown as` couvre les champs non pertinents.

- [ ] **Step 2: Vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingModal.paydefault.test.tsx`
Expected: FAIL (« Payer en ligne » visible d'office → l'assertion « repliée » casse ; pas de bouton « changer »).

- [ ] **Step 3: Implémenter dans `BookingModal.tsx`**

**3a — Import** : ajouter `pickPackageFor` à l'import de `@/lib/packages`.

**3b — Défauts.** Remplacer la déclaration `const [paySource, setPaySource] = useState<string | null>(null);` par :

```ts
// Défaut intelligent : abonnement couvrant (via l'effet useSub) > premier solde prépayé
// capable de couvrir > régler au club. Jamais de carnet pré-choisi si le club impose
// le paiement en ligne (l'avenue carnet reste disponible derrière « changer »).
const [paySource, setPaySource] = useState<string | null>(() => {
  if (requireOnlinePayment) return null;
  if (coveringSubscription(subscriptions, { sportKey: sportKey ?? '', isOffPeak: slot.offPeak ?? false })) return null;
  return pickPackageFor(packages, Math.round(Number(slot.price ?? price) * 100))?.id ?? null;
});
```

**3c — État de repli** (à côté des autres useState) :
```ts
const [payExpanded, setPayExpanded] = useState(false); // false = ligne repliée « … · changer »
```

**3d — Alternatives.** Après le calcul de `onlineAvailable`/`onlineRequiredButUnavailable`, ajouter :
```ts
// Y a-t-il autre chose à choisir que le défaut ? (sinon, pas de bouton « changer »)
const avenueCount = (cover ? 1 : 0) + packages.length + (onlineAvailable ? 1 : 0) + (requireOnlinePayment ? 0 : 1);
const hasAlternatives = avenueCount > 1;
```

**3e — JSX.** Dans la section « Choix du mode de paiement », envelopper la pile d'avenues existante : remplacer

```tsx
<div style={{ marginTop: 20 }}>
  {sectionLabel('card', 'Mode de paiement')}
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
```

par

```tsx
<div style={{ marginTop: 20 }}>
  {sectionLabel('card', 'Mode de paiement')}
  {!payExpanded ? (() => {
    // Ligne repliée : le moyen pré-choisi + sa conséquence, bouton « changer » si alternatives.
    const selPkg = paySource ? packages.find((p) => p.id === paySource) ?? null : null;
    const online = !useSub && !selPkg && payMode === 'online' && onlineAvailable;
    const icon: IconName = useSub ? 'bolt' : selPkg ? (selPkg.kind === 'ENTRIES' ? 'ticket' : 'wallet') : online ? 'card' : 'home';
    const title = useSub ? 'Couvert par votre abonnement' : selPkg ? packageLabel(selPkg) : online ? 'Payer en ligne' : 'Régler au club';
    const sub = useSub && cover ? coverageLabel(cover)
      : selPkg ? `Après paiement : ${remainingAfterLabel(selPkg, totalEuros)}`
      : online ? (onlineShare ? `Votre part : ${perPerson}€ · ${totalPrice}€ ÷ ${capacity} joueurs` : `Montant : ${totalPrice}€`)
      : requireCardFingerprint ? 'Empreinte de carte (protection no-show) · règlement sur place'
      : 'Aucune carte enregistrée · vous réglez sur place';
    return (
      <div style={{ ...payCard(true), display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px' }}>
        <span style={payTile(true)}><Icon name={icon} size={18} color={th.onAccent} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.text }}>{title}</span>
          <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 2 }}>{sub}</span>
        </span>
        {hasAlternatives && (
          <button type="button" onClick={() => setPayExpanded(true)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent, padding: 0, flex: '0 0 auto' }}>
            changer
          </button>
        )}
      </div>
    );
  })() : (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
```

et fermer : la `</div>` qui clôt la pile d'avenues devient `</div>) }` — c'est-à-dire remplacer

```tsx
                </div>
              </div>

              {/* Conditions d'annulation — toujours affiché */}
```

par

```tsx
                </div>) }
              </div>

              {/* Conditions d'annulation — toujours affiché */}
```

Les quatre avenues à l'intérieur (abo / club / en ligne / carnets) restent **strictement inchangées**.

**3f — Dépli sur erreur de solde.** Dans `handleConfirm`, remplacer la ligne

```ts
if (msg === 'INSUFFICIENT_BALANCE') { setPaySource(null); setErrorMsg('Solde insuffisant — réglez au club.'); return; }
```

par

```ts
if (msg === 'INSUFFICIENT_BALANCE') { setPaySource(null); setPayExpanded(true); setErrorMsg('Solde insuffisant — réglez au club.'); return; }
```

**3g — Quota conditionnel.** Ajouter `quotaBites` à l'import de `@/lib/reservations` et remplacer

```tsx
{quotaStatus && (
  <div style={{ marginTop: 16 }}>
    <QuotaStatus status={quotaStatus} compact />
  </div>
)}
```

par

```tsx
{/* Quota : affiché seulement s'il mord (≤ 1 résa possible pour la classe du créneau). */}
{quotaStatus && quotaBites(quotaStatus, isOffPeak) && (
  <div style={{ marginTop: 16 }}>
    <QuotaStatus status={quotaStatus} compact />
  </div>
)}
```

- [ ] **Step 4: Vérifier le PASS de la nouvelle suite**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingModal.paydefault.test.tsx`
Expected: PASS.

- [ ] **Step 5: Adapter les 3 suites paiement existantes**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingModal.payment.test.tsx __tests__/BookingModal.packages.test.tsx __tests__/BookingModal.subscription.test.tsx`

Règles d'adaptation mécaniques (appliquer aux cas qui échouent, sans changer ce qu'ils vérifient) :
- Un cas qui clique une avenue précise (« Payer en ligne », « Régler au club », pill carnet) doit d'abord `fireEvent.click(screen.getByRole('button', { name: /changer/ }))` — sauf si le moyen visé est déjà le défaut replié.
- Un cas qui rendait des `packages` et s'attendait à AUCUNE sélection automatique reflète désormais le défaut : si le carnet couvre, le CTA est « Confirmer avec mon solde » sans clic préalable.
- Un cas qui vérifiait la présence simultanée de plusieurs avenues au premier rendu doit déplier d'abord.
- Un cas qui vérifiait un quota visible avec de la marge (`limit - used ≥ 2`) passe sur des compteurs qui mordent (ex. `{ used: 4, limit: 5 }`) ou vérifie l'absence.

Expected après adaptation: PASS sur les 3 suites.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/BookingModal.tsx frontend/__tests__/BookingModal.paydefault.test.tsx frontend/__tests__/BookingModal.payment.test.tsx frontend/__tests__/BookingModal.packages.test.tsx frontend/__tests__/BookingModal.subscription.test.tsx
git commit -m "feat(reserve): paiement replie a defaut intelligent (abo > carnet > club) + quota seulement s'il mord"
```

---

### Task 5: `BookingSuccess` + phase `confirmed`

**Files:**
- Create: `frontend/components/booking/BookingSuccess.tsx`
- Modify: `frontend/components/BookingModal.tsx`
- Create: `frontend/__tests__/BookingSuccess.test.tsx`
- Modify: `frontend/__tests__/BookingModal.test.tsx`

- [ ] **Step 1: Écrire la suite BookingSuccess (échouera : composant absent)**

Créer `frontend/__tests__/BookingSuccess.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BookingSuccess } from '../components/booking/BookingSuccess';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    getMyReservations:        jest.fn().mockResolvedValue([]),
    setReservationVisibility: jest.fn(),
    setReservationTeams:      jest.fn(),
    addReservationPlayer:     jest.fn(),
    removeReservationPlayer:  jest.fn(),
    searchClubMembers:        jest.fn().mockResolvedValue([]),
    listClubFriends:          jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));

const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const slot: TimeSlot = { startTime: future, endTime: future, available: true, price: '25', offPeak: false };

const myResa = {
  id: 'res-1', startTime: future, endTime: future, status: 'CONFIRMED', totalPrice: '25',
  resource: { id: 'court-1', name: 'Court 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Club', slug: 'club-demo', timezone: 'Europe/Paris' } },
  capacity: 4, visibility: 'PRIVATE',
  participants: [{ id: 'p1', userId: 'u1', isOrganizer: true, firstName: 'Alice', lastName: 'Org', avatarUrl: null }],
};

function renderSuccess(overrides: Partial<React.ComponentProps<typeof BookingSuccess>> = {}) {
  return render(
    <ThemeProvider>
      <BookingSuccess reservationId="res-1" token="jwt" summary="À régler au club"
        slot={slot} timezone="Europe/Paris" resourceName="Court 1" duration={60}
        showPartners onDone={jest.fn()} {...overrides} />
    </ThemeProvider>
  );
}

describe('BookingSuccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.getMyReservations as jest.Mock).mockResolvedValue([myResa]);
  });

  it('affiche la confirmation, le récap paiement et « Terminé » (onDone)', async () => {
    const onDone = jest.fn();
    renderSuccess({ onDone });
    expect(screen.getByText(/Réservation confirmée/)).toBeInTheDocument();
    expect(screen.getByText(/À régler au club/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Terminé/ }));
    expect(onDone).toHaveBeenCalled();
  });

  it('showPartners → charge la résa et rend le bloc d organisation (équipes + ouvrir la partie)', async () => {
    renderSuccess();
    expect(await screen.findByText(/Organisez votre partie/i)).toBeInTheDocument();
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();                      // MatchTeams
    expect(screen.getByRole('button', { name: /Ouvrir aux joueurs du club/ })).toBeInTheDocument(); // OpenMatchToggle
    expect(api.getMyReservations).toHaveBeenCalledWith('jwt');
  });

  it('showPartners=false → pas de fetch ni de bloc d organisation', async () => {
    renderSuccess({ showPartners: false });
    expect(screen.getByText(/Réservation confirmée/)).toBeInTheDocument();
    expect(api.getMyReservations).not.toHaveBeenCalled();
    expect(screen.queryByText(/Organisez votre partie/i)).not.toBeInTheDocument();
  });

  it('échec du fetch → lien « Gérer ma réservation » (jamais d écran d erreur)', async () => {
    (api.getMyReservations as jest.Mock).mockRejectedValue(new Error('NETWORK'));
    renderSuccess();
    expect(await screen.findByRole('link', { name: /Gérer ma réservation/ })).toHaveAttribute('href', '/me/reservations');
    expect(screen.getByText(/Réservation confirmée/)).toBeInTheDocument();
  });

  it('résa introuvable dans la liste → même repli lien', async () => {
    (api.getMyReservations as jest.Mock).mockResolvedValue([]);
    renderSuccess();
    expect(await screen.findByRole('link', { name: /Gérer ma réservation/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingSuccess.test.tsx`
Expected: FAIL — module `components/booking/BookingSuccess` introuvable.

- [ ] **Step 3: Créer `frontend/components/booking/BookingSuccess.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { api, MyReservation, TimeSlot } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { durationLabel } from '@/lib/duration';
import { Btn } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { ReservationPlayersInline } from '@/components/reservations/ReservationPlayersInline';

/**
 * Écran de succès de la modale de réservation : la confirmation devient le moment
 * d'organisation de la partie — joueurs/équipes/partie ouverte via les briques
 * post-confirmation existantes (ReservationPlayersInline + OpenMatchToggle), sans timer.
 */
export function BookingSuccess({ reservationId, token, summary, slot, timezone, resourceName, duration, showPartners, onDone }: {
  reservationId: string;
  token: string;
  /** Résumé du paiement (« Payé avec votre carnet · … », « À régler au club »…). */
  summary: string;
  slot: TimeSlot;
  timezone?: string;
  resourceName?: string;
  duration: number;
  /** Terrain multi-joueurs sur un hôte club → bloc d'organisation. */
  showPartners: boolean;
  onDone: () => void;
}) {
  const { th } = useTheme();
  // Horloge posée au montage : l'écran n'existe que côté client, après confirmation.
  const [now] = useState(() => Date.now());
  const [resa, setResa] = useState<MyReservation | null>(null);
  const [failed, setFailed] = useState(false);

  // ReservationPlayersInline consomme un MyReservation complet : on le prend dans
  // « Mes réservations » (même source que le calendrier). Échec → lien de repli,
  // jamais d'écran d'erreur après une confirmation réussie.
  const reload = () => {
    api.getMyReservations(token)
      .then((rows) => {
        const r = rows.find((x) => x.id === reservationId) ?? null;
        if (r) { setResa(r); setFailed(false); } else setFailed(true);
      })
      .catch(() => setFailed(true));
  };
  useEffect(() => { if (showPartners) reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hour = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
    .format(new Date(iso)).replace(':', 'h');
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone })
    .format(new Date(slot.startTime));

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(34,197,94,0.13)', color: '#15803d', borderRadius: 14, padding: '12px 14px' }}>
        <span style={{ width: 26, height: 26, flex: '0 0 auto', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={15} color="#fff" stroke={2.6} />
        </span>
        <span style={{ fontFamily: th.fontUI, fontSize: 15.5, fontWeight: 700 }}>Réservation confirmée !</span>
      </div>

      <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 10, lineHeight: 1.5 }}>
        <span style={{ textTransform: 'capitalize' }}>{dateLabel}</span> · {hour(slot.startTime)} → {hour(slot.endTime)} · {durationLabel(duration)}
        {resourceName ? <> · {resourceName}</> : null}
        <span style={{ display: 'block', marginTop: 2, fontWeight: 600, color: th.text }}>{summary}</span>
      </div>

      {showPartners && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <Icon name="users" size={13} color={th.textMute} />
            <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>Organisez votre partie</span>
          </div>
          {failed ? (
            <a href="/me/reservations" style={{ fontFamily: th.fontUI, fontSize: 13, color: th.accent, fontWeight: 600 }}>Gérer ma réservation →</a>
          ) : resa ? (
            <ReservationPlayersInline reservation={resa} token={token} now={now} onChanged={reload} />
          ) : (
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>Chargement…</div>
          )}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <Btn full onClick={onDone}>Terminé</Btn>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Vérifier le PASS**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingSuccess.test.tsx`
Expected: PASS.

- [ ] **Step 5: Brancher la phase `confirmed` dans `BookingModal.tsx`**

**5a — Import** :
```ts
import { BookingSuccess } from '@/components/booking/BookingSuccess';
```

**5b — Phase et état.** Remplacer

```ts
const [phase, setPhase] = useState<'holding' | 'held' | 'error'>('holding');
```

par

```ts
const [phase, setPhase] = useState<'holding' | 'held' | 'error' | 'confirmed'>('holding');
// Résa confirmée + résumé du paiement (affichage succès) + note pour onConfirmed.
const [confirmedInfo, setConfirmedInfo] = useState<{ reservation: Reservation; summary: string; paid?: { label: string } } | null>(null);
```

**5c — `handleConfirm`.** Remplacer les deux lignes

```ts
settled.current = true; // réservation confirmée → le cleanup ne doit pas l'annuler
onConfirmed(confirmed, usedPkg ? { label: paidWithLabel(usedPkg, totalEuros) } : undefined);
```

par

```ts
settled.current = true; // réservation confirmée → le cleanup ne doit pas l'annuler
setConfirmedInfo({
  reservation: confirmed,
  summary: useSub && cover ? 'Couverte par votre abonnement'
    : usedPkg ? paidWithLabel(usedPkg, totalEuros)
    : 'À régler au club',
  paid: usedPkg ? { label: paidWithLabel(usedPkg, totalEuros) } : undefined,
});
setPhase('confirmed');
```

**5d — `handleDone`.** Ajouter après `handleClose` :

```ts
// Fermeture de l'écran de succès (« Terminé » ou backdrop) : c'est ICI que la page
// est prévenue — même contrat onConfirmed qu'avant, décalé à la fin de l'organisation.
const handleDone = () => {
  if (!confirmedInfo) return;
  onConfirmed(confirmedInfo.reservation, confirmedInfo.paid);
};
```

**5e — Stripe `onSuccess`.** Remplacer

```tsx
onSuccess={() => { settled.current = true; onConfirmed(reservation); }}
```

par

```tsx
onSuccess={() => {
  settled.current = true;
  setConfirmedInfo({
    reservation,
    summary: (payMode === 'online' && onlineAvailable) ? `Payée en ligne · ${onlineAmountLabel}` : 'À régler au club',
  });
  setPhase('confirmed');
}}
```

**5f — Backdrop et barre de timer.** Remplacer

```tsx
<div onClick={handleClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
```

par

```tsx
<div onClick={phase === 'confirmed' ? handleDone : handleClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
```

et `{phase !== 'error' && (` (barre de timer) par `{phase !== 'error' && phase !== 'confirmed' && (`.

**5g — Rendu.** Transformer le ternaire racine `phase === 'error' ? (…) : (…)` en :

```tsx
{phase === 'error' ? (
  … bloc erreur inchangé …
) : phase === 'confirmed' && confirmedInfo ? (
  <BookingSuccess
    reservationId={confirmedInfo.reservation.id}
    token={token} summary={confirmedInfo.summary}
    slot={slot} timezone={timezone} resourceName={resourceName} duration={duration}
    showPartners={showPartners}
    onDone={handleDone}
  />
) : (
  … bloc held/holding inchangé (en-tête pill/chip, hero, contenu gaté phase held) …
)}
```

- [ ] **Step 6: Adapter `__tests__/BookingModal.test.tsx`**

**6a —** Ajouter au mock module `../lib/api` : `getMyReservations: jest.fn().mockResolvedValue([]),`.

**6b —** Le cas « confirme (régler au club) → confirmReservation + onConfirmed » devient :

```ts
it('confirme (régler au club) → succès dans la feuille, puis « Terminé » → onConfirmed', async () => {
  const onConfirmed = jest.fn();
  renderModal({ onConfirmed });
  fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));
  await waitFor(() => expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', undefined));
  // La feuille ne se ferme pas : elle bascule en écran de succès.
  expect(await screen.findByText(/Réservation confirmée/)).toBeInTheDocument();
  expect(onConfirmed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Terminé/ }));
  expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ id: 'res-1' }), undefined);
  expect(api.cancelReservation).not.toHaveBeenCalled();
});
```

**6c —** Ajouter :

```ts
it('après confirmation, le backdrop vaut « Terminé » (aucune annulation)', async () => {
  const onConfirmed = jest.fn(); const onClose = jest.fn();
  renderModal({ onConfirmed, onClose });
  fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));
  await screen.findByText(/Réservation confirmée/);
  const backdrop = document.querySelector('[style*="backdrop-filter"], [style*="backdropFilter"]') as HTMLElement;
  fireEvent.click(backdrop);
  expect(onConfirmed).toHaveBeenCalled();
  expect(api.cancelReservation).not.toHaveBeenCalled();
});
```

(si le sélecteur du backdrop est fragile, cibler `container.firstChild!.firstChild` du render — le premier enfant absolu de l'enveloppe.)

**6d —** Les autres cas de la suite qui confirmaient puis attendaient `onConfirmed` directement suivent la même transformation (confirmer → `findByText(/Réservation confirmée/)` → cliquer Terminé). Idem, mécaniquement, pour tout cas des suites `BookingModal.{payment,packages,subscription}.test.tsx` qui échouerait pour cette raison (ajouter `getMyReservations` à leur mock module si `slug`/`maxPlayers` sont passés).

- [ ] **Step 7: Vérifier le PASS des 5 suites BookingModal + BookingSuccess**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingModal.test.tsx __tests__/BookingModal.paydefault.test.tsx __tests__/BookingModal.payment.test.tsx __tests__/BookingModal.packages.test.tsx __tests__/BookingModal.subscription.test.tsx __tests__/BookingSuccess.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/booking/BookingSuccess.tsx frontend/components/BookingModal.tsx frontend/__tests__/BookingSuccess.test.tsx frontend/__tests__/BookingModal.test.tsx frontend/__tests__/BookingModal.payment.test.tsx frontend/__tests__/BookingModal.packages.test.tsx frontend/__tests__/BookingModal.subscription.test.tsx
git commit -m "feat(reserve): la confirmation devient l'ecran d'organisation (BookingSuccess + phase confirmed)"
```

---

### Task 6: Vérification transverse

**Files:** aucun nouveau — validation.

- [ ] **Step 1: Type-check**

Run (depuis `frontend/`): `node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur sur `components/BookingModal.tsx`, `components/booking/BookingSuccess.tsx`, `components/reservations/OpenMatchToggle.tsx`, `lib/reservations.ts` et les tests touchés (filtrer la sortie par ces chemins — des erreurs pré-existantes d'autres chantiers peuvent exister).

- [ ] **Step 2: Suites Réserver (non modifiées — ne doivent PAS casser)**

Run: `node node_modules/jest/bin/jest.js __tests__/ClubReserve.view.test.tsx __tests__/ClubReserve.deeplink.test.tsx __tests__/ClubReserve.persport.test.tsx __tests__/ClubReserve.pastslots.test.tsx __tests__/ReservationPlayersInline.test.tsx __tests__/reservations.test.ts __tests__/OpenMatchToggle.test.tsx`
Expected: PASS. Si une suite ClubReserve échoue parce qu'elle traverse la confirmation de bout en bout, appliquer la transformation « confirmer → Réservation confirmée → Terminé » + mock `getMyReservations`, rien d'autre.

- [ ] **Step 3: Vérification visuelle (optionnelle mais recommandée)**

Utiliser la skill `verify` du repo (screenshots Chrome headless authentifiés) sur `/reserver` : ouvrir un créneau padel → modale réduite (ligne paiement repliée + interrupteur) → confirmer → écran de succès (équipes + « Ouvrir aux joueurs du club » + Terminé). Thèmes clair + sombre, mobile + desktop.

- [ ] **Step 4: Commit éventuel des ajustements**

```bash
git add -A frontend/__tests__
git commit -m "test(reserve): ajustements suites apres refonte modale"
```

(sauter ce commit si aucun fichier n'a bougé à l'étape 2)

---

### Task 7: Documentation CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Ajouter la note d'évolution**

Dans la section « Réserver — sélecteur de sport multi-sports », après la note du 2026-07-07 « vue cartes restylée », ajouter :

```markdown
> **Évolution (2026-07-07) — « Confirmer d'abord, organiser ensuite » :** la modale (`BookingModal.tsx`) est réduite à la confirmation : **paiement replié** en une ligne à défaut intelligent (abonnement couvrant > premier solde `pickPackageFor` > régler au club ; jamais de carnet pré-choisi si paiement en ligne imposé ; « changer » déplie les avenues existantes, gating inchangé ; `INSUFFICIENT_BALANCE` déplie), **quota affiché seulement s'il mord** (`quotaBites` dans `lib/reservations.ts`, reste ≤ 1 pour la classe du créneau), et **toute la section Joueurs est supprimée** (MatchTeams/AddPlayerSheet/PartnerSearch/drafts teams-slots) au profit d'un **interrupteur « Partie ouverte aux membres »** (padel multi-joueurs, OFF par défaut, fourchette reprise de `loadLevelPref` sans slider ; ON → `applyHoldSetup` `{ partnerUserIds: [], visibility: 'PUBLIC', targetLevel* }`, OFF → aucun appel). Après confirmation (directe OU Stripe payment/setup), la feuille **se transforme** en écran de succès **`components/booking/BookingSuccess.tsx`** : bandeau vert + récap paiement + bloc « Organisez votre partie » = **`ReservationPlayersInline` réutilisé tel quel** (équipes, ajout/retrait, `OpenMatchToggle` — qui **mémorise désormais `saveLevelPref` au publish**) alimenté par `getMyReservations` (échec → lien « Gérer ma réservation », jamais d'écran d'erreur après paiement) ; « Terminé »/backdrop → `onConfirmed` (contrat conservé, émission décalée à la fermeture). Limitation assumée : résa prise dans la fenêtre `playerChangeCutoffHours` → ajout de joueurs refusé post-confirmation (garde backend existante). Aucun changement backend. Tests : `BookingModal.paydefault`/`BookingSuccess` (nouvelles), suites BookingModal adaptées (confirmer → Terminé), `reservations` (quotaBites), `OpenMatchToggle` (pref). Spec & plan : `docs/superpowers/{specs,plans}/2026-07-07-reserver-confirmer-puis-organiser*`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): note refonte modale - confirmer d'abord, organiser ensuite"
```

---

## Self-review (fait à la rédaction)

- **Couverture spec** : ligne repliée + défauts (T4), dépli/gating (T4), interrupteur + pref + applyHoldSetup allégé (T3), quota qui mord (T1+T4), phase confirmed + BookingSuccess + réemploi ReservationPlayersInline/OpenMatchToggle + repli d'échec (T5), saveLevelPref déplacé (T2), onConfirmed décalé + backdrop (T5), Stripe onSuccess (T5), CGV/Stripe/erreurs/hold inchangés (aucune tâche = aucun changement), doc (T7). ✔
- **Types** : `quotaBites(MyQuotaStatus|null|undefined, boolean)` cohérent T1/T4 ; `confirmedInfo.summary/paid` cohérent 5b/5c/5e/5g ; props `BookingSuccess` identiques T5 step 1 (tests) et step 3 (composant). ✔
- **Pièges repo rappelés** : shims cassés, flake pleine-suite, mocks `getMyReservations`/`listClubFriends`, branche à vérifier avant commit. ✔
