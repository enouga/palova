import { renderHook } from '@testing-library/react';
import { useLevelSystemEnabled } from '../lib/useLevelSystem';

const clubVal: { club: { levelSystemEnabled?: boolean } | null } = { club: null };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubVal }));

it('true quand club null (rétrocompat)', () => {
  clubVal.club = null;
  expect(renderHook(() => useLevelSystemEnabled()).result.current).toBe(true);
});
it('true quand activé', () => {
  clubVal.club = { levelSystemEnabled: true };
  expect(renderHook(() => useLevelSystemEnabled()).result.current).toBe(true);
});
it('false quand désactivé', () => {
  clubVal.club = { levelSystemEnabled: false };
  expect(renderHook(() => useLevelSystemEnabled()).result.current).toBe(false);
});
