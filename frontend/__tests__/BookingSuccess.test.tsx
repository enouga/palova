import { render, screen, fireEvent } from '@testing-library/react';
import { BookingSuccess } from '../components/booking/BookingSuccess';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    getMyReservations:        jest.fn().mockResolvedValue([]),
    setReservationVisibility: jest.fn(),
    setReservationTeams:      jest.fn(),
    addReservationPlayer:     jest.fn(),
    removeReservationPlayer:  jest.fn(),
    searchClubMembers:        jest.fn().mockResolvedValue([]),
    listClubFriends:          jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));

const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const slot: TimeSlot = { startTime: future, endTime: future, available: true, price: '25', offPeak: false };

const myResa = {
  id: 'res-1', startTime: future, endTime: future, status: 'CONFIRMED', totalPrice: '25',
  resource: { id: 'court-1', name: 'Court 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Club', slug: 'club-demo', timezone: 'Europe/Paris' } },
  capacity: 4, visibility: 'PRIVATE',
  participants: [{ id: 'p1', userId: 'u1', isOrganizer: true, firstName: 'Alice', lastName: 'Org', avatarUrl: null }],
};

function renderSuccess(overrides: Partial<React.ComponentProps<typeof BookingSuccess>> = {}) {
  return render(
    <ThemeProvider>
      <BookingSuccess reservationId="res-1" token="jwt" summary="À régler au club"
        slot={slot} timezone="Europe/Paris" resourceName="Court 1" duration={60}
        showPartners onDone={jest.fn()} {...overrides} />
    </ThemeProvider>
  );
}

describe('BookingSuccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.getMyReservations as jest.Mock).mockResolvedValue([myResa]);
  });

  it('affiche la confirmation, le récap paiement et « Terminé » (onDone)', async () => {
    const onDone = jest.fn();
    renderSuccess({ onDone });
    expect(screen.getByText(/Réservation confirmée/)).toBeInTheDocument();
    expect(screen.getByText(/À régler au club/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Terminé/ }));
    expect(onDone).toHaveBeenCalled();
  });

  it('showPartners → charge la résa et rend le bloc d organisation (équipes + ouvrir la partie)', async () => {
    renderSuccess();
    expect(await screen.findByText(/Organisez votre partie/i)).toBeInTheDocument();
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ouvrir la partie/ })).toBeInTheDocument();
    expect(api.getMyReservations).toHaveBeenCalledWith('jwt');
  });

  it('showPartners=false → pas de fetch ni de bloc d organisation', async () => {
    renderSuccess({ showPartners: false });
    expect(screen.getByText(/Réservation confirmée/)).toBeInTheDocument();
    expect(api.getMyReservations).not.toHaveBeenCalled();
    expect(screen.queryByText(/Organisez votre partie/i)).not.toBeInTheDocument();
  });

  it('échec du fetch → lien « Gérer ma réservation » (jamais d écran d erreur)', async () => {
    (api.getMyReservations as jest.Mock).mockRejectedValue(new Error('NETWORK'));
    renderSuccess();
    expect(await screen.findByRole('link', { name: /Gérer ma réservation/ })).toHaveAttribute('href', '/me/reservations');
    expect(screen.getByText(/Réservation confirmée/)).toBeInTheDocument();
  });

  it('résa introuvable dans la liste → même repli lien', async () => {
    (api.getMyReservations as jest.Mock).mockResolvedValue([]);
    renderSuccess();
    expect(await screen.findByRole('link', { name: /Gérer ma réservation/ })).toBeInTheDocument();
  });
});
