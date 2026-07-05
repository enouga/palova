import { render, screen, fireEvent } from '@testing-library/react';
import { PosterMosaic } from '@/components/clubhouse/PosterMosaic';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { Announcement } from '@/lib/api';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const poster = (over: Partial<Announcement>): Announcement => ({
  id: 'a1', title: 'Open P250', body: 'Corps', linkUrl: null, imageUrl: '/uploads/announcements/a.jpg',
  isPublished: true, pinned: false, kind: 'TOURNAMENT', validUntil: null, createdAt: '', updatedAt: '', ...over,
});

const wrap = (posters: Announcement[]) =>
  render(<ThemeProvider><PosterMosaic posters={posters} /></ThemeProvider>);

describe('PosterMosaic', () => {
  it('rend rien sans affiche', () => {
    const { container } = wrap([]);
    expect(container.firstChild).toBeNull();
  });

  it('1 affiche = pleine largeur, chip du type, clic → lightbox avec image entière', () => {
    wrap([poster({})]);
    expect(screen.getByTestId('poster-grid')).toHaveAttribute('data-layout', 'single');
    expect(screen.getByText('Tournoi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open P250/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('3 affiches = bento, lien « En savoir plus » dans la lightbox si linkUrl', () => {
    wrap([poster({ id: 'a1', linkUrl: 'https://x.fr' }), poster({ id: 'a2' }), poster({ id: 'a3' })]);
    expect(screen.getByTestId('poster-grid')).toHaveAttribute('data-layout', 'bento');
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByRole('link', { name: /En savoir plus/i })).toHaveAttribute('href', 'https://x.fr');
  });
});
