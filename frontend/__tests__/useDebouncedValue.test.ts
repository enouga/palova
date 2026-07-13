import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from '../lib/useDebouncedValue';

afterEach(() => { jest.useRealTimers(); });

it('renvoie la valeur initiale immédiatement', () => {
  const { result } = renderHook(() => useDebouncedValue('a', 200));
  expect(result.current).toBe('a');
});

it("n'expose la nouvelle valeur qu'après le délai", () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), { initialProps: { v: 'a' } });
  rerender({ v: 'ab' });
  expect(result.current).toBe('a');
  act(() => { jest.advanceTimersByTime(199); });
  expect(result.current).toBe('a');
  act(() => { jest.advanceTimersByTime(1); });
  expect(result.current).toBe('ab');
});

it('rafale de changements : seule la dernière valeur survit', () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), { initialProps: { v: 'a' } });
  rerender({ v: 'ab' });
  act(() => { jest.advanceTimersByTime(100); });
  rerender({ v: 'abc' });
  act(() => { jest.advanceTimersByTime(199); });
  expect(result.current).toBe('a');
  act(() => { jest.advanceTimersByTime(1); });
  expect(result.current).toBe('abc');
});
