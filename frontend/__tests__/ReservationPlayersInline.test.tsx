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
    setReservationVisibility: jest.fn().mockResolvedValue({ id: 'r1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
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

  // Chemin padel : MatchTeams (terrain) + feuilles.
  const padel = {
    resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
  };

  it("padel : tap joueur → feuille d'actions → Retirer", async () => {
    const onChanged = jest.fn();
    wrap(padel, onChanged);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Ines B' }));
    fireEvent.click(screen.getByRole('button', { name: /Retirer de la partie/ }));
    await waitFor(() => expect(mocked.removeReservationPlayer).toHaveBeenCalledWith('r1', 'p2', 'abc'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("padel : l'organisateur n'a pas d'action Retirer dans sa feuille", () => {
    wrap(padel);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Org A' }));
    expect(screen.queryByRole('button', { name: /Retirer de la partie/ })).not.toBeInTheDocument();
  });

  it("padel : « + » d'équipe ouvre la feuille d'ajout, ajoute et épingle l'équipe", async () => {
    mocked.searchClubMembers.mockResolvedValue([{ id: 'u-new', firstName: 'New', lastName: 'Player' }] as never);
    const onChanged = jest.fn();
    wrap(padel, onChanged);
    // Org et Ines sont team 1 (défaut) → 2 places libres côté 2.
    fireEvent.click(screen.getAllByRole('button', { name: /Ajouter un joueur à l'équipe 2/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /New Player/ }));
    // La feuille d'ajout se referme après le pick (la place visée est libérée).
    expect(screen.queryByPlaceholderText(/Rechercher un membre/)).not.toBeInTheDocument();
    await waitFor(() => expect(mocked.addReservationPlayer).toHaveBeenCalledWith('r1', 'u-new', 'abc'));
    // La place tapée (équipe 2, 1re libre = G) est transmise avec les places existantes.
    await waitFor(() => expect(mocked.setReservationTeams).toHaveBeenCalledWith(
      'r1', { 'u-org': 1, u2: 1, 'u-new': 2 }, 'abc', { 'u-org': 0, u2: 1, 'u-new': 0 }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("padel : « Passer dans l'équipe 2 » envoie les équipes ET les places (slots)", async () => {
    wrap(padel);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Ines B' }));
    fireEvent.click(screen.getByRole('button', { name: /Passer dans l'équipe 2/ }));
    // Ines (Éq.1 D) part en Éq.2 : sa place D est libre en face → elle la garde (slot 1).
    await waitFor(() => expect(mocked.setReservationTeams).toHaveBeenCalledWith(
      'r1', { 'u-org': 1, u2: 2 }, 'abc', { 'u-org': 0, u2: 1 }));
  });

  it('padel : propose d’ouvrir la partie', () => {
    wrap(padel);
    expect(screen.getByRole('button', { name: /Ouvrir la partie/ })).toBeInTheDocument();
  });

  it('hideOpenMatchToggle masque le contrôle « Ouvrir la partie »', () => {
    render(
      <ThemeProvider>
        <ReservationPlayersInline reservation={resa(padel)} token="abc" now={now} onChanged={() => {}} hideOpenMatchToggle />
      </ThemeProvider>
    );
    expect(screen.queryByRole('button', { name: /Ouvrir la partie/ })).not.toBeInTheDocument();
  });
});
