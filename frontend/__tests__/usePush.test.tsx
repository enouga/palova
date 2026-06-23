import { renderHook } from '@testing-library/react';
import { usePush } from '@/lib/usePush';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: null, ready: true }) }));

// jsdom doesn't have serviceWorker or PushManager → status should be 'unsupported'
describe('usePush', () => {
  it('returns unsupported in jsdom (no serviceWorker)', () => {
    const { result } = renderHook(() => usePush());
    expect(result.current.status).toBe('unsupported');
  });
});
