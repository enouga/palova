jest.mock('@sentry/nextjs');
import * as Sentry from '@sentry/nextjs';
import { initSentry } from '@/lib/observability';

describe('initSentry (frontend)', () => {
  beforeEach(() => (Sentry.init as jest.Mock).mockClear());

  it('ne fait rien sans DSN', () => {
    expect(initSentry(undefined)).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initialise avec un DSN', () => {
    expect(initSentry('https://k@glitchtip.example/2')).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });
});
