import { render, screen } from '@testing-library/react';
import { ClubCover } from '../components/ClubCover';
import { ThemeProvider } from '../lib/ThemeProvider';

const base = { name: 'Padel Arena', slug: 'demo', accentColor: '#d6ff3f', coverImageUrl: null as string | null };
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('ClubCover', () => {
  it('avec coverImageUrl → rend une <img> de la photo', () => {
    wrap(<ClubCover variant="card" club={{ ...base, coverImageUrl: '/uploads/covers/c1.jpg' }} />);
    const img = screen.getByRole('img', { name: /Couverture Padel Arena/ });
    expect(img.getAttribute('src')).toContain('/uploads/covers/c1.jpg');
  });

  it('sans coverImageUrl (card) → illustration générée avec les initiales', () => {
    wrap(<ClubCover variant="card" club={base} />);
    expect(screen.getByTestId('club-cover')).toBeInTheDocument();
    expect(screen.getByText('PA')).toBeInTheDocument();
  });

  it('variant banner → superpose le nom du club', () => {
    wrap(<ClubCover variant="banner" club={base} />);
    expect(screen.getByText('Padel Arena')).toBeInTheDocument();
  });
});
