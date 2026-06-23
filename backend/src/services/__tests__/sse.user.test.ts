import { SSEService } from '../sse.service';

function fakeRes() {
  const handlers: Record<string, () => void> = {};
  return {
    setHeader: jest.fn(), flushHeaders: jest.fn(),
    write: jest.fn(), end: jest.fn(),
    on: (ev: string, cb: () => void) => { handlers[ev] = cb; },
    _close: () => handlers['close']?.(),
  } as any;
}

describe('SSEService canal utilisateur', () => {
  it('notifyUser écrit le payload aux clients de cet utilisateur', () => {
    const svc = SSEService.getInstance();
    const res = fakeRes();
    svc.addUserClient('user-1', res);
    res.write.mockClear();
    svc.notifyUser('user-1', { type: 'notification' });
    expect(res.write).toHaveBeenCalledWith('data: {"type":"notification"}\n\n');
  });

  it('notifyUser ne fait rien pour un utilisateur sans client', () => {
    expect(() => SSEService.getInstance().notifyUser('inconnu', { type: 'x' })).not.toThrow();
  });

  it('la fermeture retire le client', () => {
    const svc = SSEService.getInstance();
    const res = fakeRes();
    svc.addUserClient('user-2', res);
    expect(svc.getUserClientCount('user-2')).toBe(1);
    res._close();
    expect(svc.getUserClientCount('user-2')).toBe(0);
  });
});
