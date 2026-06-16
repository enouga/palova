import { render, screen, fireEvent } from '@testing-library/react';
import { DayPanel } from '../components/calendar/DayPanel';
import { ThemeProvider } from '../lib/ThemeProvider';
import { buildCalendarEntries } from '../lib/calendar';
import { MyReservation, MyTournamentRegistration, MyEventRegistration } from '../lib/api';

// startTime in the future so isCancellationOpen returns true (no cutoff configured).
const futureStart = (() => { const d = new Date(Date.now() + 48 * 3600e3); d.setUTCHours(16, 0, 0, 0); return d.toISOString(); })();
const futureEnd   = (() => { const d = new Date(Date.now() + 48 * 3600e3); d.setUTCHours(17, 30, 0, 0); return d.toISOString(); })();

const reservation: MyReservation = {
  id: 'res-1',
  startTime: futureStart,
  endTime: futureEnd,
  status: 'CONFIRMED',
  totalPrice: '37.50',
  resource: { id: 'court-1', name: 'Court 1', club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris' } },
  capacity: 4,
  participants: [],
};

const registration = {
  id: 'reg-1',
  status: 'CONFIRMED',
  createdAt: '2026-06-01T10:00:00.000Z',
  captain: { id: 'u1', firstName: 'Eric', lastName: 'N', email: 'e@x.fr', phone: null },
  partner: { id: 'u2', firstName: 'Marc', lastName: 'Dupont', email: 'm@x.fr', phone: null },
  captainLicense: null,
  partnerLicense: null,
  tournament: {
    id: 't-1', clubId: 'club-demo', clubSportId: 'cs-1', name: 'P100 Messieurs', category: 'P100',
    gender: 'MEN', description: null,
    startTime: '2026-06-13T07:00:00.000Z', endTime: '2026-06-14T16:00:00.000Z',
    registrationDeadline: '2026-06-11T22:00:00.000Z', maxTeams: 16, entryFee: null,
    status: 'PUBLISHED', confirmedCount: 4, waitlistCount: 0,
    club: { slug: 'padel-arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
  },
} as MyTournamentRegistration;

const eventReg = {
  id: 'evt-1',
  status: 'CONFIRMED',
  event: {
    id: 'ev-1', clubId: 'club-demo', name: 'Mêlée du vendredi', kind: 'MELEE', description: null,
    startTime: '2026-06-12T17:00:00.000Z', endTime: '2026-06-12T20:00:00.000Z',
    registrationDeadline: '2026-06-12T12:00:00.000Z', capacity: 16, price: null, memberOnly: false,
    status: 'PUBLISHED', confirmedCount: 6, waitlistCount: 0,
    club: { slug: 'padel-arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
  },
} as MyEventRegistration;

const NOW = new Date('2026-06-10T12:00:00.000Z');
const entries = buildCalendarEntries([reservation], [registration], [], NOW);

function renderPanel(props: Partial<React.ComponentProps<typeof DayPanel>> = {}) {
  return render(
    <ThemeProvider>
      <DayPanel
        dayKey="2026-06-12" entries={entries} localSlug={null}
        onCancel={jest.fn()}
        onReserve={jest.fn()} reserveLabel="Réserver un créneau" {...props}
      />
    </ThemeProvider>,
  );
}

describe('DayPanel', () => {
  it('affiche la carte réservation avec terrain, horaires et prix', () => {
    renderPanel();
    expect(screen.getByText('Court 1')).toBeInTheDocument();
    expect(screen.getByText(/18h00/)).toBeInTheDocument(); // 16h UTC = 18h Paris
    expect(screen.getByText(/37.5/)).toBeInTheDocument();
  });

  it('déclenche onCancel depuis la carte réservation', () => {
    const onCancel = jest.fn();
    renderPanel({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onCancel).toHaveBeenCalledWith(reservation);
  });

  it('ne propose jamais « Déplacer » (fonctionnalité retirée), garde « Annuler »', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Déplacer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('affiche la carte tournoi avec un lien Gérer vers la page du tournoi (sous-domaine club)', () => {
    renderPanel();
    expect(screen.getByText('P100 Messieurs')).toBeInTheDocument();
    expect(screen.getByText(/Marc Dupont/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Gérer/ })).toHaveAttribute('href', expect.stringContaining('/tournois/t-1'));
  });

  it('affiche la carte event avec un lien Voir vers la fiche event (sous-domaine club)', () => {
    renderPanel({ entries: buildCalendarEntries([], [], [eventReg], NOW), dayKey: '2026-06-12' });
    expect(screen.getByText('Mêlée du vendredi')).toBeInTheDocument();
    expect(screen.getByText(/Mêlée · Padel Arena/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voir/ })).toHaveAttribute('href', expect.stringContaining('/events/ev-1'));
  });

  it('jour vide : message + bouton réserver', () => {
    const onReserve = jest.fn();
    renderPanel({ entries: [], onReserve });
    expect(screen.getByText(/Rien ce jour-là/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réserver un créneau' }));
    expect(onReserve).toHaveBeenCalled();
  });

  it('résa d un AUTRE club (localSlug différent) : pas d actions, mais un lien vers l app du club', () => {
    renderPanel({ entries: buildCalendarEntries([reservation], [], [], NOW), localSlug: 'un-autre-club' });
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Joueurs' })).toBeNull();
    expect(screen.getByRole('link', { name: /Voir/ })).toHaveAttribute('href', expect.stringContaining('/me/reservations'));
  });

  it('ne propose pas d actions sur une réservation passée', () => {
    const pastRes = { ...reservation, startTime: '2026-06-01T16:00:00.000Z', endTime: '2026-06-01T17:00:00.000Z' };
    renderPanel({ entries: buildCalendarEntries([pastRes], [], [], NOW) });
    expect(screen.queryByRole('button', { name: 'Déplacer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  });

  it('affiche les pastilles joueurs et les places libres pour une réservation', () => {
    const future = new Date(Date.now() + 48 * 3600e3).toISOString();
    const resWithPlayers: MyReservation = {
      id: 'res-pills',
      startTime: future,
      endTime: future,
      status: 'CONFIRMED',
      totalPrice: '25',
      capacity: 4,
      participants: [
        { id: 'p1', userId: 'u-org',  firstName: 'Org',  lastName: 'A',       avatarUrl: null, isOrganizer: true },
        { id: 'p2', userId: 'u-emma', firstName: 'Emma', lastName: 'Bernard', avatarUrl: null, isOrganizer: false },
      ],
      resource: { id: 'court-1', name: 'Terrain 2', club: { name: 'Bordeaux Pala', slug: 'bordeaux-pala', timezone: 'Europe/Paris' } },
    };
    renderPanel({
      entries: buildCalendarEntries([resWithPlayers], [], [], NOW),
      dayKey: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(future)),
      localSlug: 'bordeaux-pala',
      onManagePlayers: jest.fn(),
    });
    expect(screen.getByText('Terrain 2')).toBeInTheDocument();
    expect(screen.getByText('Org A')).toBeInTheDocument();
    expect(screen.getByText('Emma Bernard')).toBeInTheDocument();
    expect(screen.getAllByText('Place libre')).toHaveLength(2);
  });
});
