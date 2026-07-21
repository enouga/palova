import { readConsent, writeConsent, CONSENT_COOKIE, CONSENT_VERSION, CONSENT_EVENT } from '@/lib/consent';

afterEach(() => {
  // purge le cookie entre les cas (jsdom : host-only sur localhost)
  document.cookie = `${CONSENT_COOKIE}=; path=/; max-age=0`;
});

test('readConsent renvoie null sans cookie', () => {
  expect(readConsent()).toBeNull();
});

test('writeConsent/readConsent : aller-retour granted', () => {
  writeConsent('granted');
  expect(readConsent()).toBe('granted');
});

test('writeConsent/readConsent : aller-retour denied', () => {
  writeConsent('denied');
  expect(readConsent()).toBe('denied');
});

test('une version de consentement périmée est ignorée (bannière réaffichée)', () => {
  document.cookie = `${CONSENT_COOKIE}=granted:0; path=/`;
  expect(readConsent()).toBeNull();
});

test('une valeur inconnue est ignorée', () => {
  document.cookie = `${CONSENT_COOKIE}=maybe:${CONSENT_VERSION}; path=/`;
  expect(readConsent()).toBeNull();
});

test('constantes exportées', () => {
  expect(CONSENT_COOKIE).toBe('palova_consent');
  expect(CONSENT_EVENT).toBe('palova:open-consent');
});
