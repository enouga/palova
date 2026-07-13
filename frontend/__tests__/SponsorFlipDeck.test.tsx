import { render, screen, fireEvent, act } from '@testing-library/react';
import { SponsorFlipDeck } from '@/components/clubhouse/SponsorFlipDeck';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { Sponsor } from '@/lib/api';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const sponsor = (over: Partial<Sponsor>): Sponsor => ({
  id: 's1', name: 'Head Padel', logoUrl: '/uploads/sponsors/h.png', linkUrl: null,
  offerText: null, offerCode: null, offerUntil: null, pinned: false, sortOrder: 0, isActive: true, createdAt: '', ...over,
});

const wrap = (sponsors: Sponsor[], now: Date | null) =>
  render(<ThemeProvider><SponsorFlipDeck sponsors={sponsors} now={now} /></ThemeProvider>);

describe('SponsorFlipDeck', () => {
  const now = new Date('2026-07-05T12:00:00Z');

  it('rend une carte par sponsor (logo + nom), sans duplication', () => {
    wrap([sponsor({}), sponsor({ id: 's2', name: 'Nox' })], now);
    expect(screen.getAllByAltText('Head Padel').length).toBe(1);
    expect(screen.getByRole('button', { name: 'Head Padel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nox' })).toBeInTheDocument();
  });

  it('dos avec offre active → texte de l’offre + bouton code copiable', () => {
    wrap([sponsor({ offerText: '-15 % raquettes', offerCode: 'PADEL15' })], now);
    expect(screen.getByText('-15 % raquettes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /PADEL15/ })).toBeInTheDocument();
  });

  it('dos sans offre → « Partenaire du club », pas de bouton code', () => {
    wrap([sponsor({})], now);
    expect(screen.getByText(/Partenaire du club/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copier/ })).toBeNull();
  });

  it('offre expirée → dos « Partenaire du club » (offre masquée)', () => {
    wrap([sponsor({ offerText: '-15 %', offerUntil: '2026-07-01T23:59:59.999Z' })], now);
    expect(screen.queryByText('-15 %')).toBeNull();
    expect(screen.getByText(/Partenaire du club/i)).toBeInTheDocument();
  });

  it('tap retourne la carte (aria-pressed bascule)', () => {
    wrap([sponsor({})], now);
    const card = screen.getByRole('button', { name: 'Head Padel' });
    expect(card).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'false');
  });

  it('clic sur « copier le code » ne retourne pas la carte', () => {
    wrap([sponsor({ offerText: '-15 %', offerCode: 'PADEL15' })], now);
    const card = screen.getByRole('button', { name: 'Head Padel' });
    fireEvent.click(screen.getByRole('button', { name: /PADEL15/ }));
    expect(card).toHaveAttribute('aria-pressed', 'false');
  });

  it('cascade automatique : après le délai la carte 0 se retourne, puis la carte 1', () => {
    jest.useFakeTimers();
    try {
      wrap([sponsor({}), sponsor({ id: 's2', name: 'Nox' })], now);
      const c0 = screen.getByRole('button', { name: 'Head Padel' });
      const c1 = screen.getByRole('button', { name: 'Nox' });
      expect(c0).toHaveAttribute('aria-pressed', 'false');
      act(() => { jest.advanceTimersByTime(3500); });
      expect(c0).toHaveAttribute('aria-pressed', 'true');
      expect(c1).toHaveAttribute('aria-pressed', 'false');
      act(() => { jest.advanceTimersByTime(3500); });
      expect(c0).toHaveAttribute('aria-pressed', 'false');
      expect(c1).toHaveAttribute('aria-pressed', 'true');
    } finally {
      jest.useRealTimers();
    }
  });

  it('prefers-reduced-motion : pas de cascade auto, mais le tap retourne quand même', () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: /reduce/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    jest.useFakeTimers();
    try {
      wrap([sponsor({})], now);
      const card = screen.getByRole('button', { name: 'Head Padel' });
      act(() => { jest.advanceTimersByTime(10000); });
      expect(card).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(card);
      expect(card).toHaveAttribute('aria-pressed', 'true');
    } finally {
      jest.useRealTimers();
      window.matchMedia = orig;
    }
  });

  it('pastille « Offre disponible » sur la face avant quand une offre est active', () => {
    wrap([sponsor({ offerText: '-15 % raquettes', offerCode: 'PADEL15' })], now);
    expect(screen.getByLabelText('Offre disponible')).toBeInTheDocument();
  });

  it('pas de pastille sans offre ou offre expirée', () => {
    wrap([sponsor({}), sponsor({ id: 's2', name: 'Nox', offerText: '-5 %', offerUntil: '2026-07-01T00:00:00.000Z' })], now);
    expect(screen.queryByLabelText('Offre disponible')).toBeNull();
  });

  it('rien sans sponsor', () => {
    const { container } = wrap([], now);
    expect(container.firstChild).toBeNull();
  });
});
