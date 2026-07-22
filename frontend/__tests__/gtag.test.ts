import { gaId, loadGtag, pageview } from '@/lib/gtag';

const OLD = process.env.NEXT_PUBLIC_GA_ID;
afterEach(() => {
  if (OLD === undefined) delete process.env.NEXT_PUBLIC_GA_ID;
  else process.env.NEXT_PUBLIC_GA_ID = OLD;
  document.getElementById('ga-gtag')?.remove();
  delete window.gtag;
  delete window.dataLayer;
});

test('gaId lit NEXT_PUBLIC_GA_ID', () => {
  process.env.NEXT_PUBLIC_GA_ID = 'G-ABC123';
  expect(gaId()).toBe('G-ABC123');
});

test('gaId vide si non défini', () => {
  delete process.env.NEXT_PUBLIC_GA_ID;
  expect(gaId()).toBe('');
});

test('loadGtag injecte le script gtag.js et initialise window.gtag', () => {
  loadGtag('G-ABC123');
  const s = document.getElementById('ga-gtag') as HTMLScriptElement | null;
  expect(s).not.toBeNull();
  expect(s!.src).toContain('googletagmanager.com/gtag/js?id=G-ABC123');
  expect(typeof window.gtag).toBe('function');
});

test('loadGtag est idempotent (pas de double injection)', () => {
  loadGtag('G-ABC123');
  loadGtag('G-ABC123');
  expect(document.querySelectorAll('#ga-gtag').length).toBe(1);
});

test('pageview pousse un événement page_view quand gtag existe', () => {
  const spy = jest.fn();
  window.gtag = spy;
  pageview('/reserver');
  expect(spy).toHaveBeenCalledWith('event', 'page_view', { page_path: '/reserver' });
});

test('pageview ne fait rien sans gtag', () => {
  expect(() => pageview('/reserver')).not.toThrow();
});
