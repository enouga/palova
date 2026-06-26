import '@testing-library/jest-dom';

// jsdom n'implémente pas matchMedia (utilisé par useInstallPrompt pour détecter
// le mode standalone PWA) : stub neutre « ne matche jamais ».
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom n'implémente ni IntersectionObserver ni ResizeObserver. Stubs neutres :
// les tests qui veulent piloter l'intersection surchargent global.IntersectionObserver localement.
class IOStub {
  constructor(_cb: unknown, _opts?: unknown) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
class ROStub {
  constructor(_cb: unknown) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error - stub jsdom (IOStub n'expose pas root/rootMargin/thresholds)
global.IntersectionObserver = IOStub;
global.ResizeObserver = ROStub;

// jsdom n'implémente pas la géolocalisation : stub par défaut « refuse » (les tests
// qui veulent un succès surchargent navigator.geolocation.getCurrentPosition localement).
Object.defineProperty(global.navigator, 'geolocation', {
  configurable: true,
  value: { getCurrentPosition: (_ok: PositionCallback, err?: PositionErrorCallback) => err?.({ code: 1 } as GeolocationPositionError) },
});
