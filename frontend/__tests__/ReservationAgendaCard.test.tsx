import { render, screen, fireEvent } from '@testing-library/react';
import { ReservationAgendaCard } from '../components/reservations/ReservationAgendaCard';
import { ThemeProvider } from '../lib/ThemeProvider';
import { MyReservation } from '../lib/api';

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    addReservationPlayer: jest.fn().mockResolvedValue({ id: 'r1', capacity: 4, participants: [] }),
    removeReservationPlayer: jest.fn().mockResolvedValue({ id: 'r1', capacity: 4, participants: [] }),
    setReservationTeams: jest.fn().mockResolvedValue({ id: 'r1', capacity: 4, participants: [] }),
    searchClubMembers: jest.fn().mockResolvedValue([]),
    listClubFriends: jest.fn().mockResolvedValue([]),
    setReservationVisibility: jest.fn().mockResolvedValue({ id: 'r1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
  },
}));

const now = Date.now();
const future = new Date(now + 48 * 3600e3).toISOString();
const futureEnd = new Date(now + 48 * 3600e3 + 3600e3).toISOString();
const past = new Date(now - 48 * 3600e3).toISOString();
const pastEnd = new Date(now - 48 * 3600e3 + 3600e3).toISOString();

function mkRes(over: Record<string, unknown> = {}): MyReservation {
  return {
    id: 'r1', startTime: future, endTime: futureEnd, status: 'CONFIRMED', totalPrice: '25',
    resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Padel Arena', slug: 'demo', timezone: 'Europe/Paris' } },
    capacity: 4,
    participants: [
      { id: 'p-org', userId: 'u-org', isOrganizer: true, firstName: 'Org', lastName: 'A', avatarUrl: null },
    ],
    ...over,
  } as MyReservation;
}

function renderCard(over: Partial<React.ComponentProps<typeof ReservationAgendaCard>> = {}) {
  return render(
    <ThemeProvider>
      <ReservationAgendaCard
        reservation={mkRes()} past={false} token="abc" now={now}
        onCancel={jest.fn()} onPlayersChanged={jest.fn()} onOpenChat={jest.fn()}
        {...over}
      />
    </ThemeProvider>,
  );
}

describe('ReservationAgendaCard', () => {
  it('à venir, privée : chip "N places", Annuler actif, pas de Discuter/Partager', () => {
    renderCard();
    expect(screen.getByText('3 places')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Discuter/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Partager/ })).not.toBeInTheDocument();
  });

  it('complet : chip "Complet"', () => {
    const full = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, userId: `u${i}`, isOrganizer: i === 0, firstName: 'P', lastName: `${i}`, avatarUrl: null }));
    renderCard({ reservation: mkRes({ participants: full }) });
    expect(screen.getByText('Complet')).toBeInTheDocument();
  });

  it('passée : pas de chip de places', () => {
    renderCard({ reservation: mkRes({ startTime: past, endTime: pastEnd }), past: true });
    expect(screen.queryByText(/^\d+ places?$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Complet')).not.toBeInTheDocument();
  });

  it('partie ouverte publique à venir : chip niveau + Discuter (appelle onOpenChat) + Partager', () => {
    const onOpenChat = jest.fn();
    renderCard({
      reservation: mkRes({ visibility: 'PUBLIC', targetLevelMin: 4.2, targetLevelMax: 6.8 }),
      onOpenChat,
    });
    expect(screen.getByText('Niveau 4,2 à 6,8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Discuter/ }));
    expect(onOpenChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    expect(screen.getByRole('button', { name: /Partager/ })).toBeInTheDocument();
  });

  it('partie privée : pas de Discuter/Partager même à venir', () => {
    renderCard({ reservation: mkRes({ visibility: 'PRIVATE' }) });
    expect(screen.queryByRole('button', { name: /Discuter/ })).not.toBeInTheDocument();
  });

  it('sans token : pas de Discuter/Partager même publique', () => {
    renderCard({ reservation: mkRes({ visibility: 'PUBLIC' }), token: null });
    expect(screen.queryByRole('button', { name: /Discuter/ })).not.toBeInTheDocument();
  });

  it('passée, résultat déjà enregistré : libellé de statut, pas de bouton Saisir le résultat', () => {
    renderCard({
      reservation: mkRes({ startTime: past, endTime: pastEnd }), past: true,
      existingMatchStatus: 'CONFIRMED', canRecord: () => false,
    });
    expect(screen.getByText('Résultat enregistré')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Saisir le résultat/ })).not.toBeInTheDocument();
  });

  it('passée, saisie possible : bouton Saisir le résultat déclenche onRecordResult', () => {
    const onRecordResult = jest.fn();
    renderCard({
      reservation: mkRes({ startTime: past, endTime: pastEnd }), past: true,
      canRecord: () => true, onRecordResult,
    });
    fireEvent.click(screen.getByRole('button', { name: /Saisir le résultat/ }));
    expect(onRecordResult).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });

  it('affiche le chip sport quand showSport', () => {
    renderCard({ showSport: true });
    expect(screen.getByText('Padel')).toBeInTheDocument();
  });

  it('showDate ajoute la date devant l’heure (utilisé par la vue liste, pas le Calendrier)', () => {
    renderCard({ showDate: true });
    expect(screen.getByText(/· \d{2}h\d{2}–\d{2}h\d{2}/)).toBeInTheDocument();
  });

  it('avec clubMarker : le nom du club devient une chip (span), une seule occurrence', () => {
    renderCard({ clubMarker: { name: 'Padel Arena', accent: '#34b27b' } });
    const els = screen.getAllByText('Padel Arena');
    expect(els).toHaveLength(1);
    expect(els[0].tagName).toBe('SPAN'); // pastille Chip, plus le <div> sous-titre texte
  });

  it('sans clubMarker : sous-titre texte inchangé (non-régression)', () => {
    renderCard();
    expect(screen.getByText('Padel Arena').tagName).toBe('DIV');
  });
});
