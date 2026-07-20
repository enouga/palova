import { SSEService } from '../sse.service';
import type { Response } from 'express';

// Fausse Response Express : on capture les writes et le handler 'close'.
function fakeRes() {
  const listeners: Record<string, () => void> = {};
  const res = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    on: jest.fn((ev: string, cb: () => void) => { listeners[ev] = cb; }),
  } as unknown as Response;
  return { res, close: () => listeners['close']?.() };
}

describe('SSEService — canal disponibilités club', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('addClubClient pose les headers SSE et envoie l\'événement connected', () => {
    const { res, close } = fakeRes();
    SSEService.getInstance().addClubClient('club-t1', res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.flushHeaders).toHaveBeenCalled();
    expect((res.write as jest.Mock).mock.calls[0][0]).toContain('"type":"connected"');
    close();
  });

  it('broadcastClub écrit le payload à tous les clients du club, pas aux autres clubs', () => {
    const a = fakeRes(); const b = fakeRes(); const other = fakeRes();
    const sse = SSEService.getInstance();
    sse.addClubClient('club-t2', a.res);
    sse.addClubClient('club-t2', b.res);
    sse.addClubClient('club-autre', other.res);
    (a.res.write as jest.Mock).mockClear();
    (b.res.write as jest.Mock).mockClear();
    (other.res.write as jest.Mock).mockClear();

    sse.broadcastClub('club-t2', { type: 'slot_held', resourceId: 'r1' });

    expect(a.res.write).toHaveBeenCalledWith(expect.stringContaining('"type":"slot_held"'));
    expect(b.res.write).toHaveBeenCalledWith(expect.stringContaining('"type":"slot_held"'));
    expect(other.res.write).not.toHaveBeenCalled();
    a.close(); b.close(); other.close();
  });

  it('la déconnexion retire le client : plus aucun write après close', () => {
    const { res, close } = fakeRes();
    const sse = SSEService.getInstance();
    sse.addClubClient('club-t3', res);
    close();
    (res.write as jest.Mock).mockClear();

    sse.broadcastClub('club-t3', { type: 'slot_released', resourceId: 'r1' });

    expect(res.write).not.toHaveBeenCalled();
  });

  it('heartbeat : un ping toutes les 30 s, coupé au close', () => {
    const { res, close } = fakeRes();
    SSEService.getInstance().addClubClient('club-t4', res);
    (res.write as jest.Mock).mockClear();

    jest.advanceTimersByTime(30_000);
    expect(res.write).toHaveBeenCalledWith(': ping\n\n');

    close();
    (res.write as jest.Mock).mockClear();
    jest.advanceTimersByTime(60_000);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('un write qui jette est toléré et le client mort est purgé', () => {
    const dead = fakeRes(); const alive = fakeRes();
    const sse = SSEService.getInstance();
    sse.addClubClient('club-t5', dead.res);
    sse.addClubClient('club-t5', alive.res);
    (dead.res.write as jest.Mock).mockImplementation(() => { throw new Error('EPIPE'); });
    (alive.res.write as jest.Mock).mockClear();

    sse.broadcastClub('club-t5', { type: 'slot_confirmed', resourceId: 'r1' });
    expect(alive.res.write).toHaveBeenCalled();

    // 2ᵉ broadcast : le mort a été purgé, plus d'appel sur lui.
    (dead.res.write as jest.Mock).mockClear();
    sse.broadcastClub('club-t5', { type: 'slot_confirmed', resourceId: 'r1' });
    expect(dead.res.write).not.toHaveBeenCalled();
    alive.close();
  });
});
