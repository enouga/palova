import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingModal from '../components/BookingModal';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot, MemberPackage, Subscription } from '../lib/api';

jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'club-demo', club: null, loading: false }),
}));
jest.mock('../lib/api', () => ({
  api: {
    holdSlot:           jest.fn(),
    confirmReservation: jest.fn(),
    cancelReservation:  jest.fn(),
    applyHoldSetup:     jest.fn().mockResolvedValue({}),
    listClubFriends:    jest.fn().mockResolvedValue([]),
    getMyRating:        jest.fn().mockResolvedValue(null),
    getMyReservations:  jest.fn().mockResolvedValue([]),
    getClubPage:        jest.fn().mockResolvedValue({}),
  },
  assetUrl: (u: string | null) => u,
}));

const mockSlot: TimeSlot = {
  startTime: '2025-06-15T06:00:00.000Z', endTime: '2025-06-15T07:00:00.000Z',
  available: true, price: '25', offPeak: false,
};
const carnet = {
  id: 'pkg-1', kind: 'ENTRIES', creditsRemaining: 7, amountRemaining: null, expiresAt: null,
} as unknown as MemberPackage;
const wallet2 = {
  id: 'pkg-2', kind: 'WALLET', creditsRemaining: null, amountRemaining: '10.00', expiresAt: null,
} as unknown as MemberPackage;
const sub = {
  id: 'sub-1', benefit: 'INCLUDED', discountPercent: null, sportKeys: ['padel'], offPeakOnly: false,
} as unknown as Subscription;
// Soldes portant un sport (via template.sportKeys) : le filtre d'affichage par sport s'appuie dessus.
const tennisWallet = {
  id: 'pkg-tennis', kind: 'WALLET', creditsRemaining: null, amountRemaining: '50.00', expiresAt: null,
  template: { name: 'Tennis', sportKeys: ['tennis'] },
} as unknown as MemberPackage;
const allSportsWallet = {
  id: 'pkg-all', kind: 'WALLET', creditsRemaining: null, amountRemaining: '50.00', expiresAt: null,
  template: { name: 'Tous sports', sportKeys: [] },
} as unknown as MemberPackage;

function renderModal(overrides: Partial<React.ComponentProps<typeof BookingModal>> = {}) {
  return render(
    <ThemeProvider>
      <BookingModal slot={mockSlot} resourceId="court-1" price="25" duration={60}
        token="jwt" onClose={jest.fn()} onConfirmed={jest.fn()} {...overrides} />
    </ThemeProvider>
  );
}

describe('BookingModal — paiement replié (défaut intelligent)', () => {
  beforeEach(() => {
    jest.clearAllMocks(); localStorage.clear();
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
  });

  it('sans abo ni carnet : « Régler au club » replié, CTA « Confirmer la réservation »', async () => {
    renderModal();
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText('Régler au club')).toBeInTheDocument();
    expect(screen.queryByText('Payer en ligne')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmer la réservation/ })).toBeInTheDocument();
  });

  it('abonnement couvrant : pré-choisi replié, CTA abonnement', async () => {
    renderModal({ sportKey: 'padel', subscriptions: [sub], packages: [carnet] });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText('Couvert par votre abonnement')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmer avec mon abonnement/ })).toBeInTheDocument();
  });

  it('sans abo, carnet couvrant : pré-choisi replié, CTA solde', async () => {
    renderModal({ packages: [carnet] });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText(/Carnet — 7 entrées/)).toBeInTheDocument();
    expect(screen.getByText(/il restera 6 entrées/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmer avec mon solde/ })).toBeInTheDocument();
  });

  it('porte-monnaie insuffisant (10 € < 25 €) : jamais pré-choisi → « Régler au club »', async () => {
    renderModal({ packages: [wallet2] });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText('Régler au club')).toBeInTheDocument();
  });

  it('« changer » déplie les avenues existantes (gating inchangé)', async () => {
    renderModal({ packages: [carnet], stripeActive: true });
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('button', { name: /changer/ }));
    expect(screen.getByText('Régler au club')).toBeInTheDocument();
    expect(screen.getByText('Payer en ligne')).toBeInTheDocument();
    expect(screen.getByText(/Carnet — 7 entrées/)).toBeInTheDocument();
    expect(screen.queryByText('Couvert par votre abonnement')).not.toBeInTheDocument();
  });

  it('sans alternative (ni abo, ni carnet, ni Stripe) : pas de bouton « changer »', async () => {
    renderModal();
    await screen.findByText(/Créneau bloqué/);
    expect(screen.queryByRole('button', { name: /changer/ })).not.toBeInTheDocument();
  });

  it('paiement en ligne imposé : « Payer en ligne » replié + part du joueur', async () => {
    renderModal({ requireOnlinePayment: true, stripeActive: true, sportKey: 'padel', format: 'double', maxPlayers: 4, slug: 'club-demo' });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText('Payer en ligne')).toBeInTheDocument();
    expect(screen.getByText(/Votre part : 6,25\s*€/)).toBeInTheDocument();
  });

  it('INSUFFICIENT_BALANCE à la confirmation : déplie et désélectionne le carnet', async () => {
    (api.confirmReservation as jest.Mock).mockRejectedValue(new Error('INSUFFICIENT_BALANCE'));
    renderModal({ packages: [carnet] });
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('button', { name: /Confirmer avec mon solde/ }));
    expect(await screen.findByText(/Solde insuffisant/)).toBeInTheDocument();
    expect(screen.getByText('Régler au club')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmer la réservation/ })).toBeInTheDocument();
  });

  it('solde limité à un autre sport : masqué sur un terrain padel (ni avenue, ni défaut, ni « changer »)', async () => {
    renderModal({ sportKey: 'padel', packages: [tennisWallet] });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText('Régler au club')).toBeInTheDocument();
    expect(screen.queryByText(/Porte-monnaie/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /changer/ })).not.toBeInTheDocument();
  });

  it('solde limité au bon sport : visible et pré-choisi', async () => {
    renderModal({ sportKey: 'tennis', packages: [tennisWallet] });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText(/Porte-monnaie — 50,00 €/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmer avec mon solde/ })).toBeInTheDocument();
  });

  it('solde tous sports (sportKeys vide) : visible quel que soit le sport', async () => {
    renderModal({ sportKey: 'padel', packages: [allSportsWallet] });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText(/Porte-monnaie — 50,00 €/)).toBeInTheDocument();
  });
});
