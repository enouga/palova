import { render, screen, act, cleanup } from '@testing-library/react';
import { AnalyticsConsent } from '@/components/AnalyticsConsent';
import { CONSENT_COOKIE, CONSENT_VERSION, CONSENT_EVENT } from '@/lib/consent';
import * as gtag from '@/lib/gtag';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '' }) }) }));

const mockPath = { current: '/' };
jest.mock('next/navigation', () => ({ usePathname: () => mockPath.current }));

jest.mock('@/lib/gtag', () => ({
  gaId: () => process.env.NEXT_PUBLIC_GA_ID || '',
  loadGtag: jest.fn(),
  pageview: jest.fn(),
}));

const OLD = process.env.NEXT_PUBLIC_GA_ID;
beforeEach(() => { process.env.NEXT_PUBLIC_GA_ID = 'G-TEST'; mockPath.current = '/'; });
afterEach(() => {
  cleanup();
  if (OLD === undefined) delete process.env.NEXT_PUBLIC_GA_ID;
  else process.env.NEXT_PUBLIC_GA_ID = OLD;
  document.cookie = `${CONSENT_COOKIE}=; path=/; max-age=0`;
  jest.clearAllMocks();
});

test('sans NEXT_PUBLIC_GA_ID : rien (ni bannière ni GA)', () => {
  delete process.env.NEXT_PUBLIC_GA_ID;
  render(<AnalyticsConsent />);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
  expect(gtag.loadGtag).not.toHaveBeenCalled();
});

test('aucun choix : la bannière s\'affiche avec Accepter et Refuser', () => {
  render(<AnalyticsConsent />);
  expect(screen.getByRole('button', { name: /accepter/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /refuser/i })).toBeInTheDocument();
  expect(gtag.loadGtag).not.toHaveBeenCalled();
});

test('Accepter : charge GA, écrit le cookie granted, ferme la bannière', () => {
  render(<AnalyticsConsent />);
  act(() => { screen.getByRole('button', { name: /accepter/i }).click(); });
  expect(gtag.loadGtag).toHaveBeenCalledWith('G-TEST');
  expect(document.cookie).toContain(`${CONSENT_COOKIE}=granted%3A${CONSENT_VERSION}`);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
});

test('Refuser : ne charge pas GA, écrit denied, ferme la bannière', () => {
  render(<AnalyticsConsent />);
  act(() => { screen.getByRole('button', { name: /refuser/i }).click(); });
  expect(gtag.loadGtag).not.toHaveBeenCalled();
  expect(document.cookie).toContain(`${CONSENT_COOKIE}=denied%3A${CONSENT_VERSION}`);
  expect(screen.queryByRole('button', { name: /refuser/i })).toBeNull();
});

test('cookie granted au montage : pas de bannière, GA chargé, page vue émise', () => {
  document.cookie = `${CONSENT_COOKIE}=granted:${CONSENT_VERSION}; path=/`;
  render(<AnalyticsConsent />);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
  expect(gtag.loadGtag).toHaveBeenCalledWith('G-TEST');
  expect(gtag.pageview).toHaveBeenCalledWith('/');
});

test('cookie denied au montage : pas de bannière, GA non chargé', () => {
  document.cookie = `${CONSENT_COOKIE}=denied:${CONSENT_VERSION}; path=/`;
  render(<AnalyticsConsent />);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
  expect(gtag.loadGtag).not.toHaveBeenCalled();
});

test('sur /admin : rend null même avec consentement accordé', () => {
  document.cookie = `${CONSENT_COOKIE}=granted:${CONSENT_VERSION}; path=/`;
  mockPath.current = '/admin/planning';
  render(<AnalyticsConsent />);
  expect(gtag.loadGtag).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
});

test('sur /superadmin : rend null', () => {
  mockPath.current = '/superadmin';
  render(<AnalyticsConsent />);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
});

test('événement « Gérer les cookies » : rouvre la bannière même après un choix', () => {
  document.cookie = `${CONSENT_COOKIE}=denied:${CONSENT_VERSION}; path=/`;
  render(<AnalyticsConsent />);
  expect(screen.queryByRole('button', { name: /accepter/i })).toBeNull();
  act(() => { window.dispatchEvent(new Event(CONSENT_EVENT)); });
  expect(screen.getByRole('button', { name: /accepter/i })).toBeInTheDocument();
});
