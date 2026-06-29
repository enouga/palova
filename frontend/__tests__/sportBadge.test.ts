import { clubIsMultiSport, setSpansMultipleSports } from '@/lib/sportBadge';

describe('sportBadge', () => {
  it('clubIsMultiSport : ≥2 sports => true', () => {
    expect(clubIsMultiSport(null)).toBe(false);
    expect(clubIsMultiSport(undefined)).toBe(false);
    expect(clubIsMultiSport({ clubSports: [] })).toBe(false);
    expect(clubIsMultiSport({ clubSports: [{ id: 'a' }] })).toBe(false);
    expect(clubIsMultiSport({ clubSports: [{ id: 'a' }, { id: 'b' }] })).toBe(true);
  });

  it('setSpansMultipleSports : ≥2 clés distinctes non nulles => true', () => {
    expect(setSpansMultipleSports([])).toBe(false);
    expect(setSpansMultipleSports(['padel', 'padel'])).toBe(false);
    expect(setSpansMultipleSports(['padel', null, undefined])).toBe(false);
    expect(setSpansMultipleSports(['padel', 'tennis'])).toBe(true);
    expect(setSpansMultipleSports(['padel', null, 'tennis'])).toBe(true);
  });
});
