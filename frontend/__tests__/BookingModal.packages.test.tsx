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
    getMyReservations:  jest.fn().mockResolvedValue([]),
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
  expiresAt: null, template: { name: '10 entrées', sportKeys: [] },
};

const poorWallet: MemberPackage = {
  id: 'w-1', kind: 'WALLET', creditsTotal: null, creditsRemaining: null,
  amountTotal: '10.00', amountRemaining: '10.00', purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt: null, template: { name: 'Porte-monnaie', sportKeys: [] },
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

    // Le carnet couvrant est pré-choisi par défaut (défaut intelligent) → CTA « mon solde » d'emblée.
    fireEvent.click(await screen.findByRole('button', { name: /Confirmer avec mon solde/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', { paymentSource: { packageId: 'pkg-1' } });
    });
  });

  it('confirme sans paymentSource si « Régler au club » reste sélectionné', async () => {
    renderWithPackages([pkg]);

    // Le carnet est pré-choisi ; on déplie (« changer ») pour repasser sur « Régler au club ».
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('button', { name: /changer/ }));
    fireEvent.click(screen.getByRole('button', { name: /Régler au club/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', undefined);
    });
  });

  it('solde insuffisant : reste en held, message affiché, retombe sur « Régler au club »', async () => {
    (api.confirmReservation as jest.Mock).mockRejectedValueOnce(new Error('INSUFFICIENT_BALANCE'));
    renderWithPackages([pkg]);

    // Le carnet couvrant est pré-choisi → confirmation directe avec « mon solde ».
    fireEvent.click(await screen.findByRole('button', { name: /Confirmer avec mon solde/ }));

    expect(await screen.findByText(/Solde insuffisant/)).toBeInTheDocument();
    // toujours en phase held : le bouton de confirmation standard est revenu
    expect(screen.getByRole('button', { name: /Confirmer la réservation/ })).toBeInTheDocument();
  });

  it('affiche le solde restant projeté à la sélection du carnet', async () => {
    renderWithPackages([pkg]);
    // Le carnet couvrant est pré-choisi → la ligne repliée montre déjà le restant projeté.
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText(/il restera 6 entrées/)).toBeInTheDocument();
  });

  it('porte-monnaie insuffisant : puce désactivée + mention « solde insuffisant »', async () => {
    renderWithPackages([poorWallet]);
    // Le porte-monnaie ne couvre pas → défaut « Régler au club » ; on déplie pour voir la puce.
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('button', { name: /changer/ }));
    expect(screen.getByRole('button', { name: /Porte-monnaie/ })).toBeDisabled();
    expect(screen.getByText(/solde insuffisant/)).toBeInTheDocument();
  });

  it('confirme avec un carnet → onConfirmed reçoit le résumé du solde restant', async () => {
    const onConfirmed = jest.fn();
    render(
      <ThemeProvider>
        <BookingModal slot={mockSlot} resourceId="court-1" price="25" duration={60}
          token="jwt-token" packages={[pkg]} onClose={jest.fn()} onConfirmed={onConfirmed} />
      </ThemeProvider>,
    );
    // Le carnet couvrant est pré-choisi par défaut → confirmation directe avec « mon solde ».
    fireEvent.click(await screen.findByRole('button', { name: /Confirmer avec mon solde/ }));
    // L'écran de succès s'affiche ; onConfirmed (avec le résumé du solde) n'est émis qu'au « Terminé ».
    fireEvent.click(await screen.findByRole('button', { name: /Terminé/ }));
    await waitFor(() => {
      expect(onConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'res-1' }),
        { label: 'Payé avec votre carnet · 6 entrées restantes' },
      );
    });
  });
});
