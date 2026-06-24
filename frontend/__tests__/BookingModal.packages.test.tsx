import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingModal from '../components/BookingModal';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot, MemberPackage } from '../lib/api';

let mockClub: { levelSystemEnabled?: boolean } | null = null;
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'club-demo', club: mockClub, loading: false }),
}));

jest.mock('../lib/api', () => ({
  api: {
    holdSlot:           jest.fn(),
    confirmReservation: jest.fn(),
    cancelReservation:  jest.fn(),
    applyHoldSetup:     jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }),
    searchClubMembers:  jest.fn(),
    getMyRating:        jest.fn().mockResolvedValue(null),
    getClubPage:        jest.fn().mockResolvedValue({}),
  },
  assetUrl: (u: string | null) => u,
}));

const mockSlot: TimeSlot = {
  startTime: '2026-06-15T06:00:00.000Z',
  endTime:   '2026-06-15T07:00:00.000Z',
  available: true,
  price: '25',
  offPeak: false,
};

const pkg: MemberPackage = {
  id: 'pkg-1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 7,
  amountTotal: null, amountRemaining: null, purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt: null, template: { name: '10 entrées' },
};

function renderWithPackages(packages: MemberPackage[]) {
  render(
    <ThemeProvider>
      <BookingModal
        slot={mockSlot}
        resourceId="court-1"
        price="25"
        duration={60}
        token="jwt-token"
        packages={packages}
        onClose={jest.fn()}
        onConfirmed={jest.fn()}
      />
    </ThemeProvider>,
  );
}

describe('BookingModal — paiement par carnet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClub = null;
    localStorage.clear();
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
  });

  it('propose le carnet en phase held et confirme avec paymentSource', async () => {
    renderWithPackages([pkg]);

    // Le hold est automatique — attendre que le contenu interactif apparaisse
    fireEvent.click(await screen.findByRole('button', { name: /Carnet — 7 entrées/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer avec mon solde/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', { paymentSource: { packageId: 'pkg-1' } });
    });
  });

  it('confirme sans paymentSource si « Régler au club » reste sélectionné', async () => {
    renderWithPackages([pkg]);

    // Attendre la phase held
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByRole('button', { name: /Régler au club/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', undefined);
    });
  });

  it('solde insuffisant : reste en held, message affiché, retombe sur « Régler au club »', async () => {
    (api.confirmReservation as jest.Mock).mockRejectedValueOnce(new Error('INSUFFICIENT_BALANCE'));
    renderWithPackages([pkg]);

    // Attendre la phase held
    fireEvent.click(await screen.findByRole('button', { name: /Carnet — 7 entrées/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer avec mon solde/ }));

    expect(await screen.findByText(/Solde insuffisant/)).toBeInTheDocument();
    // toujours en phase held : le bouton de confirmation standard est revenu
    expect(screen.getByRole('button', { name: /Confirmer la réservation/ })).toBeInTheDocument();
  });
});
