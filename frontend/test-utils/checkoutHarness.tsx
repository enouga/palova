import { render } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import ConfirmerReservationPage from '../app/reserver/confirmer/page';

/**
 * Harnais partagé des suites Checkout.*.test.tsx (page /reserver/confirmer, remplace
 * l'ancien BookingModal monté via props). Chaque suite garde ses PROPRES `jest.mock(...)`
 * (obligatoire — le hoisting de babel-plugin-jest-hoist est scopé au fichier de test), mais
 * réutilise ces fixtures + le rendu de la page pour éviter la duplication.
 *
 * Vit HORS de `__tests__/` (dans `test-utils/`) : le testMatch par défaut de Jest traite
 * TOUT fichier `.tsx` sous `__tests__/**` comme une suite — un helper sans `it()` y ferait
 * échouer « must contain at least one test ».
 *
 * Contrat de query (mêmes clés que `ClubReserve.checkoutQuery` — voir components/ClubReserve.tsx) :
 * resource/start/duration/price/offpeak (obligatoires) + sport/format/name (facultatifs).
 */
export function renderCheckout() {
  return render(
    <ThemeProvider>
      <ConfirmerReservationPage />
    </ThemeProvider>,
  );
}

/** Query par défaut — créneau court-1, 15/06/2025 06:00–07:00 UTC, 25 €, heures pleines. */
export function buildQuery(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    resource: 'court-1',
    start: '2025-06-15T06:00:00.000Z',
    duration: '60',
    price: '25',
    offpeak: '0',
    ...overrides,
  });
}

/**
 * Club minimal — uniquement les champs lus par `ConfirmerPageInner`/`CheckoutView`
 * (timezone/id/requireOnlinePayment/requireCardFingerprint/stripeAccountStatus/
 * cancellationCutoffHours/refundOnCancelWithinCutoff) + `levelSystemEnabled` (lu par
 * `useLevelSystemEnabled` via `useClub()`). Le mock de `useClub()` n'est pas type-checké
 * contre le vrai `ClubContextValue` (comme dans MeProfile.test.tsx) — pas besoin du
 * `ClubDetail` complet.
 */
export interface MockClub {
  id: string;
  timezone: string;
  requireOnlinePayment: boolean;
  requireCardFingerprint: boolean;
  stripeAccountStatus: string;
  cancellationCutoffHours: number;
  refundOnCancelWithinCutoff: boolean;
  levelSystemEnabled?: boolean;
}

export function buildClub(overrides: Partial<MockClub> = {}): MockClub {
  return {
    id: 'club-1',
    timezone: 'Europe/Paris',
    requireOnlinePayment: false,
    requireCardFingerprint: false,
    stripeAccountStatus: 'INACTIVE',
    cancellationCutoffHours: 24,
    refundOnCancelWithinCutoff: false,
    levelSystemEnabled: true,
    ...overrides,
  };
}

/** Réponse standard de `holdSlot` — `createdAt` est OBLIGATOIRE (le hook calcule le temps
 * restant à partir de cette date ; un `createdAt` manquant produit un timer `NaN:NaN`). */
export function heldReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    status: 'PENDING',
    totalPrice: '25',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
