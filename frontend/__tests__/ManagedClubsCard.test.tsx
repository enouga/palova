import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManagedClubsCard } from '../components/platform/home/ManagedClubsCard';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p, api: { getMyClubs: jest.fn() } }));
const goToClubAdmin = jest.fn();
jest.mock('../lib/postAuth', () => ({ goToClubAdmin: (...a: unknown[]) => goToClubAdmin(...a) }));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

describe('ManagedClubsCard', () => {
  it('un bouton « Gérer » par club géré, navigation via goToClubAdmin (pont de session dev inclus)', async () => {
    mocked.getMyClubs.mockResolvedValue([{ clubId: 'c1', slug: 'padel-arena', name: 'Padel Arena', role: 'OWNER' }] as never);
    render(<ThemeProvider><ManagedClubsCard token="tok" /></ThemeProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /Gérer Padel Arena/ }));
    expect(goToClubAdmin).toHaveBeenCalledWith('padel-arena', 'tok', 'c1');
  });

  it('aucun club géré → rien (le joueur pur ne voit jamais cette carte)', async () => {
    mocked.getMyClubs.mockResolvedValue([] as never);
    const { container } = render(<ThemeProvider><ManagedClubsCard token="tok" /></ThemeProvider>);
    await waitFor(() => expect(mocked.getMyClubs).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
