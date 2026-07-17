import { nextPresence, presenceGlyph, isReplaceableSlot, benchSelectionNext, MARK_TABLE_ERRORS, markTableErrorLabel } from '@/lib/markTable';

describe('markTable helpers', () => {
  it('nextPresence cycle ○→✅→✕→○', () => {
    expect(nextPresence('UNSEEN')).toBe('PRESENT');
    expect(nextPresence('PRESENT')).toBe('ABSENT');
    expect(nextPresence('ABSENT')).toBe('UNSEEN');
  });

  it('presenceGlyph', () => {
    expect(presenceGlyph('UNSEEN')).toBe('○');
    expect(presenceGlyph('PRESENT')).toBe('✅');
    expect(presenceGlyph('ABSENT')).toBe('✕');
  });

  it('isReplaceableSlot : seul ABSENT est une cible', () => {
    expect(isReplaceableSlot('ABSENT')).toBe(true);
    expect(isReplaceableSlot('PRESENT')).toBe(false);
    expect(isReplaceableSlot('UNSEEN')).toBe(false);
  });

  it('benchSelectionNext : 0→1→2, re-tap déselectionne, 3e tap ignoré', () => {
    expect(benchSelectionNext([], 'a')).toEqual(['a']);
    expect(benchSelectionNext(['a'], 'b')).toEqual(['a', 'b']);
    expect(benchSelectionNext(['a'], 'a')).toEqual([]);
    expect(benchSelectionNext(['a', 'b'], 'c')).toEqual(['a', 'b']); // 2 déjà sélectionnés : ignoré
    expect(benchSelectionNext(['a', 'b'], 'a')).toEqual(['b']); // déselectionner l'un des deux reste possible
  });

  it('markTableErrorLabel : mappe un code connu, sinon renvoie le message brut', () => {
    expect(markTableErrorLabel(new Error('ALREADY_ON_BENCH'))).toBe(MARK_TABLE_ERRORS.ALREADY_ON_BENCH);
    expect(markTableErrorLabel(new Error('PARTNER_IS_SELF'))).toBe(MARK_TABLE_ERRORS.PARTNER_IS_SELF);
    expect(markTableErrorLabel(new Error('UNKNOWN_CODE'))).toBe('UNKNOWN_CODE');
  });
});
