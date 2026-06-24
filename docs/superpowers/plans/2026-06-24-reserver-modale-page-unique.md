# Refonte modale « Réserver » — page unique — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fusionner les deux écrans de la modale de réservation en une page unique qui bloque le créneau dès l'ouverture (timer 5 min), avec un header compact, les conditions d'annulation en bloc d'info, le paiement en ligne réduit à la part du joueur, et un bouton final adaptatif.

**Architecture :** Le blocage Redis est posé au montage (`holdSlot`, organisateur seul, PRIVATE). Les partenaires/visibilité/niveau choisis ensuite sont appliqués sur la résa PENDING via un **nouvel endpoint `applyHoldSetup`** appelé **avant** la confirmation/paiement (évite la course avec le webhook Stripe). `confirmReservation`, sa route et le webhook restent inchangés.

**Tech Stack :** Backend Express 5 + Prisma 7 (`reservation.service.ts`, `routes/reservations.ts`), tests Jest + supertest. Frontend Next.js 16 + React 19 (`components/BookingModal.tsx`), tests React Testing Library. Spec : `docs/superpowers/specs/2026-06-24-reserver-modale-page-unique-design.md`.

> **Référence visuelle :** maquette validée dans `.superpowers/brainstorm/1625-1782288446/content/modal-v4.html` (header carte, timer barre+chip, bloc annulation, online=part). Porter les styles depuis là + le composant existant.

---

## Task 1 : Backend — méthode `applyHoldSetup`

Applique partenaires/visibilité/niveau sur une réservation **PENDING** (réutilise `validatePartners`/`participantRows` existants).

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (ajouter une méthode publique après `holdSlot`, vers la ligne 316)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter dans `reservation.service.test.ts` un `describe` (s'inspirer du style des tests `holdSlot` existants — mocks `prismaMock`). Le service est instancié comme dans les autres tests du fichier (chercher `new ReservationService(` en tête de fichier et réutiliser la même instance/les mocks).

```ts
describe('applyHoldSetup', () => {
  const baseReservation = {
    id: 'res-1', userId: 'user-1', status: 'PENDING',
    createdAt: new Date(), totalPrice: 20,
    resource: { clubId: 'club-1', attributes: { format: 'double' } },
  };

  it('remplace les participants et met à jour visibilité/niveau', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(baseReservation as any);
    // validatePartners lit les adhésions ACTIVE des partenaires
    prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'user-2' }] as any);
    const tx = {
      reservationParticipant: { deleteMany: jest.fn(), createMany: jest.fn() },
      reservation: { update: jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }) },
    };
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(tx));

    await service.applyHoldSetup('res-1', 'user-1', {
      partnerUserIds: ['user-2'], visibility: 'PUBLIC',
      targetLevelMin: 3, targetLevelMax: 5,
    });

    expect(tx.reservationParticipant.deleteMany).toHaveBeenCalledWith({ where: { reservationId: 'res-1' } });
    expect(tx.reservationParticipant.createMany).toHaveBeenCalled();
    // organisateur + 1 partenaire = 2 lignes
    expect(tx.reservationParticipant.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'res-1' },
      data: expect.objectContaining({ visibility: 'PUBLIC', targetLevelMin: 3, targetLevelMax: 5 }),
    }));
  });

  it('rejette TOO_MANY_PLAYERS au-delà de la capacité du terrain', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(baseReservation as any);
    prismaMock.clubMembership.findMany.mockResolvedValue(
      [{ userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }, { userId: 'u5' }] as any,
    );
    await expect(service.applyHoldSetup('res-1', 'user-1', {
      partnerUserIds: ['u2', 'u3', 'u4', 'u5'], // 1 + 4 = 5 > 4 (double)
    })).rejects.toThrow('TOO_MANY_PLAYERS');
  });

  it('refuse si la résa n est pas PENDING', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({ ...baseReservation, status: 'CONFIRMED' } as any);
    await expect(service.applyHoldSetup('res-1', 'user-1', { visibility: 'PRIVATE' }))
      .rejects.toThrow('RESERVATION_NOT_PENDING');
  });

  it('refuse si la résa appartient à un autre joueur', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({ ...baseReservation, userId: 'other' } as any);
    await expect(service.applyHoldSetup('res-1', 'user-1', { visibility: 'PRIVATE' }))
      .rejects.toThrow('UNAUTHORIZED');
  });
});
```

> Adapter `service`/`prismaMock` aux noms réellement utilisés en tête du fichier de test.

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd backend && npx jest reservation.service --t "applyHoldSetup"`
Expected: FAIL — `service.applyHoldSetup is not a function`.

- [ ] **Step 3 : Implémenter la méthode**

Dans `reservation.service.ts`, juste après la fin de `holdSlot` (≈ ligne 316), ajouter :

```ts
  /**
   * Applique les joueurs/visibilité/niveau choisis APRÈS le blocage (modale page unique)
   * sur une réservation encore PENDING. Appelé avant la confirmation/paiement → les
   * participants sont persistés quel que soit le confirmeur (client OU webhook Stripe),
   * sans re-poser le hold (pas de fenêtre de course). Réutilise validatePartners /
   * participantRows. Aucun paiement n'existe encore sur une PENDING → suppression sûre.
   */
  async applyHoldSetup(
    reservationId: string,
    userId: string,
    setup: {
      partnerUserIds?: string[];
      visibility?: 'PRIVATE' | 'PUBLIC';
      targetLevelMin?: number | null;
      targetLevelMax?: number | null;
    },
  ) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { clubId: true, attributes: true } } },
    });
    if (!reservation)                     throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)    throw new Error('UNAUTHORIZED');
    if (reservation.status !== 'PENDING') throw new Error('RESERVATION_NOT_PENDING');

    const format = (reservation.resource.attributes as { format?: string } | null)?.format;
    const partners = await this.validatePartners(userId, reservation.resource.clubId, format, setup.partnerUserIds);
    const priceCents = Math.round(Number(reservation.totalPrice) * 100);

    return prisma.$transaction(async (tx) => {
      await tx.reservationParticipant.deleteMany({ where: { reservationId } });
      await tx.reservationParticipant.createMany({
        data: this.participantRows(reservationId, userId, partners, priceCents),
      });
      return tx.reservation.update({
        where: { id: reservationId },
        data: {
          visibility: setup.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
          targetLevelMin: setup.targetLevelMin ?? null,
          targetLevelMax: setup.targetLevelMax ?? null,
        },
      });
    });
  }
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd backend && npx jest reservation.service --t "applyHoldSetup"`
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(reservation): applyHoldSetup applique joueurs/visibilité sur une résa PENDING"
```

