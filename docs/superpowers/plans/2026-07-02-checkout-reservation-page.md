# Checkout de réservation en page dédiée — Plan d'implémentation (Lot 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la modale de réservation (`BookingModal`, top-sheet 480 px de 788 lignes) par une vraie **page de checkout** `/reserver/confirmer` (mobile aérée + desktop 2 colonnes), en conservant à l'identique toutes les mécaniques métier (hold 5 min, abandon = libération, joueurs persistés avant paiement, part du joueur, CGV chemin carte).

**Architecture :** La logique métier de la modale part dans un **hook `useBookingCheckout`** (machine à états inchangée) ; le rendu est découpé en composants présentation `components/checkout/*` ; une **page** `app/reserver/confirmer/page.tsx` assemble le tout et gère la navigation. Un seul changement backend, **additif et idempotent** : `holdSlot` rend la PENDING existante du même joueur (survie au F5). `BookingModal` est supprimé à la fin ; ses ~44 tests migrent vers la page.

**Tech Stack :** Backend Express/Prisma/Jest ; Frontend Next.js 16 (App Router, client components), React, React Testing Library. Tests exécutés depuis le **worktree**.

**Spec :** `docs/superpowers/specs/2026-07-02-checkout-reservation-page-design.md`

> ⚠️ **Worktree & pièges** : travailler/tester UNIQUEMENT sous `...\palova\.claude\worktrees\<nom>\...` (les chemins `...\palova\backend|frontend` sont le dépôt principal, code potentiellement différent). Backend : `cd backend && npx jest <pattern>` (config `jest.config.ts` auto-détectée, ne pas passer `-c`). Frontend : `cd frontend && npx jest <pattern>` + `npx tsc --noEmit`. **Flake connu** : ne jamais valider par la full-suite frontend — suites BookingModal/checkout **scopées** + tsc. **Les subagents ne committent pas** (le coordinateur commit). `frontend/AGENTS.md` : ce Next.js a des breaking changes — pour les nouveaux fichiers de page (App Router), ne pas inventer d'API ; suivre le patron des pages existantes (`app/tournois/[id]/page.tsx`).

## Ordre des tâches (chaque tâche = commit, testable seule)

1. Backend — `holdSlot` idempotent (survie au refresh)
2. Front — hook `useBookingCheckout` (extraction de la logique)
3. Front — composants présentation `components/checkout/*`
4. Front — page `app/reserver/confirmer/page.tsx` (assemblage + navigation-out)
5. Front — brancher les points d'entrée (ClubReserve tap + deep-link + `/courts/[id]`)
6. Front — migration des tests + suppression de `BookingModal`

---

## Task 1 : Backend — `holdSlot` idempotent pour le même joueur

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (méthode `holdSlot`, ~l. 232-236)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

**Contexte :** aujourd'hui `holdSlot` pose un lock Redis `SET NX` dont la **valeur est le `userId`** ; si le lock existe déjà, il lève `SLOT_ALREADY_HELD`. Sur un refresh de la page de checkout, le même joueur re-appelle `holdSlot` sur le même créneau — on doit lui **rendre sa réservation PENDING** (avec son `createdAt`, pour recalculer le temps restant) au lieu d'une erreur. Un TIERS reçoit toujours `SLOT_ALREADY_HELD`.

- [ ] **Step 1 : Écrire le test (échec attendu)**

Dans `backend/src/services/__tests__/reservation.service.test.ts`, ajouter un bloc (repérer comment le fichier mocke `redis` et `prisma` — réutiliser les mêmes helpers ; `redis.set` renvoie `null` quand `NX` échoue, et `redis.get` renvoie la valeur du lock) :

