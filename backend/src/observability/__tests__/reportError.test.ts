jest.mock('@sentry/node');
jest.mock('../sentry');
import * as Sentry from '@sentry/node';
import { isSentryEnabled } from '../sentry';
import { reportError } from '../reportError';

describe('reportError', () => {
  let errSpy: jest.SpyInstance;
  beforeEach(() => {
    (Sentry.captureException as jest.Mock).mockClear();
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it('capture vers Sentry AVEC le contexte quand le SDK est actif', () => {
    (isSentryEnabled as jest.Mock).mockReturnValue(true);
    const e = new Error('boom');
    reportError(e, { source: 'test', userId: 'u1' });
    expect(Sentry.captureException).toHaveBeenCalledWith(e, { extra: { source: 'test', userId: 'u1' } });
    expect(errSpy).toHaveBeenCalled(); // log local conservé
  });

  it('ne capture PAS quand le SDK est inactif, mais logge localement', () => {
    (isSentryEnabled as jest.Mock).mockReturnValue(false);
    reportError(new Error('boom'), { source: 'test' });
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});
