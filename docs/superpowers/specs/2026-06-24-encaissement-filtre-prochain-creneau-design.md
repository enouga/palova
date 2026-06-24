# Encaissement — filtre « Prochain créneau » (design)

> Date : 2026-06-24 · Statut : validé · Périmètre : frontend uniquement (aucune migration, aucun changement backend)

## Problème

Au comptoir, le ou la gérante encaisse les joueurs **au moment où ils arrivent** pour leur créneau.
La page `/admin/reservations` (« Encaissement ») propose aujourd'hui un sélecteur de période
`[ À venir | Tout le jour ]` :

- **À venir** = `isUpcoming` = `endTime ≥ now` → garde tout le reste de la journée (peut être très long).
- **Tout le jour** = aucune restriction d'heure.

Ce qui manque : une vue **resserrée sur la vague de joueurs en cours / imminente**, avec une
**marge de 20 min en arrière** pour que les joueurs **en retard** (créneau déjà commencé) restent
visibles et encaissables.

## Comportement retenu — « Prochain départ (auto) »

Un nouveau mode **« Prochain créneau »** restreint la liste à une fenêtre horaire bornée par les
**heures de début** (`startTime`) des réservations :

- **Borne basse** = `now − 20 min` (marge retard, en dur).
- **Borne haute `T`** = le **prochain horaire de départ réel** = le plus petit `startTime ≥ now`
  parmi les réservations **actives (non annulées)** du jour chargé. S'il n'existe aucune réservation
  future, `T = now`.
- Une réservation **passe** ssi `startTime ∈ [now − 20 min, T]`.

Conséquence : la vue montre exactement **les retardataires** (créneau commencé il y a ≤ 20 min)
**+ la prochaine vague** qui démarre (à `T`). La fenêtre **roule automatiquement** au fil de la
journée, sans horizon arbitraire.

### Cas limites & caractéristiques assumées

- **Avant hydratation** (`nowMs === null`, l'horloge client n'est pas encore posée) → **tout passe**,
  comme `isUpcoming`. Pas de masquage avant que l'heure soit connue.
- **Prochain départ strict** : c'est le départ **le plus proche**, pas une fenêtre large de 30/60 min
  (options écartées en brainstorming). Si deux terrains démarrent à quelques minutes d'écart, seule la
  réservation au tout prochain `startTime` (et les retardataires) s'affiche. Choix délibéré, faisable
  à élargir plus tard si besoin.
- **Jour ≠ aujourd'hui** : la fenêtre se calcule toujours sur `now` et sur les réservations du jour
  chargé → un **jour passé** sera vide, un **jour futur** affichera sa **1ʳᵉ vague**. L'usage réel
  visé est « aujourd'hui, au comptoir » ; ce comportement de bord est accepté et documenté.
- La marge de **20 min** et le **défaut `À venir`** restent **en dur** (pas de configuration club).

## Conception

### Helpers purs — `frontend/lib/collect.ts`

À ajouter à côté de `isUpcoming` (mêmes conventions : montants/temps en ms epoch, `null` = pas de masquage) :

```ts
/**
 * Fenêtre « prochain créneau » en ms epoch : [now − graceMin, T].
 * T = plus petit start ≥ now parmi `starts` (prochain départ), sinon now.
 */
export function nextSlotWindow(starts: number[], nowMs: number, graceMin = 20): [number, number] {
  const low = nowMs - graceMin * 60_000;
  const future = starts.filter((s) => s >= nowMs);
  const high = future.length ? Math.min(...future) : nowMs;
  return [low, high];
}

/** La résa démarre-t-elle dans la fenêtre [low, high] ? `window = null` → true (pré-hydratation). */
export function isNextSlot(rv: { startTime: string }, window: [number, number] | null): boolean {
  if (!window) return true;
  const t = new Date(rv.startTime).getTime();
  return t >= window[0] && t <= window[1];
}
```

Les helpers dormants `presetWindow` / `statusFilter` / `hasAnyMethod` / `overlapsHourWindow` ne sont
**pas** touchés.

### État de la page — `frontend/app/admin/reservations/page.tsx`

- Remplacer `const [upcoming, setUpcoming] = useState(true)` par
  `const [period, setPeriod] = useState<PeriodMode>('upcoming')` avec
  `type PeriodMode = 'next' | 'upcoming' | 'all'` (export depuis `collect.ts` ou local).
- Calculer la fenêtre une fois par render :
  ```ts
  const dayStarts = dayResas.filter((r) => r.status !== 'CANCELLED').map((r) => new Date(r.startTime).getTime());
  const nextWindow = nowMs === null ? null : nextSlotWindow(dayStarts, nowMs);
  ```
- `passWindow(r)` :
  ```ts
  period === 'all'   ? true
  : period === 'next' ? isNextSlot(r, nextWindow)
  :                     isUpcoming(r, nowMs);   // 'upcoming'
  ```
- `activeCount` : remplacer `(!upcoming ? 1 : 0)` par `(period !== 'upcoming' ? 1 : 0)`.
- `resetFilters` : `setPeriod('upcoming')`.

### UI — `frontend/components/admin/ReservationFilters.tsx`

- Props : remplacer `upcoming: boolean; onUpcoming: (v) => void` par
  `period: PeriodMode; onPeriod: (p: PeriodMode) => void`.
- Rendre **3 radios** dans le `role="radiogroup"` existant :
  `[ Prochain créneau | À venir | Tout le jour ]`, chacun `role="radio"` avec `aria-checked`.
  « À venir » coché par défaut. Style `segBtn` réutilisé tel quel.

## Tests

- **`frontend/__tests__/collect.test.ts`** (helpers purs, `now` explicite) :
  - `nextSlotWindow` : prochain départ choisi parmi plusieurs starts ; marge `now − 20 min` ;
    aucun futur → `high = now` ; `graceMin` par défaut = 20.
  - `isNextSlot` : start dans la fenêtre → true ; avant `low` ou après `high` → false ;
    `window = null` → true.
- **`frontend/__tests__/AdminReservations.test.tsx`** :
  - Adapter le test radio existant au renommage `upcoming → period` (labels « À venir » / « Tout le jour » inchangés).
  - Nouveau test, `Date.now` figé (`jest.spyOn(Date, 'now')`) : en mode « Prochain créneau »,
    la prochaine vague + un retardataire ≤ 20 min restent visibles ; un créneau plus tardif est masqué.

## Hors périmètre

- Aucun changement backend, aucune migration.
- Marge configurable par club, fenêtre « large » (30/60 min), persistance du mode choisi.