---

## Task 2 : Backend — route `POST /api/reservations/:id/setup`

**Files:**
- Modify: `backend/src/routes/reservations.ts` (ajouter la route après `/:id/confirm`, ≈ ligne 115)
- Test: `backend/src/routes/__tests__/reservations.routes.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Vérifier en tête du fichier comment `reservationService` est mocké (probablement `jest.mock('../../services/reservation.service')`). Ajouter :

```ts
describe('POST /api/reservations/:id/setup', () => {
  it('relaie les joueurs/visibilité au service et renvoie 200', async () => {
    const applyHoldSetup = jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    (ReservationService as jest.Mock).mockImplementation(() => ({ applyHoldSetup }));

    const res = await request(app).post('/api/reservations/res-1/setup')
      .set('Authorization', `Bearer ${token}`)
      .send({ partnerUserIds: ['u2'], visibility: 'PUBLIC', targetLevelMin: 3, targetLevelMax: 5 });

    expect(res.status).toBe(200);
    expect(applyHoldSetup).toHaveBeenCalledWith('res-1', 'user-1',
      expect.objectContaining({ partnerUserIds: ['u2'], visibility: 'PUBLIC', targetLevelMin: 3, targetLevelMax: 5 }));
  });

  it('mappe TOO_MANY_PLAYERS en 409', async () => {
    (ReservationService as jest.Mock).mockImplementation(() => ({
      applyHoldSetup: jest.fn().mockRejectedValue(new Error('TOO_MANY_PLAYERS')),
    }));
    const res = await request(app).post('/api/reservations/res-1/setup')
      .set('Authorization', `Bearer ${token}`).send({ partnerUserIds: ['a', 'b', 'c', 'd'] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TOO_MANY_PLAYERS');
  });
});
```

> Adapter `token`/`ReservationService`/`app` aux helpers du fichier. Si le mock du service est instancié une seule fois en haut, suivre le même pattern que `match.routes.test.ts` (réassignation dans `beforeEach`).

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && npx jest reservations.routes --t "/setup"`
Expected: FAIL — 404 (route absente).

- [ ] **Step 3 : Implémenter la route**

Dans `routes/reservations.ts`, juste après le bloc `router.post('/:id/confirm', ...)` (≈ ligne 115), ajouter. Vérifier d'abord que `handleError` mappe déjà ces codes ; sinon ajouter le mapping (chercher l'objet de mapping en tête du fichier et y ajouter `TOO_MANY_PLAYERS: 409, PARTNER_DUPLICATE: 409, PARTNER_NOT_MEMBER: 409, RESERVATION_NOT_PENDING: 409, UNAUTHORIZED: 403, RESERVATION_NOT_FOUND: 404` s'ils manquent) :

```ts
router.post('/:id/setup', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = req.body ?? {};
    const partnerUserIds = Array.isArray(b.partnerUserIds)
      ? b.partnerUserIds.filter((x: unknown): x is string => typeof x === 'string')
      : undefined;
    const visibility = b.visibility === 'PUBLIC' ? 'PUBLIC' : b.visibility === 'PRIVATE' ? 'PRIVATE' : undefined;
    const num = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 8 ? v : null);
    const updated = await reservationService.applyHoldSetup(asString(req.params.id), req.user!.id, {
      partnerUserIds, visibility,
      targetLevelMin: b.targetLevelMin === undefined ? undefined : num(b.targetLevelMin),
      targetLevelMax: b.targetLevelMax === undefined ? undefined : num(b.targetLevelMax),
    });
    res.json(updated);
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Vérifier le succès**

Run: `cd backend && npx jest reservations.routes --t "/setup"`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/reservations.ts backend/src/routes/__tests__/reservations.routes.test.ts
git commit -m "feat(reservation): route POST /reservations/:id/setup"
```

---

## Task 3 : Frontend — `api.applyHoldSetup`

**Files:**
- Modify: `frontend/lib/api.ts` (après `confirmReservation`, ≈ ligne 147)

- [ ] **Step 1 : Ajouter la méthode**

```ts
  applyHoldSetup: (
    reservationId: string,
    token: string,
    setup: {
      partnerUserIds?: string[];
      visibility?: 'PRIVATE' | 'PUBLIC';
      targetLevelMin?: number | null;
      targetLevelMax?: number | null;
    },
  ) =>
    request<Reservation>(`/api/reservations/${reservationId}/setup`, {
      method: 'POST',
      body: JSON.stringify(setup),
    }, token),
```

- [ ] **Step 2 : Vérifier la compilation TS**

Run: `cd frontend && npx tsc --noEmit`
Expected: pas d'erreur sur `api.ts`.

- [ ] **Step 3 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): applyHoldSetup"
```

---

## Task 4 : Frontend — pivot structurel de `BookingModal` (page unique, hold au montage)

C'est le cœur. On réécrit le composant : suppression de la phase `confirm`, hold au montage, page unique, fermeture qui annule, bouton « Confirmer la réservation » pour « régler au club ». Header/timer/annulation/online-part/adaptatif sont inclus directement (la maquette v4 fournit les styles).

**Files:**
- Modify: `frontend/components/BookingModal.tsx`
- Test: `frontend/__tests__/BookingModal.test.tsx` (réécrit)

- [ ] **Step 1 : Réécrire le test (exprime le nouveau comportement)**

Remplacer **tout** le contenu de `frontend/__tests__/BookingModal.test.tsx` par :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingModal from '../components/BookingModal';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot } from '../lib/api';

let mockClub: { levelSystemEnabled?: boolean } | null = null;
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'club-demo', club: mockClub, loading: false }),
}));

jest.mock('../lib/api', () => ({
  api: {
    holdSlot:           jest.fn(),
    confirmReservation: jest.fn(),
    cancelReservation:  jest.fn(),
    applyHoldSetup:     jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }),
    searchClubMembers:  jest.fn(),
    getMyRating:        jest.fn().mockResolvedValue(null),
    getClubPage:        jest.fn().mockResolvedValue({}),
  },
  assetUrl: (u: string | null) => u,
}));

const mockSlot: TimeSlot = {
  startTime: '2025-06-15T06:00:00.000Z',
  endTime:   '2025-06-15T07:00:00.000Z',
  available: true, price: '25', offPeak: false,
};

function renderModal(overrides: Partial<React.ComponentProps<typeof BookingModal>> = {}) {
  return render(
    <ThemeProvider>
      <BookingModal slot={mockSlot} resourceId="court-1" price="25" duration={60}
        token="jwt-token" onClose={jest.fn()} onConfirmed={jest.fn()} {...overrides} />
    </ThemeProvider>
  );
}

describe('BookingModal — page unique', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockClub = null; localStorage.clear();
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
  });

  it('bloque le créneau dès l ouverture (sans interaction)', async () => {
    renderModal();
    await waitFor(() => expect(api.holdSlot).toHaveBeenCalledWith(
      { resourceId: 'court-1', startTime: mockSlot.startTime, endTime: mockSlot.endTime },
      'jwt-token',
    ));
    expect(await screen.findByText(/Créneau bloqué/)).toBeInTheDocument();
  });

  it('affiche un message d erreur si le hold échoue', async () => {
    (api.holdSlot as jest.Mock).mockRejectedValue(new Error('SLOT_ALREADY_HELD'));
    renderModal();
    expect(await screen.findByText(/vient d'être pris/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fermer/ })).toBeInTheDocument();
  });

  it('confirme (régler au club) → confirmReservation + onConfirmed', async () => {
    const onConfirmed = jest.fn();
    renderModal({ onConfirmed });
    fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', undefined));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
  });

  it('fermer annule le hold', async () => {
    const onClose = jest.fn();
    renderModal({ onClose });
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('button', { name: /Abandonner|Fermer|Annuler/ }));
    await waitFor(() => expect(api.cancelReservation).toHaveBeenCalledWith('res-1', 'jwt-token'));
    expect(onClose).toHaveBeenCalled();
  });

  it('affiche le bloc conditions d annulation (sans case)', async () => {
    renderModal({ cancellationCutoffHours: 24, refundOnCancelWithinCutoff: false });
    expect(await screen.findByText(/Conditions d'annulation/)).toBeInTheDocument();
    // NB : le libellé contient une apostrophe typographique (jusqu’à) → matcher sans l'apostrophe.
    expect(screen.getByText(/24\s*h avant le début/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd frontend && npx jest BookingModal.test`
Expected: FAIL (l'ancien composant attend un clic « Pré-réserver »).

- [ ] **Step 3 : Réécrire le composant**

Réécrire `frontend/components/BookingModal.tsx`. Conserver l'en-tête de props (interface `BookingModalProps`, lignes 24-61), `HOLD_SECONDS`, `formatHour`, `BOOKING_ERRORS` (y **ajouter** `RESERVATION_NOT_PENDING: 'La pré-réservation a expiré. Veuillez recommencer.'`). Supprimer `ProgressRing`. Ajouter `import { ACCENTS } from '@/lib/theme';` et `import { useRef } from 'react';`.

**3a — État & refs** (remplacer le bloc `useState` des phases) :

```tsx
  const [phase, setPhase]             = useState<'holding' | 'held' | 'error'>('holding');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const [errorMsg, setErrorMsg]       = useState('');
  const [busy, setBusy]               = useState(false); // confirm/applyHoldSetup en vol
  const didHold                       = useRef(false);   // garde anti double-hold (StrictMode)
  // … conserver les états existants : paySource, useSub, stripeStep, cgvAccepted,
  //   cgvStatus, fingerprintForced, payMode, partners, visibility, levelLimited,
  //   levelMin, levelMax. SUPPRIMER payAmount (online = part, voir 3f).
```

**3b — Hold au montage** (remplacer `handleHold` ; le hold initial ne porte PAS les partenaires) :

```tsx
  useEffect(() => {
    if (didHold.current) return;
    didHold.current = true;
    (async () => {
      try {
        const res = await api.holdSlot(
          { resourceId, startTime: slot.startTime, endTime: slot.endTime }, token,
        );
        setReservation(res);
        setSecondsLeft(HOLD_SECONDS);
        setPhase('held');
      } catch (err) {
        setErrorMsg(BOOKING_ERRORS[(err as Error).message] ?? (err as Error).message);
        setPhase('error');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

**3c — Timer** (l'effet tourne en phase `held`) :

```tsx
  useEffect(() => {
    if (phase !== 'held') return;
    if (secondsLeft <= 0) {
      setPhase('error');
      setErrorMsg('La pré-réservation a expiré. Veuillez recommencer.');
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft]);
  const urgent = secondsLeft <= 60;
```

**3d — Confirmation** (applique les joueurs AVANT confirm/stripe) :

```tsx
  const handleConfirm = async () => {
    if (!reservation || busy) return;
    setBusy(true);
    setErrorMsg('');
    try {
      // Terrain multi-joueurs : persiste partenaires/visibilité/niveau sur la PENDING
      // avant tout paiement (client OU webhook Stripe) → pas de course.
      if (showPartners) {
        const limiting = visibility === 'PUBLIC' && levelEnabled && levelLimited;
        await api.applyHoldSetup(reservation.id, token, {
          partnerUserIds: partners.map((p) => p.id),
          visibility,
          ...(visibility === 'PUBLIC' && levelEnabled
            ? { targetLevelMin: limiting ? levelMin : null, targetLevelMax: limiting ? levelMax : null }
            : {}),
        });
        saveLevelPref({ enabled: levelLimited, min: levelMin, max: levelMax });
      }
      if (cardIntentPath) { setStripeStep(true); return; }
      const paymentSource = useSub && cover ? { subscriptionId: cover.id }
        : paySource ? { packageId: paySource } : undefined;
      const confirmed = await api.confirmReservation(
        reservation.id, token, paymentSource ? { paymentSource } : undefined,
      );
      onConfirmed(confirmed);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'INSUFFICIENT_BALANCE') { setPaySource(null); setErrorMsg('Solde insuffisant — réglez au club.'); return; }
      if (msg === 'CARD_FINGERPRINT_REQUIRED') { setFingerprintForced(true); setPaySource(null); setErrorMsg(BOOKING_ERRORS.CARD_FINGERPRINT_REQUIRED); return; }
      if (BOOKING_ERRORS[msg] && msg !== 'SLOT_NO_LONGER_AVAILABLE') { setErrorMsg(BOOKING_ERRORS[msg]); return; }
      setPhase('error');
      setErrorMsg(msg === 'SLOT_NO_LONGER_AVAILABLE' ? 'Ce créneau a été pris entre-temps. Veuillez recommencer.' : (BOOKING_ERRORS[msg] ?? msg));
    } finally {
      setBusy(false);
    }
  };
```

> `setBusy(false)` dans `finally` : sur le chemin Stripe on `return` avant, mais `finally` s'exécute quand même — c'est voulu (le bouton se réactive, l'étape Stripe prend le relais).

**3e — Fermeture** (inchangée, garde `reservation`) :

```tsx
  const handleClose = async () => {
    if (reservation) { try { await api.cancelReservation(reservation.id, token); } catch { /* cleanup job */ } }
    onClose();
  };
```

**3f — Online = part (remplace `payAmount`)** : supprimer toute référence à `payAmount`/`onlineShare` basée sur le toggle. Calculer :

```tsx
  const onlineShare = !shareTooSmall;                       // en ligne : toujours la part (sauf trop faible)
  const onlineAmountLabel = onlineShare ? `${perPerson}€` : `${totalPrice}€`;
```

(`cardIntentPath`, `cover`, `capacity`, `shareCents`, `perPerson`, `shareTooSmall`, `perPlayer`, `durLabel` restent calculés comme avant.)

**3g — Rendu** : un seul retour, structure :

```tsx
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div onClick={handleClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '100dvh', overflowY: 'auto', background: th.bgElev, borderRadius: '0 0 28px 28px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)' }}>
        {/* Barre de timer fine (cachée en phase error) */}
        {phase !== 'error' && (
          <div style={{ height: 4, background: th.surface2 }}>
            <div style={{ height: '100%', width: `${(secondsLeft / HOLD_SECONDS) * 100}%`, background: urgent ? ACCENTS.coral : th.accent, transition: 'width 1s linear' }} />
          </div>
        )}
        <div style={{ padding: '14px 20px 32px' }}>

          {phase === 'error' ? (
            <>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.onAccent, background: th.accent, padding: '12px 14px', borderRadius: 12, fontWeight: 600 }}>{errorMsg}</div>
              <div style={{ marginTop: 14 }}><Btn full variant="surface" onClick={onClose}>Fermer</Btn></div>
            </>
          ) : (
            <>
              {/* En-tête : held badge + timer chip */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: phase === 'held' ? '#15803d' : th.textMute }}>
                  {phase === 'held'
                    ? <><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px #22c55e22' }} />Créneau bloqué pour vous</>
                    : 'Blocage du créneau…'}
                </span>
                <span style={{ fontFamily: th.fontMono, fontWeight: 700, fontSize: 13.5, color: urgent ? ACCENTS.coral : th.textMute }}>⏱ {mm}:{ss}</span>
              </div>

              {/* Header carte (Task 6 le peaufine — version minimale ici) */}
              <BookingHeaderCard slot={slot} timezone={timezone} resourceName={resourceName}
                format={format} totalPrice={totalPrice} perPerson={perPerson} capacity={capacity} durLabel={durLabel} th={th} />

              {/* Joueurs / visibilité / niveau — PORTER VERBATIM depuis l'ancien composant (lignes 350-415) */}
              {/* … bloc showPartners inchangé … */}

              {/* Paiement — PORTER les avenues abo/club/online/carnets (anciennes lignes 451-517),
                  EN APPLIQUANT le changement 3f : l'avenue « Payer en ligne » n'a plus le toggle
                  ma part/total ; elle affiche la PART (perPerson) et son sous-texte. */}

              {/* Quota (optionnel) : <QuotaStatus> si quotaStatus */}

              {/* CGV — PORTER le bloc cardIntentPath inchangé (anciennes lignes 521-538) */}

              {/* Conditions d'annulation — toujours affiché */}
              <CancellationNotice text={cancellationPolicyLabel(cancellationCutoffHours, refundOnCancelWithinCutoff ?? false)} th={th} />

              {errorMsg && (
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.onAccent, background: th.accent, padding: '8px 12px', borderRadius: 10, fontWeight: 600, marginTop: 14 }}>{errorMsg}</div>
              )}

              <div style={{ display: 'flex', gap: 11, marginTop: 18 }}>
                <Btn variant="surface" onClick={handleClose} style={{ flex: '0 0 38%' }}>Abandonner</Btn>
                <Btn icon="arrowR" onClick={handleConfirm}
                  disabled={phase !== 'held' || busy || (!paySource && payMode === 'online' && onlineRequiredButUnavailable) || (cardIntentPath && !cgvAccepted)}
                  style={{ flex: 1 }}>
                  {useSub ? 'Confirmer avec mon abonnement'
                    : paySource ? 'Confirmer avec mon solde'
                    : (payMode === 'online' && onlineAvailable) ? `Valider le paiement · ${onlineAmountLabel}`
                    : 'Confirmer la réservation'}
                </Btn>
              </div>

              {stripeStep && reservation && (
                <div style={{ marginTop: 20, padding: '16px 0 0', borderTop: `1px solid ${th.lineStrong}` }}>
                  <StripePaymentStep reservationId={reservation.id} slug={slug ?? ''} clubId={clubId ?? ''}
                    type={(payMode === 'online' && onlineAvailable) ? 'payment' : 'setup'}
                    payShare={(payMode === 'online' && onlineAvailable) ? onlineShare : false}
                    amountLabel={(payMode === 'online' && onlineAvailable) ? onlineAmountLabel : `${totalPrice}€`}
                    cgvAccepted={cgvAccepted} token={token}
                    onSuccess={() => { setStripeStep(false); onClose(); }}
                    onCancel={() => setStripeStep(false)} />
                </div>
              )}
            </>
          )}

          <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '18px auto 0' }} />
        </div>
      </div>
    </div>
  );
