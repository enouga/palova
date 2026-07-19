import { render, screen, fireEvent } from '@testing-library/react';
import { CgvGate } from '../components/CgvGate';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: 'padel-arena', club: null, loading: false }) }));

const wrap = () => render(
  <ThemeProvider><CgvGate><div>formulaire-stripe</div></CgvGate></ThemeProvider>,
);

describe('CgvGate', () => {
  beforeEach(() => window.localStorage.clear());

  it('masque les enfants tant que la case n\'est pas cochée', () => {
    wrap();
    expect(screen.queryByText('formulaire-stripe')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('formulaire-stripe')).toBeInTheDocument();
  });

  it('mémorise l\'acceptation par club (pré-cochage au prochain montage)', () => {
    wrap();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(window.localStorage.getItem('palova:cgv-accepted:padel-arena')).toBe('1');
  });

  it('pointe vers les CGV du club', () => {
    wrap();
    expect(screen.getByRole('link', { name: /conditions générales de vente/ })).toHaveAttribute('href', '/cgv');
  });

  it('déjà accepté pour ce club → rappel « déjà accepté » (plus de case), enfants montés directement', () => {
    window.localStorage.setItem('palova:cgv-accepted:padel-arena', '1');
    wrap();
    expect(screen.getByText(/déjà accepté/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('formulaire-stripe')).toBeInTheDocument();
  });
});
