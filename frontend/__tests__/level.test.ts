import { sportHasLevels } from '../lib/level';

describe('sportHasLevels', () => {
  it('padel → true', () => expect(sportHasLevels('padel')).toBe(true));
  it('tennis → false', () => expect(sportHasLevels('tennis')).toBe(false));
  it('undefined → false', () => expect(sportHasLevels(undefined)).toBe(false));
  it('null → false', () => expect(sportHasLevels(null)).toBe(false));
});
