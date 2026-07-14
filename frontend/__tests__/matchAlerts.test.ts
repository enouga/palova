import { slotToAlertWindow, alertChipLabel } from '@/lib/matchAlerts';

describe('slotToAlertWindow — fenêtre ±1h autour d\'un créneau (fuseau du club)', () => {
  const tz = 'Europe/Paris'; // été = UTC+2

  it('élargit d\'1h de chaque côté et rend date + HH:MM locaux', () => {
    // créneau 18:30→20:00 local = 16:30Z→18:00Z ; ±1h = 17:30→21:00 local
    const w = slotToAlertWindow('2026-07-16T16:30:00.000Z', '2026-07-16T18:00:00.000Z', tz);
    expect(w).toEqual({ date: '2026-07-16', from: '17:30', to: '21:00' });
  });

  it('borne early : un créneau 08:00 local reste le même jour à 07:00', () => {
    // 08:00 local = 06:00Z ; -1h = 07:00 local
    const w = slotToAlertWindow('2026-07-16T06:00:00.000Z', '2026-07-16T07:00:00.000Z', tz);
    expect(w.from).toBe('07:00');
    expect(w.date).toBe('2026-07-16');
  });
});

describe('alertChipLabel', () => {
  it('rend « jeu. 16 juil. · 18h30 → 20h00 »', () => {
    const label = alertChipLabel({ id: 'a', windowStart: '2026-07-16T16:30:00.000Z', windowEnd: '2026-07-16T18:00:00.000Z', targetLevelMin: null, targetLevelMax: null }, 'Europe/Paris');
    expect(label).toContain('18h30');
    expect(label).toContain('20h00');
    expect(label).not.toContain('Niv.');
  });

  it('ajoute la fourchette de niveau quand elle est posée', () => {
    const label = alertChipLabel({ id: 'a', windowStart: '2026-07-16T16:30:00.000Z', windowEnd: '2026-07-16T18:00:00.000Z', targetLevelMin: 3, targetLevelMax: 6 }, 'Europe/Paris');
    expect(label).toContain('Niv.');
    expect(label).toContain('3');
    expect(label).toContain('6');
  });
});
