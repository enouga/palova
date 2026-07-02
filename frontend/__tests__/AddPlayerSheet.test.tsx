import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { AddPlayerSheet } from '@/components/match/AddPlayerSheet';

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    searchClubMembers: jest.fn().mockResolvedValue([]),
    listClubFriends: jest.fn().mockResolvedValue([]),
  },
}));
import { api } from '@/lib/api';
const mocked = api as jest.Mocked<typeof api>;

const base = { slug: 'demo', token: 't', team: 2 as const, slot: 1, excludeIds: [] as string[], onPick: jest.fn(), onClose: jest.fn() };
const wrap = (over = {}) => render(<ThemeProvider><AddPlayerSheet {...base} {...over} /></ThemeProvider>);

describe('AddPlayerSheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('affiche le titre, la chip de destination « ÉQUIPE 2 · D » et la recherche', async () => {
    wrap();
    expect(screen.getByText('Ajouter un joueur')).toBeInTheDocument();
    expect(screen.getByText(/ÉQUIPE 2 · D/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Rechercher un membre/)).toBeInTheDocument();
    await waitFor(() => expect(mocked.searchClubMembers).toHaveBeenCalledWith('demo', '', 't'));
  });

  it('mode remplacement : titre « Remplacer {nom} »', () => {
    wrap({ replaceName: 'Karim B.' });
    expect(screen.getByText('Remplacer Karim B.')).toBeInTheDocument();
  });

  it('liste les membres (excludeIds filtrés) et émet onPick', async () => {
    mocked.searchClubMembers.mockResolvedValue([
      { id: 'u-new', firstName: 'New', lastName: 'Player' },
      { id: 'u-out', firstName: 'Deja', lastName: 'La' },
    ] as never);
    wrap({ excludeIds: ['u-out'] });
    fireEvent.click(await screen.findByRole('button', { name: /New Player/ }));
    expect(base.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-new' }));
    expect(screen.queryByText('Deja La')).not.toBeInTheDocument();
  });

  it('la rangée « Mes amis » émet onPick', async () => {
    mocked.listClubFriends.mockResolvedValue([
      { id: 'f1', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true },
    ] as never);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /léa/i }));
    expect(base.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
  });

  it('le bouton Fermer appelle onClose', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(base.onClose).toHaveBeenCalled();
  });
});
