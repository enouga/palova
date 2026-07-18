import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminSponsorsPage from '@/app/admin/sponsors/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Padel Arena' } }) }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminGetSponsors: jest.fn(),
    adminDeleteSponsor: jest.fn(),
    adminCreateSponsor: jest.fn(),
    adminUpdateSponsor: jest.fn(),
    uploadSponsorLogo: jest.fn(),
  },
}));
import { api } from '@/lib/api';
const mocked = api as jest.Mocked<typeof api>;

const sponsor = (over: Partial<Record<string, unknown>>) => ({
  id: 'sp-1', name: 'Babolat', logoUrl: '/uploads/x.png', linkUrl: null,
  sortOrder: 0, isActive: true, offerText: null, offerCode: null, offerUntil: null, pinned: false,
  ...over,
});

const wrap = () => render(<ThemeProvider><AdminSponsorsPage /></ThemeProvider>);

describe('/admin/sponsors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.adminDeleteSponsor.mockResolvedValue({ ok: true } as never);
    mocked.adminGetSponsors.mockResolvedValue([
      sponsor({ id: 'sp-1', name: 'Babolat' }),
      sponsor({ id: 'sp-2', name: 'Decathlon', sortOrder: 1 }),
    ] as never);
  });

  it('affiche la liste des partenaires', async () => {
    wrap();
    expect(await screen.findByText('Babolat')).toBeInTheDocument();
    expect(screen.getByText('Decathlon')).toBeInTheDocument();
  });

  it('demande confirmation avant de supprimer un partenaire', async () => {
    wrap();
    await screen.findByText('Babolat');
    // clic sur « Supprimer » de la 1re ligne : rien ne part encore
    fireEvent.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]);
    expect(mocked.adminDeleteSponsor).not.toHaveBeenCalled();
    // le dialog de confirmation apparaît avec son propre bouton « Supprimer » (le dernier)
    const buttons = screen.getAllByRole('button', { name: 'Supprimer' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(mocked.adminDeleteSponsor).toHaveBeenCalledWith('c1', 'sp-1', 't'));
    await waitFor(() => expect(mocked.adminGetSponsors).toHaveBeenCalledTimes(2));
  });

  it('annuler la confirmation ne supprime rien', async () => {
    wrap();
    await screen.findByText('Babolat');
    fireEvent.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(mocked.adminDeleteSponsor).not.toHaveBeenCalled();
  });
});
