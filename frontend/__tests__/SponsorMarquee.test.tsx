import { render, screen, fireEvent } from '@testing-library/react';
import { SponsorMarquee } from '@/components/clubhouse/SponsorMarquee';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { Sponsor } from '@/lib/api';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const sponsor = (over: Partial<Sponsor>): Sponsor => ({
  id: 's1', name: 'Head Padel', logoUrl: '/uploads/sponsors/h.png', linkUrl: null,
  offerText: null, offerCode: null, offerUntil: null, pinned: false, sortOrder: 0, isActive: true, createdAt: '', ...over,
});

const wrap = (sponsors: Sponsor[], now: Date | null) =>
  render(<ThemeProvider><SponsorMarquee sponsors={sponsors} now={now} /></ThemeProvider>);

describe('SponsorMarquee', () => {
  const now = new Date('2026-07-05T12:00:00Z');

  it('rend les cartes riches (nom + offre + code copiable) en piste dupliquée', () => {
    wrap([sponsor({ offerText: '-15 % raquettes', offerCode: 'PADEL15' }), sponsor({ id: 's2', name: 'Nox' }), sponsor({ id: 's3', name: 'CM' })], now);
    expect(screen.getAllByText('Head Padel').length).toBe(2); // piste dupliquée pour la boucle
    expect(screen.getAllByText('-15 % raquettes').length).toBe(2);
    fireEvent.click(screen.getAllByRole('button', { name: /PADEL15/ })[0]);
    // le code est copié (best-effort — pas de crash sans navigator.clipboard en jsdom)
  });

  it('≤ 2 sponsors → grille statique sans duplication', () => {
    wrap([sponsor({}), sponsor({ id: 's2', name: 'Nox' })], now);
    expect(screen.getAllByText('Head Padel').length).toBe(1);
  });

  it('offre expirée → carte sans texte d’offre', () => {
    wrap([sponsor({ offerText: '-15 %', offerUntil: '2026-07-01T23:59:59.999Z' }), sponsor({ id: 's2' }), sponsor({ id: 's3' })], now);
    expect(screen.queryByText('-15 %')).toBeNull();
  });

  it('rien sans sponsor', () => {
    const { container } = wrap([], now);
    expect(container.firstChild).toBeNull();
  });
});
