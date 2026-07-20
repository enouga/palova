jest.mock('@sentry/node');

describe('initSentry', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => { process.env = OLD_ENV; });

  it("ne fait rien quand GLITCHTIP_DSN est absent", () => {
    delete process.env.GLITCHTIP_DSN;
    // resetModules invalide le registre : Sentry ET ../sentry doivent être requis à neuf
    // ICI pour partager la même instance de mock (un import top-level pointerait l'ancienne).
    const Sentry = require('@sentry/node');
    const { initSentry, isSentryEnabled } = require('../sentry');
    initSentry();
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
  });

  it("initialise Sentry une seule fois quand le DSN est présent", () => {
    process.env.GLITCHTIP_DSN = 'https://k@glitchtip.example/1';
    const Sentry = require('@sentry/node');
    const { initSentry, isSentryEnabled } = require('../sentry');
    initSentry();
    initSentry(); // second appel = no-op
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(isSentryEnabled()).toBe(true);
  });
});
