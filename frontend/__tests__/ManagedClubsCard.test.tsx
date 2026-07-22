import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ManagedClubsCard } from '../components/platform/home/ManagedClubsCard';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { ManagedClub } from '../lib/api';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p, api: { getMyClubs: jest.fn() } }));
const goToClubAdmin = jest.fn();
jest.mock('../lib/postAuth', () => ({ goToClubAdmin: (...a: unknown[]) => goToClubAdmin(...a) }));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

function club(over: Partial<ManagedClub> = {}): ManagedClub {
  return { clubId: 'c1', slug: 'padel-arena', name: 'Padel Arena', role: 'OWNER', accentColor: '#5e93da', ...over };
}

describe('ManagedClubsCard', () => {
  beforeEach(() => { goToClubAdmin.mockClear(); });

  it('aucun club géré → rien (le joueur pur ne voit jamais cette carte)', async () => {
    mocked.getMyClubs.mockResolvedValue([] as never);
    const { container } = render(<ThemeProvider><ManagedClubsCard token="tok" /></ThemeProvider>);
    await waitFor(() => expect(mocked.getMyClubs).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('un club géré : kicker « Gestion », nom du club, rôle en badge, liseré + CTA teintés à la couleur du club, clic → goToClubAdmin', async () => {
    mocked.getMyClubs.mockResolvedValue([club()] as never);
    const { container } = render(<ThemeProvider><ManagedClubsCard token="tok" /></ThemeProvider>);
    expect(await screen.findByText('Gestion')).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Padel Arena/ });
    expect(screen.getByText('Gérant')).toBeInTheDocument();
    // Liseré latéral teinté à la couleur du club (langage des cartes d'offres admin) —
    // remplace la ligne plate d'origine (jugée « trop générique »).
    expect(container.querySelector('[data-club-stripe]')).toHaveStyle({ background: 'rgb(94, 147, 218)' });
    // Tuile en couleur pleine de la marque du club (pas un lavis pâle) — miroir MyClubsRow.
    expect(row.querySelector('span')).toHaveStyle({ background: 'rgb(94, 147, 218)' });
    // Le rôle est un badge Chip distinctif (teinté à la couleur du club), pas du texte gris plat.
    expect(screen.getByText('Gérant')).toHaveStyle({ borderRadius: '8px', padding: '5px 10px' });
    // CTA plein (accent du club) remplace le simple chevron.
    expect(within(row).getByText('Gérer →')).toBeInTheDocument();
    fireEvent.click(row);
    expect(goToClubAdmin).toHaveBeenCalledWith('padel-arena', 'tok', 'c1');
  });

  it('rôle Staff affiché tel quel', async () => {
    mocked.getMyClubs.mockResolvedValue([club({ role: 'STAFF' })] as never);
    render(<ThemeProvider><ManagedClubsCard token="tok" /></ThemeProvider>);
    await screen.findByRole('button', { name: /Padel Arena/ });
    expect(screen.getByText('Staff')).toBeInTheDocument();
  });

  it('plusieurs clubs gérés : une ligne par club', async () => {
    mocked.getMyClubs.mockResolvedValue([
      club({ clubId: 'c1', name: 'Padel Arena Paris', slug: 'padel-arena-paris' }),
      club({ clubId: 'c2', name: 'ACE Padel Club', slug: 'ace-padel-club', role: 'ADMIN' }),
    ] as never);
    render(<ThemeProvider><ManagedClubsCard token="tok" /></ThemeProvider>);
    expect(await screen.findByRole('button', { name: /Padel Arena Paris/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ACE Padel Club/ })).toBeInTheDocument();
  });
});