```ts
describe('holdSlot — idempotence même joueur (refresh)', () => {
  const svc = new ReservationService();
  const base = { resourceId: 'r1', userId: 'u1', startTime: new Date('2026-07-03T16:00:00Z'), endTime: new Date('2026-07-03T17:30:00Z') };

  it('même joueur re-hold → renvoie la PENDING existante (pas d’erreur)', async () => {
    (redisMock.set as jest.Mock).mockResolvedValue(null);          // NX échoue : lock déjà posé
    (redisMock.get as jest.Mock).mockResolvedValue('u1');          // …par u1 lui-même
    const existing = { id: 'resa-1', status: 'PENDING', createdAt: new Date(), ...base };
    prismaMock.reservation.findFirst.mockResolvedValue(existing as any);

    const res = await svc.holdSlot(base as any);
    expect(res).toBe(existing);
    expect(prismaMock.reservation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ resourceId: 'r1', userId: 'u1', status: 'PENDING' }),
    }));
  });

  it('lock tenu par un AUTRE joueur → SLOT_ALREADY_HELD', async () => {
    (redisMock.set as jest.Mock).mockResolvedValue(null);
    (redisMock.get as jest.Mock).mockResolvedValue('u2');          // tenu par quelqu'un d'autre
    await expect(svc.holdSlot(base as any)).rejects.toThrow('SLOT_ALREADY_HELD');
    expect(prismaMock.reservation.findFirst).not.toHaveBeenCalled();
  });

  it('lock à moi mais aucune PENDING valide → SLOT_ALREADY_HELD', async () => {
    (redisMock.set as jest.Mock).mockResolvedValue(null);
    (redisMock.get as jest.Mock).mockResolvedValue('u1');
    prismaMock.reservation.findFirst.mockResolvedValue(null as any);
    await expect(svc.holdSlot(base as any)).rejects.toThrow('SLOT_ALREADY_HELD');
  });
});
```

> Adapter `redisMock`/`prismaMock` aux noms réels du fichier de test. Si le test n'a pas de mock `redis.get`, l'ajouter au mock `redis` (`__mocks__` ou `jest.mock('../redis/client')`).

Run: `cd backend && npx jest reservation.service -t idempotence` → FAIL (le code lève `SLOT_ALREADY_HELD` sans consulter `redis.get`).

- [ ] **Step 2 : Implémenter**

Dans `backend/src/services/reservation.service.ts`, remplacer le début de `holdSlot` :
```ts
    const acquired = await redis.set(lockKey, userId, 'EX', HOLD_TTL_SECONDS, 'NX');
    if (!acquired) throw new Error('SLOT_ALREADY_HELD');
```
par :
```ts
    const acquired = await redis.set(lockKey, userId, 'EX', HOLD_TTL_SECONDS, 'NX');
    if (!acquired) {
      // Idempotence : si CE joueur tient déjà le créneau (refresh de la page de checkout),
      // on lui rend sa réservation PENDING non expirée au lieu d'une erreur. Un tiers → refus.
      if ((await redis.get(lockKey)) === userId) {
        const holdExpiryCutoff = new Date(Date.now() - HOLD_EXPIRY_MS);
        const existing = await prisma.reservation.findFirst({
          where: { resourceId, userId, status: 'PENDING', startTime, endTime, createdAt: { gt: holdExpiryCutoff } },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) return existing;
      }
      throw new Error('SLOT_ALREADY_HELD');
    }
```
(`HOLD_EXPIRY_MS` est déjà défini en tête du fichier, l. 32.)

- [ ] **Step 3 : Vérifier**

Run: `cd backend && npx jest reservation.service` → tout PASS.
Run: `cd backend && npx tsc --noEmit` → aucune erreur.

- [ ] **Step 4 : (coordinateur) commit** — `reservation.service.ts` + son test.

> Note : `holdSlot` renvoie déjà l'objet `reservation` complet (donc `createdAt`). Vérifier que la route `POST /reservations/hold` (`backend/src/routes/reservations.ts`) sérialise `createdAt` dans sa réponse (le type front `Reservation` l'expose déjà — `api.ts:918`/voisins). Si la route fait un `select` restreint sans `createdAt`, l'ajouter. Ceci alimente la reprise du timer (Task 4).

---

## Task 2 : Front — hook `useBookingCheckout` (extraction de la logique)

**Files:**
- Create: `frontend/components/checkout/useBookingCheckout.ts`
- Create: `frontend/lib/bookingErrors.ts` (extrait `BOOKING_ERRORS` + `HOLD_SECONDS` + `formatHour`, partagés hook/composants)
- Read (source à porter) : `frontend/components/BookingModal.tsx` (l. 71-93, 153-442)

