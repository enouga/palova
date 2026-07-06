import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { AuthShell } from '../components/auth/AuthShell';
import { ThemeProvider } from '../lib/ThemeProvider';
import { PANEL_COPY } from '../lib/authShell';

const useClubMock = jest.fn();
jest.mock('../lib/ClubProvider', () => ({ useClub: () => useClubMock() }));

// Seuls les champs lus par AuthShell/ClubTile comptent ; le reste de ClubDetail est ignoré.
const CLUB = {
  id: 'c1', slug: 'padel-arena-paris', name: 'Padel Arena Paris', city: 'Paris',
  logoUrl: null, accentColor: '#7a4dd8',
} as never;

const wrap = (ui: ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('AuthShell', () => {
  beforeEach(() => {
    useClubMock.mockReturnValue({ slug: null, club: null, loading: false });
  });

  it('hôte plateforme : panneau Palova (headline + ligne joueur dans panneau ET bandeau)', () => {
    wrap(<AuthShell title="Bon retour."><div>form</div></AuthShell>);
    expect(screen.getByText(PANEL_COPY.player.headline)).toBeInTheDocument();
    // La ligne apparaît deux fois : panneau desktop + bandeau mobile (bascule CSS, les deux sont dans le DOM).
    expect(screen.getAllByText(PANEL_COPY.player.line)).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Bon retour.' })).toBeInTheDocument();
    expect(screen.getByText('form')).toBeInTheDocument();
  });

  it('hôte club : identité club (nom, ville, initiale, « propulsé par ») sans headline Palova', () => {
    useClubMock.mockReturnValue({ slug: 'padel-arena-paris', club: CLUB, loading: false });
    wrap(<AuthShell title="Bon retour."><div>form</div></AuthShell>);
    // Nom du club dans le panneau ET le bandeau ; initiale en repli de logo.
    expect(screen.getAllByText('Padel Arena Paris').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Paris')).toBeInTheDocument(); // ville (panneau seul)
    expect(screen.getAllByText('P').length).toBeGreaterThanOrEqual(1); // initiale de la tuile logo
    expect(screen.getByText(/propulsé par/)).toBeInTheDocument();
    expect(screen.queryByText(PANEL_COPY.player.headline)).toBeNull();
  });

  it("audience 'club' prime sur l'identité club (créer un NOUVEAU club = panneau Palova B2B)", () => {
    useClubMock.mockReturnValue({ slug: 'padel-arena-paris', club: CLUB, loading: false });
    wrap(<AuthShell audience="club" title="Créez."><div>form</div></AuthShell>);
    expect(screen.getByText(PANEL_COPY.club.headline)).toBeInTheDocument();
    expect(screen.queryByText('Padel Arena Paris')).toBeNull();
  });

  it('title omis : aucun heading (les étapes verify/reset portent le leur)', () => {
    wrap(<AuthShell><div>form</div></AuthShell>);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