```

> `BookingHeaderCard` et `CancellationNotice` sont créés en Task 6 ; pour cette task, en placer une version minimale en haut du fichier (header = court + date + horaire + prix ; notice = icône + titre + texte) suffisant pour faire passer les tests `findByText(/Créneau bloqué/)`, `/Conditions d'annulation/`, `/jusqu'à 24 h/`, `/Confirmer la réservation/`. Les styles fins viennent en Task 6.

> Porter les blocs « joueurs/visibilité/niveau », « paiement » (abo/club/online/carnets) et « CGV » **depuis l'ancien composant** (le diff git montre les anciennes lignes). Seul l'online change (3f).

- [ ] **Step 4 : Vérifier le succès**

Run: `cd frontend && npx jest BookingModal.test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/BookingModal.tsx frontend/__tests__/BookingModal.test.tsx
git commit -m "feat(reserver): modale page unique, blocage au montage, online=part, bouton adaptatif"
```

---

## Task 5 : Frontend — timer (expiration) + part en ligne, tests dédiés

**Files:**
- Modify: `frontend/__tests__/BookingModal.payment.test.tsx` (ou créer `BookingModal.online.test.tsx` si le fichier paiement teste autre chose)
- Test cible : expiration du timer → écran d'erreur ; online affiche la part.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter (avec `jest.useFakeTimers()`), dans un fichier de test BookingModal :

```tsx
it('le timer expiré bascule en erreur', async () => {
  (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });
  jest.useFakeTimers();
  renderModal();
  await jest.advanceTimersByTimeAsync(0);        // laisse holdSlot résoudre → phase held + démarrage du timer
  await jest.advanceTimersByTimeAsync(301_000);  // épuise le compte à rebours
  expect(screen.getByText(/expiré/)).toBeInTheDocument();
  jest.useRealTimers();
});

