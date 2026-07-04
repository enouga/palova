import { renderHook, act } from '@testing-library/react';
import { usePush } from '@/lib/usePush';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('@/lib/api', () => ({
  api: {
    getVapidPublicKey: jest.fn(),
    savePushSubscription: jest.fn(),
    deletePushSubscription: jest.fn(),
  },
}));

// jsdom doesn't have serviceWorker or PushManager → status should be 'unsupported'
describe('usePush', () => {
  it('returns unsupported in jsdom (no serviceWorker)', () => {
    const { result } = renderHook(() => usePush());
    expect(result.current.status).toBe('unsupported');
  });
});

describe('usePush — subscribe diagnostics', () => {
  const FAKE_KEY = 'B'.repeat(87);
  let registerMock: jest.Mock;
  let subscribeMock: jest.Mock;
  let readyReg: { pushManager: { subscribe: jest.Mock } };

  beforeEach(() => {
    jest.clearAllMocks();
    subscribeMock = jest.fn();
    readyReg = { pushManager: { subscribe: subscribeMock } };
    registerMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: registerMock, ready: Promise.resolve(readyReg) },
    });
    (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
    (global as unknown as { Notification: unknown }).Notification = {
      permission: 'default',
      requestPermission: jest.fn().mockResolvedValue('granted'),
    };
  });

  afterEach(() => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    delete (global as unknown as { Notification?: unknown }).Notification;
  });

  it('logs a diagnostic and stays actionable when the server has no VAPID key configured', async () => {
    const { api } = jest.requireMock('@/lib/api');
    api.getVapidPublicKey.mockResolvedValue({ publicKey: null });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => usePush());
    await act(async () => { await result.current.subscribe(); });

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('logs the real error when pushManager.subscribe rejects (e.g. stale VAPID key from a previous subscription)', async () => {
    const { api } = jest.requireMock('@/lib/api');
    api.getVapidPublicKey.mockResolvedValue({ publicKey: FAKE_KEY });
    subscribeMock.mockRejectedValue(new Error('InvalidStateError: applicationServerKey mismatch'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => usePush());
    await act(async () => { await result.current.subscribe(); });

    expect(result.current.status).toBe('default');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('subscribe'), expect.anything());
    errSpy.mockRestore();
  });

  it('subscribes successfully and persists the subscription', async () => {
    const { api } = jest.requireMock('@/lib/api');
    api.getVapidPublicKey.mockResolvedValue({ publicKey: FAKE_KEY });
    subscribeMock.mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/ep', keys: { p256dh: 'p', auth: 'a' } }),
    });
    api.savePushSubscription.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => usePush());
    await act(async () => { await result.current.subscribe(); });

    expect(api.savePushSubscription).toHaveBeenCalledWith(
      { endpoint: 'https://push.example/ep', keys: { p256dh: 'p', auth: 'a' } },
      'tok',
    );
    expect(result.current.status).toBe('granted');
  });
});
