import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingModal from '../components/BookingModal';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot } from '../lib/api';

let mockClub: { levelSystemEnabled?: boolean } | null = null;
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'club-demo', club: mockClub, loading: false }),
}));

jest.mock('../lib/api', () => ({
  api: {
    holdSlot:           jest.fn(),
    confirmReservation: jest.fn(),
    cancelReservation:  jest.fn(),
    searchClubMembers:  jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

const mockSlot: TimeSlot = {
  startTime: '2025-06-15T06:00:00.000Z',
  endTime:   '2025-06-15T07:00:00.000Z',
  available: true,
  price: '25',
  offPeak: false,
};

function renderModal(overrides: Partial<React.ComponentProps<typeof BookingModal>> = {}) {
  return render(
    <ThemeProvider>
      <BookingModal
        slot={mockSlot}
        resourceId="court-1"
        price="25"
        duration={60}
        token="jwt-token"
        onClose={jest.fn()}
        onConfirmed={jest.fn()}
        {...overrides}
      />
    </ThemeProvider>
  );
}

describe('BookingModal', () => {
  beforeEach(() => { jest.clearAllMocks(); mockClub = null; });

  it('appelle holdSlot et affiche le countdown après clic Pré-réserver', async () => {
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Pré-réserver/ }));

    await waitFor(() =>
      expect(api.holdSlot).toHaveBeenCalledWith(
        { resourceId: 'court-1', startTime: mockSlot.startTime, endTime: mockSlot.endTime },
        'jwt-token',
      )
    );
    expect(await screen.findByText(/Confirmez dans/)).toBeInTheDocument();
  });

  it('appelle confirmReservation et onConfirmed après confirmation finale', async () => {
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });

    const onConfirmed = jest.fn();
    renderModal({ onConfirmed });

    fireEvent.click(screen.getByRole('button', { name: /Pré-réserver/ }));
    await screen.findByText(/Confirmez dans/);
    fireEvent.click(screen.getByRole('button', { name: /Confirmer et payer/ }));

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
  });

  it('annule le hold (libère le créneau) au clic Abandonner en phase pending', async () => {
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });

    const onClose = jest.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole('button', { name: /Pré-réserver/ }));
    await screen.findByText(/Confirmez dans/);
    fireEvent.click(screen.getByRole('button', { name: /Abandonner/ }));

    await waitFor(() => expect(api.cancelReservation).toHaveBeenCalledWith('res-1', 'jwt-token'));
    expect(onClose).toHaveBeenCalled();
  });

  it('affiche un message d erreur si holdSlot échoue', async () => {
    (api.holdSlot as jest.Mock).mockRejectedValue(new Error('SLOT_ALREADY_HELD'));

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Pré-réserver/ }));

    await waitFor(() => expect(screen.getByText(/vient d'être pris/)).toBeInTheDocument());
  });

  it('partie ouverte : ajoute un partenaire, affiche le prix par joueur et transmet partnerUserIds + visibility', async () => {
    (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'user-2', firstName: 'Marc', lastName: 'Dupont' }]);
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });

    renderModal({ slug: 'club-demo', maxPlayers: 4 });

    // ouvrir l'annuaire des membres et sélectionner un partenaire
    fireEvent.focus(screen.getByPlaceholderText(/membres/i));
    fireEvent.mouseDown(await screen.findByText('Marc Dupont'));

    // basculer en partie ouverte
    fireEvent.click(screen.getByRole('button', { name: /Partie ouverte/ }));

    // récap prix par joueur : 25 € / 2 joueurs = 12,50 €
    expect(screen.getByText(/12,50\s*€\s*par joueur/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Pré-réserver/ }));
    await waitFor(() => expect(api.holdSlot).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'court-1', partnerUserIds: ['user-2'], visibility: 'PUBLIC' }),
      'jwt-token',
    ));
  });

  it('partie ouverte : masque la fourchette de niveau cible quand le système de niveau est OFF, et n envoie pas targetLevel*', async () => {
    mockClub = { levelSystemEnabled: false };
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });

    renderModal({ slug: 'club-demo', maxPlayers: 4 });
    fireEvent.click(screen.getByRole('button', { name: /Partie ouverte/ }));

    expect(screen.queryByLabelText(/Niveau min/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Niveau max/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Pré-réserver/ }));
    await waitFor(() => expect(api.holdSlot).toHaveBeenCalled());
    const payload = (api.holdSlot as jest.Mock).mock.calls[0][0];
    expect(payload).not.toHaveProperty('targetLevelMin');
    expect(payload).not.toHaveProperty('targetLevelMax');
  });

  it('partie ouverte : affiche la fourchette de niveau cible quand le système de niveau est ON', () => {
    mockClub = { levelSystemEnabled: true };
    renderModal({ slug: 'club-demo', maxPlayers: 4 });
    fireEvent.click(screen.getByRole('button', { name: /Partie ouverte/ }));

    expect(screen.getByLabelText(/Niveau min/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Niveau max/)).toBeInTheDocument();
  });

  it('sans slug (mode simple), n envoie ni partnerUserIds ni visibility', async () => {
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Pré-réserver/ }));

    await waitFor(() => expect(api.holdSlot).toHaveBeenCalledWith(
      { resourceId: 'court-1', startTime: mockSlot.startTime, endTime: mockSlot.endTime },
      'jwt-token',
    ));
  });
});
