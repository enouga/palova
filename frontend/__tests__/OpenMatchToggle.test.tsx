import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OpenMatchToggle } from '../components/reservations/OpenMatchToggle';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    setReservationVisibility: jest.fn().mockResolvedValue({ id: 'r1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const now = Date.now();
const future = new Date(now + 48 * 3600e3).toISOString();

const resa = (over: Record<string, unknown> = {}) => ({
  id: 'r1', startTime: future, endTime: future, status: 'CONFIRMED', totalPrice: '25',
  resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
  capacity: 4,
  participants: [
    { id: 'p-org', userId: 'u-org', isOrganizer: true, firstName: 'Org', lastName: 'A', avatarUrl: null },
    { id: 'p2', userId: 'u2', isOrganizer: false, firstName: 'Ines', lastName: 'B', avatarUrl: null },
  ],
  ...over,
}) as never;

const wrap = (over = {}, onChanged = () => {}) =>
  render(<ThemeProvider><OpenMatchToggle reservation={resa(over)} token="abc" now={now} onChanged={onChanged} /></ThemeProvider>);

describe('OpenMatchToggle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('padel confirmée future avec place libre → propose « Ouvrir aux joueurs du club »', () => {
    wrap();
    expect(screen.getByRole('button', { name: /Ouvrir aux joueurs du club/ })).toBeInTheDocument();
  });

  it('ne rend rien pour un sport non-padel', () => {
    const { container } = wrap({
      resource: { id: 'res1', name: 'Court', sport: { key: 'tennis', name: 'Tennis' }, club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('ne rend rien quand la partie est complète', () => {
    const full = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, userId: `u${i}`, isOrganizer: i === 0, firstName: 'P', lastName: `${i}`, avatarUrl: null }));
    const { container } = wrap({ participants: full });
    expect(container).toBeEmptyDOMElement();
  });

  it('ne rend rien pour une partie ouverte déjà commencée (fermer serait sans effet)', () => {
    const started = new Date(now - 3600e3).toISOString();
    const { container } = wrap({ visibility: 'PUBLIC', startTime: started });
    expect(container).toBeEmptyDOMElement();
  });

  it('ouvre la feuille et publie sans fourchette de niveau', async () => {
    const onChanged = jest.fn();
    wrap({}, onChanged);
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir aux joueurs du club/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Publier$/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith('r1', 'PUBLIC', 'abc', { targetLevelMin: null, targetLevelMax: null }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('publie avec une fourchette quand « Limiter le niveau » est activé', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir aux joueurs du club/ }));
    fireEvent.click(screen.getByRole('switch', { name: /Limiter le niveau/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Publier$/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith('r1', 'PUBLIC', 'abc', { targetLevelMin: 3, targetLevelMax: 6 }));
  });

  it('partie ouverte → chip « Ouverte » + « Fermer » (repasse en privé)', async () => {
    const onChanged = jest.fn();
    wrap({ visibility: 'PUBLIC' }, onChanged);
    expect(screen.getByText('Ouverte')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Fermer$/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith('r1', 'PRIVATE', 'abc'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
