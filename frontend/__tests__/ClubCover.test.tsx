import { render, screen, fireEvent } from '@testing-library/react';
import { ClubCover } from '../components/ClubCover';
import { ThemeProvider } from '../lib/ThemeProvider';

const base = { name: 'Padel Arena', slug: 'demo', accentColor: '#d6ff3f', coverImageUrl: null as string | null };
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('ClubCover', () => {
  it('avec coverImageUrl → rend la photo importée', () => {
    wrap(<ClubCover club={{ ...base, coverImageUrl: '/uploads/covers/c1.jpg' }} />);
    const img = screen.getByRole('img', { name: /Couverture Padel Arena/ });
    expect(img.getAttribute('src')).toContain('/uploads/covers/c1.jpg');
  });

  it('sans photo importée → photo de court de la banque par défaut', () => {
    wrap(<ClubCover club={base} />);
    const img = screen.getByRole('img', { name: /Couverture Padel Arena/ });
    expect(img.getAttribute('src')).toMatch(/^\/covers\/court-\d+\.jpg$/);
  });

  it('si la photo par défaut échoue → repli mesh + initiales', () => {
    wrap(<ClubCover club={base} />);
    fireEvent.error(screen.getByRole('img', { name: /Couverture Padel Arena/ }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('PA')).toBeInTheDocument();
  });
});
