import { applySlotEvent, type SlotStreamEvent } from '@/lib/reserveLive';
import type { ClubAvailability } from '@/lib/api';

const slot = (start: string, end: string, available = true) => ({
  startTime: start, endTime: end, available, price: '25.00', offPeak: false,
});
const avail = (): Record<string, ClubAvailability[]> => ({
  'cs-padel': [
    {
      resource: { id: 'r1', name: 'Padel 1' } as any,
      slots: [
        slot('2026-07-19T06:00:00.000Z', '2026-07-19T07:00:00.000Z'),
        slot('2026-07-19T07:00:00.000Z', '2026-07-19T08:00:00.000Z'),
      ],
    },
    {
      resource: { id: 'r2', name: 'Padel 2' } as any,
      slots: [slot('2026-07-19T06:00:00.000Z', '2026-07-19T07:00:00.000Z')],
    },
  ],
});
const ev = (type: SlotStreamEvent['type'], over: Partial<SlotStreamEvent> = {}): SlotStreamEvent => ({
  type, resourceId: 'r1',
  startTime: '2026-07-19T06:00:00.000Z', endTime: '2026-07-19T07:00:00.000Z',
  ...over,
});

describe('applySlotEvent', () => {
  it('slot_held grise le créneau chevauchant du bon terrain, pas les autres', () => {
    const out = applySlotEvent(avail(), ev('slot_held'));
    expect(out.changed).toBe(true);
    expect(out.needsRefetch).toBe(false);
    expect(out.next['cs-padel'][0].slots[0].available).toBe(false); // r1 6h → pris
    expect(out.next['cs-padel'][0].slots[1].available).toBe(true);  // r1 7h intact
    expect(out.next['cs-padel'][1].slots[0].available).toBe(true);  // r2 intact
  });

  it('une résa de 1h30 grise les DEUX créneaux 1h qu\'elle chevauche', () => {
    const out = applySlotEvent(avail(), ev('slot_confirmed', {
      startTime: '2026-07-19T06:30:00.000Z', endTime: '2026-07-19T08:00:00.000Z',
    }));
    expect(out.next['cs-padel'][0].slots[0].available).toBe(false);
    expect(out.next['cs-padel'][0].slots[1].available).toBe(false);
  });

  it('slot_released ne patche PAS mais demande un refetch (créneau peut rester couvert par une autre résa)', () => {
    const base = avail();
    base['cs-padel'][0].slots[0].available = false;
    const out = applySlotEvent(base, ev('slot_released'));
    expect(out.changed).toBe(false);
    expect(out.needsRefetch).toBe(true);
    expect(out.next['cs-padel'][0].slots[0].available).toBe(false); // inchangé
  });

  it('un événement qui ne touche aucun créneau chargé (autre jour/terrain inconnu) est un no-op strict', () => {
    const src = avail();
    const outDay = applySlotEvent(src, ev('slot_released', {
      startTime: '2026-07-20T06:00:00.000Z', endTime: '2026-07-20T07:00:00.000Z',
    }));
    expect(outDay.needsRefetch).toBe(false);
    expect(outDay.next).toBe(src); // même référence : pas de re-render

    const outRes = applySlotEvent(src, ev('slot_held', { resourceId: 'r-inconnu' }));
    expect(outRes.changed).toBe(false);
    expect(outRes.next).toBe(src);
  });

  it('held sur un créneau déjà pris : no-op strict (même référence)', () => {
    const base = avail();
    base['cs-padel'][0].slots[0].available = false;
    const out = applySlotEvent(base, ev('slot_held'));
    expect(out.changed).toBe(false);
    expect(out.next).toBe(base);
  });

  it('connected / événement sans horaires : no-op', () => {
    const src = avail();
    const out = applySlotEvent(src, { type: 'connected', resourceId: '' });
    expect(out.next).toBe(src);
    expect(out.needsRefetch).toBe(false);
  });
});