it('payer en ligne affiche la part par personne et le bouton « Valider le paiement »', async () => {
  (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '30' });
  // court double padel = 4 joueurs → part = 30/4 = 7,50 €. Le prix vient de slot.price (priorité sur la prop).
  renderModal({ slot: { ...mockSlot, price: '30' }, slug: 'club-demo', maxPlayers: 4,
    format: 'double', sportKey: 'padel', price: '30', stripeActive: true });
  fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));
  expect(screen.getByRole('button', { name: /Valider le paiement.*7,50/ })).toBeInTheDocument();
});
```

> Adapter `renderModal`/mocks au fichier choisi (réutiliser le harnais de la Task 4 si besoin). `advanceTimersByTimeAsync` (Jest moderne) vide aussi les microtâches → la promesse de `holdSlot` se résout entre les ticks.

- [ ] **Step 2 : Vérifier (échec attendu si comportement absent, sinon PASS direct)**

Run: `cd frontend && npx jest BookingModal`
Expected: les nouveaux tests PASS si Task 4 est correcte (le timer et l'online=part y sont déjà). Sinon corriger Task 4.

- [ ] **Step 3 : Commit**

```bash
git add frontend/__tests__/
git commit -m "test(reserver): timer expiration + online=part"
```

---

## Task 6 : Frontend — header carte + bloc annulation (polish visuel)

Extraire/peaufiner les deux sous-composants visuels selon la maquette v4.

**Files:**
- Modify: `frontend/components/BookingModal.tsx` (sous-composants `BookingHeaderCard`, `CancellationNotice`)

- [ ] **Step 1 : Styler le header carte**

Remplacer la version minimale de `BookingHeaderCard` par (porter les valeurs depuis `modal-v4.html`, classe `.pv4-hero`) :

```tsx
function BookingHeaderCard({ slot, timezone, resourceName, format, totalPrice, perPerson, capacity, durLabel, th }: {
  slot: TimeSlot; timezone?: string; resourceName?: string; format?: string;
  totalPrice: string; perPerson: string; capacity: number; durLabel: string; th: ReturnType<typeof useTheme>['th'];
}) {
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(new Date(slot.startTime));
  return (
    <div style={{ marginTop: 14, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 18, padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
      <div>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 22, fontWeight: 700, letterSpacing: -0.4, color: th.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          {resourceName ?? 'Court'}
          <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: th.textMute, border: `1px solid ${th.lineStrong}`, background: th.bgElev, borderRadius: 999, padding: '2px 9px' }}>{courtFormat(format) ?? 'Double'}</span>
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text, marginTop: 8, textTransform: 'capitalize' }}>{dateLabel}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {formatHour(slot.startTime, timezone)} → {formatHour(slot.endTime, timezone)} · {durLabel}
          {slot.offPeak && <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: '#b45309', background: '#fde9c8', borderRadius: 5, padding: '2px 7px' }}>heures creuses</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 34, fontWeight: 800, letterSpacing: -1.3, color: th.text, lineHeight: 0.95 }}>{totalPrice}€</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 5 }}>≈ {perPerson} € / pers · {capacity} j.</div>
      </div>
    </div>
  );
}
```

> Dans le rendu (Task 4, 3g), l'appel devient `<BookingHeaderCard … durLabel={durLabel} th={th} />`.

- [ ] **Step 2 : Styler le bloc annulation**

```tsx
function CancellationNotice({ text, th }: { text: string; th: ReturnType<typeof useTheme>['th'] }) {
  return (
    <div style={{ marginTop: 18, background: th.surface, border: `1px solid ${th.line}`, borderRadius: 14, padding: '13px 15px', display: 'flex', gap: 11 }}>
      <span style={{ width: 30, height: 30, flex: '0 0 auto', borderRadius: 9, background: '#fff1e9', color: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>↺</span>
      <div>
        <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text, marginBottom: 3 }}>Conditions d'annulation</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.5 }}>{text}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3 : Vérifier (tests + rendu)**

Run: `cd frontend && npx jest BookingModal`
Expected: PASS (les `findByText` du header/annulation tiennent toujours).

- [ ] **Step 4 : Commit**

```bash
git add frontend/components/BookingModal.tsx
git commit -m "style(reserver): header carte + bloc annulation (maquette v4)"
```

---

## Task 7 : Frontend — mettre à jour les suites de tests restantes

Les 3 autres suites supposent l'ancien flux (clic « Pré-réserver » → phase pending). Les adapter au flux page-unique (hold au montage, bouton final direct).

**Files:**
- Modify: `frontend/__tests__/BookingModal.packages.test.tsx`
- Modify: `frontend/__tests__/BookingModal.payment.test.tsx`
- Modify: `frontend/__tests__/BookingModal.subscription.test.tsx`

- [ ] **Step 1 : Lire et adapter chaque suite**

Pour chacune : (a) ajouter `applyHoldSetup: jest.fn().mockResolvedValue(...)` et `getClubPage` au mock `lib/api` ; (b) faire que `holdSlot` résout par défaut en `beforeEach` ; (c) **supprimer** les `fireEvent.click(... /Pré-réserver/)` (le hold est automatique) et remplacer l'attente `/Confirmez dans/` par `await screen.findByText(/Créneau bloqué/)` ; (d) remplacer le libellé du bouton final `/Confirmer et payer/` → `/Confirmer la réservation/`, et tout assert sur le toggle « ma part/total » supprimé par un assert sur le libellé `Valider le paiement · …`.

- [ ] **Step 2 : Lancer toutes les suites BookingModal**

Run: `cd frontend && npx jest BookingModal`
Expected: PASS (4 fichiers).

- [ ] **Step 3 : Commit**

```bash
git add frontend/__tests__/BookingModal.packages.test.tsx frontend/__tests__/BookingModal.payment.test.tsx frontend/__tests__/BookingModal.subscription.test.tsx
git commit -m "test(reserver): adapter packages/payment/subscription au flux page unique"
```

---

## Task 8 : Vérification complète + documentation

**Files:**
- Modify: `CLAUDE.md` (section « Réserver »)

- [ ] **Step 1 : Suites complètes**

Run: `cd frontend && npm test` puis `cd backend && npm test`
Expected: vert des deux côtés.

- [ ] **Step 2 : Vérif manuelle (selon /run ou démarrage manuel)**

Démarrer back+front, ouvrir un créneau sur `/reserver` : la modale doit bloquer immédiatement (badge + timer), tout tient sur une page, le bouton final solde la réservation. Tester : créneau déjà pris → message + Fermer ; partie ouverte + partenaire → confirme et le partenaire apparaît ; paiement en ligne (club Stripe actif) → montant = part. Vérifier l'absence de double-hold (un seul `holdSlot` au montage).

- [ ] **Step 3 : Documenter dans CLAUDE.md**

Ajouter sous la section « Réserver » une évolution datée 2026-06-24 décrivant : modale page unique, blocage au montage (`holdSlot` au mount, garde `didHold`), `applyHoldSetup` (endpoint dédié appliqué avant confirm/Stripe, pas de course webhook), online=part (`capacityFor`), bloc conditions d'annulation (`cancellationPolicyLabel`), timer barre+chip coral, bouton adaptatif. Citer la spec/plan.

- [ ] **Step 4 : Commit**

```bash
git add CLAUDE.md
git commit -m "docs: modale Réserver page unique (CLAUDE.md)"
```

---

## Notes de cohérence

- **Pas de double-hold** : garde `didHold` (ref) obligatoire — l'effet de montage peut tourner deux fois (StrictMode dev).
- **`confirmReservation(id, token, undefined)`** quand on règle au club (pas de `paymentSource`) — c'est ce qu'attend le test Task 4.
- **`applyHoldSetup` n'est appelé que si `showPartners`** (terrain multi-joueurs) ; jamais sur terrain simple.
- **Le webhook Stripe et `confirmReservation` ne changent pas** : les joueurs sont déjà persistés avant le paiement.
- **Noms cohérents** : service `applyHoldSetup` ↔ route `POST /:id/setup` ↔ front `api.applyHoldSetup`.
- **`payAmount` supprimé partout** (état, JSX online, props StripePaymentStep) ; online = `perPerson` sauf `shareTooSmall`.
