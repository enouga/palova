import { clubIsMultiSport, setSpansMultipleSports, sportNames } from '@/lib/sportBadge';

describe('sportBadge', () => {
  it('clubIsMultiSport : ≥2 sports => true', () => {
    expect(clubIsMultiSport(null)).toBe(false);
    expect(clubIsMultiSport(undefined)).toBe(false);
    expect(clubIsMultiSport({})).toBe(false); // clubSports absent → pas de crash
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

  it('sportNames : résout les clés via clubSports, repli sur la clé brute', () => {
    const club = { clubSports: [{ sport: { key: 'padel', name: 'Padel' } }, { sport: { key: 'tennis', name: 'Tennis' } }] };
    expect(sportNames(club, ['padel', 'tennis'])).toEqual(['Padel', 'Tennis']);
    expect(sportNames(club, ['squash'])).toEqual(['squash']); // clé inconnue → repli brut
    expect(sportNames(null, ['padel'])).toEqual(['padel']);
    expect(sportNames({}, ['padel'])).toEqual(['padel']); // clubSports absent → pas de crash
    expect(sportNames(club, [])).toEqual([]);
  });
});
