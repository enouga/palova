import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReservationPlayersInline } from '../components/reservations/ReservationPlayersInline';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    addReservationPlayer: jest.fn().mockResolvedValue({ id: 'r1', capacity: 4, participants: [] }),
    removeReservationPlayer: jest.fn().mockResolvedValue({ id: 'r1', capacity: 4, participants: [] }),
    setReservationTeams: jest.fn().mockResolvedValue({ id: 'r1', capacity: 4, participants: [] }),
    searchClubMembers: jest.fn().mockResolvedValue([]),
    listClubFriends: jest.fn().mockResolvedValue([]),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const now = Date.now();
const future = new Date(now + 48 * 3600e3).toISOString();

const resa = (over: Record<string, unknown> = {}) => ({
  id: 'r1', startTime: future, endTime: future, status: 'CONFIRMED', totalPrice: '25',
  resource: { id: 'res1', name: 'Terrain 1', club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
  capacity: 4,
  participants: [
    { id: 'p-org', userId: 'u-org', isOrganizer: true, firstName: 'Org', lastName: 'A', avatarUrl: null },
    { id: 'p2', userId: 'u2', isOrganizer: false, firstName: 'Ines', lastName: 'B', avatarUrl: null },
  ],
  ...over,
}) as never;

const wrap = (over = {}, onChanged = () => {}) =>
  render(<ThemeProvider><ReservationPlayersInline reservation={resa(over)} token="abc" now={now} onChanged={onChanged} /></ThemeProvider>);

describe('ReservationPlayersInline', () => {
  beforeEach(() => jest.clearAllMocks());

  it('affiche un × de retrait sur un joueur non-organisateur, mais pas sur l’organisateur (édition ouverte)', () => {
    wrap();
    expect(screen.getByRole('button', { name: 'Retirer Ines B' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirer Org A' })).not.toBeInTheDocument();
  });

  it('montre le bouton « Ajouter un joueur » quand il reste une place et que l’édition est ouverte, et ajoute via la recherche', async () => {
    mocked.searchClubMembers.mockResolvedValue([{ id: 'u-new', firstName: 'New', lastName: 'Player' }] as never);
    const onChanged = jest.fn();
    wrap({}, onChanged);
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un joueur/ }));
    fireEvent.focus(screen.getByPlaceholderText(/membres/i));
    fireEvent.mouseDown(await screen.findByText('New Player'));
    await waitFor(() => expect(mocked.addReservationPlayer).toHaveBeenCalledWith('r1', 'u-new', 'abc'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('retire un joueur via le ×', async () => {
    const onChanged = jest.fn();
    wrap({}, onChanged);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Ines B' }));
    await waitFor(() => expect(mocked.removeReservationPlayer).toHaveBeenCalledWith('r1', 'p2', 'abc'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('quand l’édition est fermée (résa non confirmée), ni bouton d’ajout ni ×', () => {
    wrap({ status: 'PENDING' });
    expect(screen.queryByRole('button', { name: /Ajouter un joueur/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirer Ines B' })).not.toBeInTheDocument();
  });
});