**But :** déplacer **sans changement de comportement** toute la machine à états de `BookingModal` (hold-au-montage, timer, phases, partenaires/équipes, visibilité/niveau, sélection de paiement, `persistHoldSetup`, `handleConfirm`, gating CGV, mapping d'erreurs) dans un hook. Le hook ne rend rien ; il expose l'état + les handlers pour les composants de présentation.

- [ ] **Step 1 : Extraire les constantes partagées**

Create `frontend/lib/bookingErrors.ts` en y **déplaçant** depuis `BookingModal.tsx` : `HOLD_SECONDS` (l. 71), `formatHour` (l. 73-76) et l'objet `BOOKING_ERRORS` (l. 78-93). Exporter les trois.

- [ ] **Step 2 : Définir l'interface du hook (contrat) et l'implémenter par portage**

Create `frontend/components/checkout/useBookingCheckout.ts`. Le hook prend **les mêmes entrées que les props actuelles de `BookingModal`** (l. 29-69) plus deux callbacks : `onConfirmed(reservation, paid?)` et **`onExit()`** (navigation retour, remplace `onClose`). Il expose un objet structuré. Signature :

```ts
import type { TimeSlot, Reservation, MemberPackage, ClubMemberSearchResult, MyQuotaStatus, Subscription } from '@/lib/api';
import type { MatchPlayerData } from '@/components/match/MatchTeams';
import type { PickedMember } from '@/components/match/AddPlayerSheet';

export interface BookingCheckoutInput {
  slot: TimeSlot; resourceId: string; price: string; duration: number; token: string;
  timezone?: string; slug?: string; maxPlayers?: number; sportKey?: string; format?: string; resourceName?: string;
  packages?: MemberPackage[]; subscriptions?: Subscription[]; quotaStatus?: MyQuotaStatus | null;
  clubId?: string; requireOnlinePayment?: boolean; requireCardFingerprint?: boolean; hasCardOnFile?: boolean;
  stripeActive?: boolean; cancellationCutoffHours?: number; refundOnCancelWithinCutoff?: boolean;
  /** Nombre de secondes déjà écoulées sur le hold (reprise après refresh) — 0 par défaut. */
  initialElapsedSeconds?: number;
  onConfirmed: (reservation: Reservation, paid?: { label: string }) => void;
  onExit: () => void;
}

export interface BookingCheckout {
  phase: 'holding' | 'held' | 'error';
  secondsLeft: number; mm: string; ss: string; urgent: boolean;
  reservation: Reservation | null; errorMsg: string; busy: boolean;
  // pricing
  totalPrice: string; totalEuros: number; perPerson: string; perPlayer: string;
  capacity: number; durLabel: string; onlineAmountLabel: string;
  // players
  showPartners: boolean; isPadel: boolean; me: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null;
  partners: ClubMemberSearchResult[]; addPartner: (m: ClubMemberSearchResult) => void; removePartner: (id: string) => void;
  addPartnerTo: (m: PickedMember, team: 1 | 2, slot?: number) => void; buildPlayers: () => MatchPlayerData[];
  teamsDraft: Record<string, 1 | 2>; slotsDraft: Record<string, number>;
  setTeamsDraft: (t: Record<string, 1 | 2>) => void; setSlotsDraft: (s: Record<string, number>) => void;
  addTarget: { team: 1 | 2; slot?: number } | null; setAddTarget: (t: { team: 1 | 2; slot?: number } | null) => void;
  atCap: boolean; spotsLeft: number; cap: number; nbPlayers: number;
  // options
  visibility: 'PRIVATE' | 'PUBLIC'; setVisibility: (v: 'PRIVATE' | 'PUBLIC') => void; levelForSport: boolean;
  levelLimited: boolean; setLevelLimited: (v: boolean) => void; levelMin: number; levelMax: number;
  setLevel: (lo: number, hi: number) => void;
  // payment
  cover: ReturnType<typeof import('@/lib/subscriptions').coveringSubscription>;
  useSub: boolean; setUseSub: (v: boolean) => void; payMode: 'club' | 'online'; setPayMode: (m: 'club' | 'online') => void;
  paySource: string | null; setPaySource: (id: string | null) => void; packages: MemberPackage[];
  onlineAvailable: boolean; onlineRequiredButUnavailable: boolean; onlineShare: boolean; requireOnlinePayment: boolean; requireCardFingerprint: boolean;
  cardPath: boolean; cgvAccepted: boolean; setCgvAccepted: (v: boolean) => void; cgvStatus: 'published' | 'fallback' | null;
  createStripeIntent: () => Promise<{ clientSecret: string; stripeAccountId: string | null; customerSessionClientSecret: string | null }>;
  stripeType: 'payment' | 'setup'; stripeAmountLabel: string;
  // actions
  persistHoldSetup: () => Promise<void>; handleConfirm: () => Promise<void>; handleExit: () => Promise<void>;
  confirmLabel: string; quotaStatus?: MyQuotaStatus | null; cancellationText: string;
  slot: TimeSlot; timezone?: string; resourceName?: string; format?: string; slug?: string; token: string;
}

export function useBookingCheckout(input: BookingCheckoutInput): BookingCheckout { /* …portage… */ }
```

**Portage (copier la logique existante, en remplaçant les usages) :**
- Recopier tel quel depuis `BookingModal` : tous les `useState`/`useRef` (l. 162-196), tous les `useEffect` (l. 284-380) **avec une seule modification** : dans l'effet hold-au-montage (l. 284-308), initialiser le timer à **`HOLD_SECONDS - (input.initialElapsedSeconds ?? 0)`** au lieu de `HOLD_SECONDS` (ligne `setSecondsLeft(...)`), et démarrer `secondsLeft` à cette même valeur (state initial). Le reste de l'effet (garde `didHold`, `closedRef`, annulation si fermé pendant le vol) est inchangé.
- Recopier tous les dérivés (l. 199-275) : `cap`, `showPartners`, `isPadel`, prix, `cover`, `capacity`, `cardIntentPath`/`cardPath`, etc.
- Recopier les handlers `addPartner`/`addPartnerTo`/`removePartner`/`buildPlayers`/`nextSide` (l. 228-255), `persistHoldSetup` (l. 386-399), `handleConfirm` (l. 401-426).
- Renommer `handleClose` → **`handleExit`** (l. 428-439) : corps identique, mais l'appel final `onClose()` devient `input.onExit()`.
- `createStripeIntent` : extraire la closure `createIntent` du `StripePaymentStep` (l. 745-753) en méthode du hook. `stripeType`/`stripeAmountLabel` = miroir de l. 742-743.
- Exposer `setLevel(lo, hi)` = `{ setLevelMin(lo); setLevelMax(hi); }`, et `cancellationText = cancellationPolicyLabel(cancellationCutoffHours, refundOnCancelWithinCutoff ?? false)`.
- `confirmLabel` = l'expression du bouton (l. 771-774).
- `mm`/`ss`/`urgent` comme l. 441-442, 381.

- [ ] **Step 3 : tsc**

Run: `cd frontend && npx tsc --noEmit` → aucune erreur. (Pas de test unitaire du hook ici : il est validé via les tests de page en Task 6 ; le hook n'est pas encore consommé.)

- [ ] **Step 4 : (coordinateur) commit** — `useBookingCheckout.ts` + `lib/bookingErrors.ts`.

---

## Task 3 : Front — composants de présentation `components/checkout/*`

**Files:**
- Create: `frontend/components/checkout/CheckoutHero.tsx`
- Create: `frontend/components/checkout/CheckoutPlayers.tsx`
- Create: `frontend/components/checkout/CheckoutMatchOptions.tsx`
- Create: `frontend/components/checkout/CheckoutPayment.tsx`
- Create: `frontend/components/checkout/CheckoutFooter.tsx`
- Create: `frontend/components/reservations/CancellationNotice.tsx` (extrait partagé)
- Test: `frontend/__tests__/CheckoutHero.test.tsx`
- Read (source à porter) : `BookingModal.tsx` (l. 95-151, 444-482, 502-777) et `AgendaHero.tsx`

**But :** découper le rendu en composants purs pilotés par des props (plus de closures sur `th`). Chaque composant reçoit le sous-ensemble de `BookingCheckout` qu'il affiche.

- [ ] **Step 1 : `CancellationNotice`** — déplacer le composant `CancellationNotice` (BookingModal l. 141-151) dans son propre fichier, prop `text: string` (le `th` vient de `useTheme()` en interne). Exporter `CancellationNotice`.

- [ ] **Step 2 : `CheckoutHero` (nouveau design « brume bleue ») + test**

Create `frontend/__tests__/CheckoutHero.test.tsx` :
```tsx
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { CheckoutHero } from '@/components/checkout/CheckoutHero';

const slot = { startTime: '2026-07-03T16:00:00Z', endTime: '2026-07-03T17:30:00Z', price: '25', offPeak: false } as any;
const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

it('affiche court, horaire, prix, part joueur et timer', () => {
  wrap(<CheckoutHero slot={slot} timezone="Europe/Paris" resourceName="Court 2" format="double"
    sportKey="padel" totalPrice="25" perPerson="6,25" capacity={4} durLabel="1h30"
    phase="held" mm="04" ss="23" urgent={false} secondsLeft={263} holdSeconds={300} />);
  expect(screen.getByText('Court 2')).toBeInTheDocument();
  expect(screen.getByText(/25€|25 €/)).toBeInTheDocument();
  expect(screen.getByText(/04:23/)).toBeInTheDocument();
});
```

Create `frontend/components/checkout/CheckoutHero.tsx` — reprend `{ slot, timezone, resourceName, format, sportKey, totalPrice, perPerson, capacity, durLabel, phase, mm, ss, urgent, secondsLeft, holdSeconds }`. Fond **brume bleue** `linear-gradient(115deg, #e3edf9, #c8daf0)`, texte encre `th.text`, chip sport en blanc translucide, **pastille timer blanche** (`⏱ mm:ss`, `th.fontMono`, coral `ACCENTS.coral` si `urgent`) en haut à droite, **barre de hold** en bas du hero (`width: (secondsLeft/holdSeconds)*100%`, `ACCENTS.blue`, coral si urgent), pill « heures creuses » si `slot.offPeak`. Reprend les données de `BookingHeaderCard` (BookingModal l. 96-134) mais dans le nouvel habillage. `data-testid="checkout-hero"`.

- [ ] **Step 3 : `CheckoutPlayers`** — porte la section « Joueurs / partenaires » (BookingModal l. 524-606, hors visibilité/niveau) : `MatchTeams` éditable (padel) ou chips partenaires + `PartnerSearch` + `AddPlayerSheet`. Props = le sous-groupe `players` de `BookingCheckout` + `slug`/`token`. Rendu **seulement si `showPartners`**.

- [ ] **Step 4 : `CheckoutMatchOptions`** — porte visibilité + niveau (BookingModal l. 569-598) : `Segmented` Privée/Ouverte + interrupteur « Limiter le niveau » + `LevelRangeSlider`. Props = sous-groupe `options` + `spotsLeft`, `isPadel`. Rendu seulement si `isPadel`.

- [ ] **Step 5 : `CheckoutPayment`** — porte le bloc « Mode de paiement » (BookingModal l. 615-707 : les 4 avenues abo/club/online/carnets) **et** le pied de paiement carte (l. 718-764 : CGV + `StripePaymentStep`). Props = sous-groupe `payment` + `token`/`slug`/`reservation` + callbacks `onConfirmed`/`onExit`. Les briques de style `payCard`/`payTile`/`radioDot`/`checkBadge` (BookingModal l. 452-481) deviennent des helpers internes au composant.

- [ ] **Step 6 : `CheckoutFooter`** — la rangée « Abandonner / Confirmer » (BookingModal l. 766-776) quand `!cardPath` ; sur desktop c'est le bouton collant de la colonne de droite. Props : `confirmLabel`, `busy`, `phase`, `disabled`, `onConfirm`, `onExit`. (Quand `cardPath`, c'est `CheckoutPayment` qui rend le bouton Stripe ; `CheckoutFooter` n'est utilisé que sur le chemin non-carte.)

- [ ] **Step 7 : Vérifier**

Run: `cd frontend && npx jest CheckoutHero` → PASS. `cd frontend && npx tsc --noEmit` → aucune erreur.

- [ ] **Step 8 : (coordinateur) commit** — les 6 composants + le test.

---

## Task 4 : Front — page `app/reserver/confirmer/page.tsx`

**Files:**
- Create: `frontend/app/reserver/confirmer/page.tsx`
- Create: `frontend/lib/useIsDesktop.ts` **si absent** (sinon réutiliser l'existant — vérifier `grep -r useIsDesktop frontend/lib frontend/components`)
- Read : `app/tournois/[id]/page.tsx` (patron de page client), `ClubReserve.tsx` (l. 355-390, props passées à `BookingModal`)

**But :** une page client qui lit `?resource=&start=&duration=`, charge le contexte de paiement, appelle `useBookingCheckout`, assemble les composants (mobile 1 colonne / desktop 2 colonnes) et gère la sortie (retour = libération).

- [ ] **Step 1 : Squelette de page + chargement du contexte**

`app/reserver/confirmer/page.tsx` (client component). Il :
1. Lit `resource`, `start`, `duration` de l'URL (`useSearchParams`), `token` (`useAuth`), club (`useClub` → `slug`, `timezone`, flags).
2. Charge le **contexte de checkout** via les API déjà utilisées par `ClubReserve` : le créneau (prix/offPeak) en re-cherchant la disponibilité de la ressource pour la date de `start` (`api.getAvailability`/équivalent utilisé par ClubReserve — repérer le nom exact) et en sélectionnant le slot dont `startTime === start` ; les métadonnées ressource (nom, format, sportKey) ; `packages` (`api.getMyClubPackages`), `subscriptions` (`api.getMyClubSubscriptions`), `quotaStatus` (`api.getMyClubQuotaStatus` — nom exact via grep), et les flags club (`requireOnlinePayment`/`requireCardFingerprint`/`hasCardOnFile`/`stripeActive`/`cancellationCutoffHours`/`refundOnCancelWithinCutoff`) exactement comme `ClubReserve` les résout aujourd'hui (les copier depuis ClubReserve).
3. Tant que le contexte n'est pas prêt → écran « Chargement… » (même style que les autres pages).

> Simplification autorisée : `resourceName`, `format`, `sportKey`, `price`, `offPeak` peuvent être **passés en query** par le point d'entrée (Task 5) pour éviter un aller-retour, tout en restant refresh-safe (l'URL persiste). Le contexte de paiement (packages/subs/quota/flags) est **toujours** re-fetché. Choisir cette voie pour limiter le couplage.

- [ ] **Step 2 : Reprise du timer (refresh)**

Le hook pose le hold au montage ; `holdSlot` (Task 1) rend la PENDING existante avec `createdAt`. Calculer `initialElapsedSeconds = clamp(0, HOLD_SECONDS, floor((Date.now() - Date.parse(reservation.createdAt))/1000))` **après** réception de la résa, et le passer au hook. ⚠️ Comme le hook pose le hold lui-même, exposer depuis le hook la `reservation.createdAt` et recalculer `secondsLeft` à la première transition `held` : implémenter en initialisant le state `secondsLeft` du hook à `HOLD_SECONDS - (elapsed)`, où `elapsed` est dérivé de `res.createdAt` **dans l'effet hold** (préférer cette voie à `initialElapsedSeconds` en prop si la résa n'est connue qu'après le hold — mettre à jour l'interface du hook en conséquence et retirer `initialElapsedSeconds`). Documenter le choix retenu dans le commit.

- [ ] **Step 3 : Layout**

- **Mobile** (`< 900px`) : barre titre « ← Confirmer ma réservation » (le ← appelle `handleExit`) → `CheckoutHero` → `CheckoutPlayers` → `CheckoutMatchOptions` → `QuotaStatus` (si `quotaStatus`) → `CheckoutPayment` → `CancellationNotice` → footer **collant** (`position: sticky; bottom: 0`) : `CheckoutFooter` (ou, si `cardPath`, le bloc Stripe rendu par `CheckoutPayment`) + « Abandonner » ; le CTA porte `confirmLabel`.
- **Desktop** (`≥ 900px`, `useIsDesktop`) : 2 colonnes (`max-width ~940px`) — gauche : Players, MatchOptions, Cancellation ; droite (collante) : Hero + Payment + CTA.
- Phase `error` : carte d'erreur + bouton « Retour à la grille » (`router.push('/reserver')`). Phase `holding` : hero + « Blocage du créneau… », reste masqué (gating `held` conservé).

- [ ] **Step 4 : Navigation-out = libération**

- `handleExit` (du hook) annule la PENDING puis **`router.back()`** (ou `router.push('/reserver')` si pas d'historique).
- **Cleanup au démontage** de la page : un `useEffect(() => () => { … }, [])` qui, si non `settled`, annule la résa — pour couvrir le back navigateur / navigation ailleurs. Réutiliser la même garde `settled`/`closedRef` que le hook (l'exposer depuis le hook, ou faire porter le cleanup par le hook lui-même via un effet de démontage gardé — **attention StrictMode** : ne pas ré-annuler sur le faux démontage ; suivre exactement le raisonnement des commentaires BookingModal l. 277-283, garde `didHold`/`closedRef`). Documenter.
- `onConfirmed` : afficher un état de succès puis `router.push('/reserver')` avec un flag (query `?confirmed=1` ou state) que `ClubReserve` lit pour son bandeau « Réservation confirmée ! » + `reloadAll`.

- [ ] **Step 5 : Vérifier**

Run: `cd frontend && npx tsc --noEmit` → aucune erreur. (Tests de la page en Task 6.) Vérif manuelle optionnelle : `/reserver/confirmer?resource=court-1&start=<ISO>&duration=90`.

- [ ] **Step 6 : (coordinateur) commit** — la page (+ `useIsDesktop` si créé).

---

## Task 5 : Front — brancher les points d'entrée

**Files:**
- Modify: `frontend/components/ClubReserve.tsx` (l. 60, 159-179, 355-390)
- Modify: `frontend/app/courts/[id]/page.tsx` (le handler qui ouvre `BookingModal`)
- Test: `frontend/__tests__/ClubReserve.deeplink.test.tsx`, `frontend/__tests__/ClubReserve.pastslots.test.tsx`, `frontend/__tests__/ClubReserve.persport.test.tsx`

- [ ] **Step 1 : Tap sur un créneau → navigation**

Dans `ClubReserve`, remplacer `onSlot` (l. 176-179) : au lieu de `setBooking(...)`, faire `router.push` vers `/reserver/confirmer` avec les query params `resource`, `start` (=`slot.startTime`), `duration`, plus les hints d'affichage `price`, `sport`, `format`, `name`, `offpeak` (voir Task 4 Step 1). Supprimer l'état `booking` (l. 60) et le rendu `<BookingModal … />` (l. 355-390).

- [ ] **Step 2 : Deep-link `?resource=&start=`**

L'effet deep-link (l. 159-174) qui faisait `setBooking(...)` → **redirige** vers `/reserver/confirmer?...` (`router.replace`). Conserver la résolution de sport/durée existante pour construire les query params.

- [ ] **Step 3 : `/courts/[id]`**

Le handler de `app/courts/[id]/page.tsx` qui ouvrait `BookingModal` → `router.push('/reserver/confirmer?...')` de la même façon. (La page terrain legacy garde sa grille/SSE ; seul l'ouverture de la confirmation change.)

- [ ] **Step 4 : Bandeau de confirmation au retour**

`ClubReserve` lit `?confirmed=1` (ou l'équivalent choisi en Task 4 Step 4) au montage → affiche le bandeau « Réservation confirmée ! » existant + `reloadAll()`, puis nettoie le param (`router.replace('/reserver')`).

- [ ] **Step 5 : Mettre à jour les tests de navigation**

Adapter `ClubReserve.deeplink.test.tsx` (le deep-link doit **naviguer** vers `/reserver/confirmer`, plus monter la modale) : mocker `useRouter().push/replace` et asserter l'URL. `pastslots`/`persport` : retirer les assertions qui montaient `BookingModal` au clic ; asserter la navigation. Ces suites **montent le vrai `ClubNav`** — garder les mocks `useRouter`/`useClub`/`lib/api` stables (cf. conventions du repo).

Run: `cd frontend && npx jest ClubReserve` → PASS. `cd frontend && npx tsc --noEmit` → OK.

- [ ] **Step 6 : (coordinateur) commit** — ClubReserve + courts/[id] + tests de navigation.

---

## Task 6 : Front — migration des tests + suppression de `BookingModal`

**Files:**
- Create: `frontend/__tests__/Checkout.test.tsx`, `Checkout.payment.test.tsx`, `Checkout.packages.test.tsx`, `Checkout.subscription.test.tsx` (portage des 4 suites BookingModal)
- Delete: `frontend/components/BookingModal.tsx`
- Delete: `frontend/__tests__/BookingModal.test.tsx`, `BookingModal.payment.test.tsx`, `BookingModal.packages.test.tsx`, `BookingModal.subscription.test.tsx`

- [ ] **Step 1 : Porter les 4 suites**

Pour chaque suite BookingModal (~44 tests au total), créer la suite Checkout équivalente qui **rend la page** `app/reserver/confirmer/page.tsx` (via `useSearchParams` mocké fournissant `resource/start/duration`, `useClub`/`useAuth` mockés, `lib/api` mocké comme aujourd'hui) au lieu de `<BookingModal … />`. Scénarios à conserver **à l'identique** :
- hold au montage + garde StrictMode (double montage → un seul `holdSlot`) ;
- échec du hold → écran d'erreur + « Retour à la grille » ;
- abandon / retour → `cancelReservation` appelé une fois ;
- timer expiré → écran d'erreur ;
- **reprise après refresh** (nouveau) : `holdSlot` renvoie une résa dont `createdAt` = il y a 2 min → `secondsLeft` initial ≈ 180 (assert `03:0x` affiché) ;
- 4 chemins de paiement (part en ligne, club, carnet, abo) ; CGV gaté chemin carte ; `applyHoldSetup` avec partenaires/équipes avant confirm.

Réutiliser les mocks/fixtures des suites BookingModal (les copier). Mettre à jour les libellés d'assertion si le nouveau design change un texte (ex. « Abandonner (le créneau sera libéré) »).

- [ ] **Step 2 : Supprimer `BookingModal` et ses suites**

Vérifier d'abord qu'aucun import ne subsiste : `grep -rn "BookingModal" frontend/ --include=*.tsx --include=*.ts` ne doit renvoyer que les fichiers à supprimer. Puis supprimer le composant et ses 4 suites.

- [ ] **Step 3 : Vérifier (scopé, jamais la full-suite)**

Run: `cd frontend && npx jest Checkout ClubReserve` → tout PASS.
Run: `cd frontend && npx tsc --noEmit` → aucune erreur.
Run: `cd backend && npx jest reservation.service` → PASS.

- [ ] **Step 4 : (coordinateur) commit** — nouvelles suites + suppressions.

---

## Vérification finale

- [ ] Back : `cd backend && npx jest reservation.service` → PASS ; `tsc` clean.
- [ ] Front : `cd frontend && npx jest Checkout CheckoutHero ClubReserve` → PASS ; `tsc` clean.
- [ ] `grep -rn "BookingModal" frontend/` → aucun résultat (composant + suites supprimés).
- [ ] (Manuel) Taper un créneau depuis `/reserver` → page `/reserver/confirmer` ; F5 → timer reprend, pas de double-hold ; « Abandonner » → retour grille, créneau libéré ; confirmer (club/abo/carnet) → bandeau succès ; chemin online → Stripe inline. Desktop ≥ 900px → 2 colonnes.

## Notes

- **Un seul changement backend**, additif/idempotent. Routes/webhooks Stripe inchangés.
- Le hero doux de `CheckoutHero` est **spécifique au checkout** dans ce lot ; la généralisation à tous les heros est le **Lot 2** (`docs/superpowers/plans/2026-07-02-heros-brume-bleue.md`).
- Commits ciblés par fichiers explicites (jamais `git add -A`) — dépôt édité en parallèle.
