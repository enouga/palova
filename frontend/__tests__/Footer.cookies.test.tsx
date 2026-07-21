import { render, screen, cleanup } from '@testing-library/react';
import { Footer } from '@/components/Footer';
import { CONSENT_EVENT } from '@/lib/consent';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '' }) }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null }) }));
jest.mock('next/navigation', () => ({ usePathname: () => '/' }));

const OLD = process.env.NEXT_PUBLIC_GA_ID;
afterEach(() => {
  cleanup();
  if (OLD === undefined) delete process.env.NEXT_PUBLIC_GA_ID;
  else process.env.NEXT_PUBLIC_GA_ID = OLD;
});

test('avec un ID GA : le bouton « Gérer les cookies » émet l\'événement de réouverture', () => {
  process.env.NEXT_PUBLIC_GA_ID = 'G-TEST';
  const spy = jest.fn();
  window.addEventListener(CONSENT_EVENT, spy);
  render(<Footer />);
  const btn = screen.getByRole('button', { name: /gérer les cookies/i });
  btn.click();
  expect(spy).toHaveBeenCalled();
  window.removeEventListener(CONSENT_EVENT, spy);
});

test('sans ID GA : pas de bouton « Gérer les cookies »', () => {
  delete process.env.NEXT_PUBLIC_GA_ID;
  render(<Footer />);
  expect(screen.queryByRole('button', { name: /gérer les cookies/i })).toBeNull();
});
