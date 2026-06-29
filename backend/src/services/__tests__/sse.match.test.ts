import { SSEService } from '../sse.service';

// Faux Response Express minimal pour SSE (capture les writes + le handler 'close').
function fakeRes() {
  const writes: string[] = [];
  let closeHandler: (() => void) | null = null;
  return {
    setHeader() {}, flushHeaders() {},
    write(s: string) { writes.push(s); return true; },
    on(event: string, cb: () => void) { if (event === 'close') closeHandler = cb; },
    writes,
    close() { closeHandler?.(); },
  };
}

describe('SSEService — canal par partie (match)', () => {
  const sse = SSEService.getInstance();

  it('suit les userId connectés et les retire à la fermeture', () => {
    const a = fakeRes();
    const b = fakeRes();
    sse.addMatchClient('resa1', 'userA', a as never);
    sse.addMatchClient('resa1', 'userB', b as never);

    expect(sse.getMatchUserIds('resa1')).toEqual(new Set(['userA', 'userB']));

    a.close();
    expect(sse.getMatchUserIds('resa1')).toEqual(new Set(['userB']));

    b.close();
    expect(sse.getMatchUserIds('resa1')).toEqual(new Set());
  });

  it('broadcastMatch écrit le payload SSE à tous les clients de la partie', () => {
    const a = fakeRes();
    sse.addMatchClient('resa2', 'userA', a as never);
    a.writes.length = 0; // ignore le message 'connected'

    sse.broadcastMatch('resa2', { type: 'chat_message', message: { id: 'm1' } });

    expect(a.writes.join('')).toContain('"type":"chat_message"');
    expect(a.writes.join('')).toContain('"id":"m1"');
  });
});
