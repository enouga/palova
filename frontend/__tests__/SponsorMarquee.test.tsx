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

  it('rend la tuile logo en héros avec le nom dessous, piste dupliquée', () => {
    wrap([sponsor({}), sponsor({ id: 's2', name: 'Nox' }), sponsor({ id: 's3', name: 'CM' })], now);
    const logos = screen.getAllByAltText('Head Padel');
    expect(logos.length).toBe(2); // piste dupliquée pour la boucle
    expect(logos[0]).toHaveAttribute('src', '/uploads/sponsors/h.png');
    expect(screen.getAllByText('Head Padel').length).toBeGreaterThanOrEqual(2); // nom sous la tuile
  });

  it('offre active → chip + bouton code copiable', () => {
    wrap([sponsor({ offerText: '-15 % raquettes', offerCode: 'PADEL15' }), sponsor({ id: 's2', name: 'Nox' }), sponsor({ id: 's3', name: 'CM' })], now);
    expect(screen.getAllByText('-15 % raquettes').length).toBe(2);
    fireEvent.click(screen.getAllByRole('button', { name: /PADEL15/ })[0]);
    // le code est copié (best-effort — pas de crash sans navigator.clipboard en jsdom)
  });

  it('sans offre → tuile + nom seuls, pas de chip', () => {
    wrap([sponsor({}), sponsor({ id: 's2', name: 'Nox' })], now);
    expect(screen.queryByRole('button', { name: /Copier/ })).toBeNull();
  });

  it('offre expirée → carte sans chip d’offre', () => {
    wrap([sponsor({ offerText: '-15 %', offerUntil: '2026-07-01T23:59:59.999Z' }), sponsor({ id: 's2' }), sponsor({ id: 's3' })], now);
    expect(screen.queryByText('-15 %')).toBeNull();
  });

  it('expiration urgente → compte à rebours affiché', () => {
    wrap([sponsor({ offerText: '-15 %', offerUntil: '2026-07-06T00:00:00.000Z' }), sponsor({ id: 's2' }), sponsor({ id: 's3' })], now);
    expect(screen.getAllByText(/Plus que/).length).toBeGreaterThan(0);
  });

  it('≤ 2 sponsors → grille statique sans duplication', () => {
    wrap([sponsor({}), sponsor({ id: 's2', name: 'Nox' })], now);
    expect(screen.getAllByAltText('Head Padel').length).toBe(1);
  });

  it('rien sans sponsor', () => {
    const { container } = wrap([], now);
    expect(container.firstChild).toBeNull();
  });
});
