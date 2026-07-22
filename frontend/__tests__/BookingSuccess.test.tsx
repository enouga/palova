import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BookingSuccess } from '../components/booking/BookingSuccess';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    getMyReservations:        jest.fn().mockResolvedValue([]),
    setReservationVisibility: jest.fn().mockResolvedValue({ id: 'res-1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
    setReservationTeams:      jest.fn(),
    addReservationPlayer:     jest.fn(),
    removeReservationPlayer:  jest.fn(),
    searchClubMembers:        jest.fn().mockResolvedValue([]),
    listClubFriends:          jest.fn().mockResolvedValue([]),
    getMyRating:              jest.fn().mockResolvedValue(null),
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

  it('showPartners → charge la résa et rend le bloc d organisation (équipes + interrupteur partie ouverte)', async () => {
    renderSuccess();
    expect(await screen.findByText(/Organisez votre partie/i)).toBeInTheDocument();
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: /Partie ouverte aux membres/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('button', { name: /Ouvrir la partie/ })).not.toBeInTheDocument();
    expect(api.getMyReservations).toHaveBeenCalledWith('jwt');
  });

  it('bascule l interrupteur « Partie ouverte » → appelle setReservationVisibility PUBLIC', async () => {
    renderSuccess();
    const sw = await screen.findByRole('switch', { name: /Partie ouverte aux membres/ });
    fireEvent.click(sw);
    // Pas de préférence mémorisée ni de niveau connu (getMyRating → null) : OpenMatchQuickSwitch
    // garde ses valeurs par défaut (limiter le niveau ON, fourchette 3–5).
    await waitFor(() => expect(api.setReservationVisibility).toHaveBeenCalledWith(
      'res-1', 'PUBLIC', 'jwt', { targetLevelMin: 3, targetLevelMax: 5, matchGender: null },
    ));
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
