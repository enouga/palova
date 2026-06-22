import { capacityFor } from '../courtType';

describe('capacityFor', () => {
  it('padel → 4', () => expect(capacityFor('padel')).toBe(4));
  it('padel single → 2', () => expect(capacityFor('padel', 'single')).toBe(2));
  it('tennis → 2', () => expect(capacityFor('tennis')).toBe(2));
  it('squash → 2', () => expect(capacityFor('squash')).toBe(2));
  it('pickleball → 4', () => expect(capacityFor('pickleball')).toBe(4));
  it('pickleball single → 2', () => expect(capacityFor('pickleball', 'single')).toBe(2));
  it('sport inconnu → 4', () => expect(capacityFor('badminton')).toBe(4));
  it('sport inconnu single → 2', () => expect(capacityFor('badminton', 'single')).toBe(2));
  it('sport undefined (sans format) → 4', () => expect(capacityFor(undefined)).toBe(4));
});
