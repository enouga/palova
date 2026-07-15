import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { OpenMatchQuickSwitch } from '../components/reservations/OpenMatchQuickSwitch';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    setReservationVisibility: jest.fn().mockResolvedValue({ id: 'r1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
    getMyRating: jest.fn().mockResolvedValue(null),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const resa = (over: Record<string, unknown> = {}) => ({
  id: 'r1', startTime: new Date().toISOString(), endTime: new Date().toISOString(), status: 'CONFIRMED', totalPrice: '25',
  resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
  capacity: 4,
  visibility: 'PRIVATE',
  participants: [
    { id: 'p-org', userId: 'u-org', isOrganizer: true, firstName: 'Org', lastName: 'A', avatarUrl: null },
  ],
  ...over,
}) as never;

const wrap = (over = {}, onChanged = () => {}) =>
  render(<ThemeProvider><OpenMatchQuickSwitch reservation={resa(over)} token="abc" onChanged={onChanged} /></ThemeProvider>);

describe('OpenMatchQuickSwitch', () => {
  beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });

  it('padel : interrupteur présent, OFF par défaut', async () => {
    wrap();
    const sw = await screen.findByRole('switch', { name: /Partie ouverte aux membres/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Réservation privée/)).toBeInTheDocument();
  });

  it('non-padel : ne rend rien', () => {
    const { container } = wrap({
      resource: { id: 'res1', name: 'Court', sport: { key: 'tennis', name: 'Tennis' }, club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('résa déjà publique → interrupteur ON', () => {
    wrap({ visibility: 'PUBLIC' });
    expect(screen.getByRole('switch', { name: /Partie ouverte aux membres/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('bascule ON avec la préférence de niveau mémorisée → PUBLIC + fourchette', async () => {
    localStorage.setItem('palova:open-match-level', JSON.stringify({ enabled: true, min: 4, max: 6 }));
    const onChanged = jest.fn();
    wrap({}, onChanged);
    fireEvent.click(await screen.findByRole('switch', { name: /Partie ouverte aux membres/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith(
      'r1', 'PUBLIC', 'abc', { targetLevelMin: 4, targetLevelMax: 6 },
    ));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('sans préférence mémorisée, la fourchette vient du niveau du joueur (getMyRating) ±1', async () => {
    mocked.getMyRating.mockResolvedValue({ level: 5 } as never);
    const onChanged = jest.fn();
    wrap({}, onChanged);
    // Laisse le temps à l'effet (getMyRating -> setLevelMin/Max) de committer son état avant
    // de cliquer : ce setState survient dans un .then() hors d'un event handler React, donc
    // pas garanti flush avant la résolution (synchrone) de findByRole sur le switch déjà monté.
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(await screen.findByRole('switch', { name: /Partie ouverte aux membres/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith(
      'r1', 'PUBLIC', 'abc', { targetLevelMin: 4, targetLevelMax: 6 },
    ));
  });

  it('préférence « ouverte à tous » → targetLevel null', async () => {
    localStorage.setItem('palova:open-match-level', JSON.stringify({ enabled: false, min: 3, max: 5 }));
    wrap();
    fireEvent.click(await screen.findByRole('switch', { name: /Partie ouverte aux membres/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith(
      'r1', 'PUBLIC', 'abc', { targetLevelMin: null, targetLevelMax: null },
    ));
  });

  it('bascule OFF → PRIVATE', async () => {
    const onChanged = jest.fn();
    wrap({ visibility: 'PUBLIC' }, onChanged);
    fireEvent.click(screen.getByRole('switch', { name: /Partie ouverte aux membres/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith('r1', 'PRIVATE', 'abc'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('erreur mappée affichée', async () => {
    mocked.setReservationVisibility.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    wrap();
    fireEvent.click(await screen.findByRole('switch', { name: /Partie ouverte aux membres/ }));
    expect(await screen.findByText(/Seul l'organisateur/)).toBeInTheDocument();
  });

  it('résa déjà ouverte : le curseur de niveau reprend l’état réel de la résa, pas la préférence mémorisée', async () => {
    localStorage.setItem('palova:open-match-level', JSON.stringify({ enabled: true, min: 1, max: 2 }));
    wrap({ visibility: 'PUBLIC', targetLevelMin: 4, targetLevelMax: 7 });
    expect(await screen.findByRole('slider', { name: 'Niveau minimum' })).toHaveValue('4');
    expect(screen.getByRole('slider', { name: 'Niveau maximum' })).toHaveValue('7');
  });

  it('résa déjà ouverte sans fourchette → « Limiter le niveau » OFF, texte « Ouverte à tous les niveaux »', async () => {
    wrap({ visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null });
    expect(await screen.findByRole('switch', { name: 'Limiter le niveau' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Ouverte à tous les niveaux/)).toBeInTheDocument();
  });

  it('ajuster le curseur sur une partie déjà ouverte republie en direct (débouncé) + mémorise la préférence', async () => {
    jest.useFakeTimers();
    localStorage.clear();
    wrap({ visibility: 'PUBLIC', targetLevelMin: 3, targetLevelMax: 5 });
    const maxSlider = screen.getByRole('slider', { name: 'Niveau maximum' });
    fireEvent.change(maxSlider, { target: { value: '7' } });
    expect(mocked.setReservationVisibility).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(400); });
    expect(mocked.setReservationVisibility).toHaveBeenCalledWith(
      'r1', 'PUBLIC', 'abc', { targetLevelMin: 3, targetLevelMax: 7 },
    );
    expect(JSON.parse(localStorage.getItem('palova:open-match-level')!)).toEqual({ enabled: true, min: 3, max: 7 });
    jest.useRealTimers();
  });

  it('désactiver « Limiter le niveau » sur une partie déjà ouverte republie sans fourchette', async () => {
    jest.useFakeTimers();
    wrap({ visibility: 'PUBLIC', targetLevelMin: 3, targetLevelMax: 5 });
    fireEvent.click(screen.getByRole('switch', { name: 'Limiter le niveau' }));
    act(() => { jest.advanceTimersByTime(400); });
    expect(mocked.setReservationVisibility).toHaveBeenCalledWith(
      'r1', 'PUBLIC', 'abc', { targetLevelMin: null, targetLevelMax: null },
    );
    jest.useRealTimers();
  });

  it('un simple préchargement (pas d’interaction manuelle) ne republie jamais tout seul', async () => {
    jest.useFakeTimers();
    wrap({ visibility: 'PUBLIC', targetLevelMin: 3, targetLevelMax: 5 });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(mocked.setReservationVisibility).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
