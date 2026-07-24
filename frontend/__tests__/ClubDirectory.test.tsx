import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ClubDirectory } from '@/components/ClubDirectory';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/clubs',
}));

jest.mock('@/components/ClubCard', () => ({
  ClubCard: ({ club, defaultCover }: { club: { name: string }; defaultCover?: string }) =>
    <div data-testid="club-card" data-cover={defaultCover}>{club.name}</div>,
}));

const getSports = jest.fn();
const getMyProfile = jest.fn();
const listClubs = jest.fn();

jest.mock('@/lib/api', () => ({
  api: {
    getSports: (...a: unknown[]) => getSports(...a),
    getMyProfile: (...a: unknown[]) => getMyProfile(...a),
    listClubs: (...a: unknown[]) => listClubs(...a),
  },
  assetUrl: (u: string | null) => u,
}));

const sports = [
  { key: 'padel', name: 'Padel', icon: null, id: 's1', published: true },
  { key: 'tennis', name: 'Tennis', icon: null, id: 's2', published: true },
];

let authToken: string | null = 'tok';
jest.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ token: authToken, ready: true }),
}));

const wrap = () => render(<ThemeProvider><ClubDirectory /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear(); // les filtres du mode contrôlé persistent en localStorage → sinon fuite entre tests
  authToken = 'tok';
  getSports.mockResolvedValue(sports);
  listClubs.mockResolvedValue([]);
  getMyProfile.mockResolvedValue({
    id: 'u1', email: 'test@palova.fr', firstName: 'Test', lastName: 'User',
    phone: null, sex: null, birthDate: null, avatarUrl: null, locale: 'fr',
    isSuperAdmin: false, showInLeaderboard: false,
    preferredSport: { id: 's2', key: 'tennis', name: 'Tennis' },
  });
});

it('initialise le filtre sur le sport préféré du joueur', async () => {
  wrap();
  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ sport: 'tennis' }))
  );
});

it('sans préférence (preferredSport null), ne force aucun sport', async () => {
  getMyProfile.mockResolvedValue({
    id: 'u1', email: 'test@palova.fr', firstName: 'Test', lastName: 'User',
    phone: null, sex: null, birthDate: null, avatarUrl: null, locale: 'fr',
    isSuperAdmin: false, showInLeaderboard: false,
    preferredSport: null,
  });
  wrap();
  await waitFor(() => expect(listClubs).toHaveBeenCalled());
  // Toutes les invocations : sport doit être undefined (pas de filtre forcé)
  const calls = listClubs.mock.calls as [{ sport?: string }][];
  calls.forEach((args) => expect(args[0].sport).toBeUndefined());
});

it('sans token, ne charge pas le profil et ne force aucun sport', async () => {
  authToken = null;
  wrap();
  await waitFor(() => expect(listClubs).toHaveBeenCalled());
  expect(getMyProfile).not.toHaveBeenCalled();
  const calls = listClubs.mock.calls as [{ sport?: string }][];
  calls.forEach((args) => expect(args[0].sport).toBeUndefined());
});

it('« Autour de moi » relance listClubs avec lat/lng', async () => {
  const ok = (cb: PositionCallback) => cb({ coords: { latitude: 48.86, longitude: 2.35 } } as GeolocationPosition);
  Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: ok } });

  wrap();
  fireEvent.click(await screen.findByRole('button', { name: /autour de moi/i }));

  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ lat: 48.86, lng: 2.35 })),
  );
});

it('un échec réseau affiche un message distinct de « aucun club » + un bouton Réessayer', async () => {
  authToken = null;
  listClubs.mockRejectedValueOnce(new Error('network'));
  wrap();
  await screen.findByText(/impossible de charger les clubs/i);
  expect(screen.queryByText('Aucun club ne correspond.')).not.toBeInTheDocument();

  listClubs.mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
  await screen.findByText('Aucun club ne correspond.');
});

it('fait tourner la banque de couvertures → cartes voisines distinctes', async () => {
  authToken = null; // évite le filtre sport, simplifie le chargement
  const club = (id: string) => ({
    id, slug: id, name: id.toUpperCase(), city: null, description: null,
    accentColor: '#123456', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 1,
  });
  listClubs.mockResolvedValue([club('a'), club('b'), club('c')]);
  wrap();
  await waitFor(() => expect(screen.getAllByTestId('club-card')).toHaveLength(3));
  const covers = screen.getAllByTestId('club-card').map((el) => el.getAttribute('data-cover'));
  expect(new Set(covers).size).toBe(3); // 3 cartes → 3 couvertures distinctes (rotation)
});

it('les résultats sont rendus dans le rail partagé AgendaRail, avec un compteur', async () => {
  authToken = null;
  const club = (id: string) => ({
    id, slug: id, name: id.toUpperCase(), city: null, description: null,
    accentColor: '#123456', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 1,
  });
  listClubs.mockResolvedValue([club('a'), club('b')]);
  const { container } = wrap();
  await waitFor(() => expect(screen.getAllByTestId('club-card')).toHaveLength(2));
  expect(container.querySelector('.ag-rail')).not.toBeNull();
  expect(screen.getByText('2 clubs')).toBeInTheDocument();
});

it('« Effacer les filtres » apparaît sur un filtre actif (nom) et le vide', async () => {
  authToken = null;
  listClubs.mockResolvedValue([]);
  wrap();
  await waitFor(() => expect(listClubs).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: /Effacer les filtres/ })).not.toBeInTheDocument();
  const input = screen.getByPlaceholderText('Nom du club');
  fireEvent.change(input, { target: { value: 'Padel' } });
  expect(screen.getByRole('button', { name: /Effacer les filtres/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Effacer les filtres/ }));
  expect((input as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('button', { name: /Effacer les filtres/ })).not.toBeInTheDocument();
});

it('mode contrôlé (props city/coords) : transmet les valeurs à listClubs, masque ville + géoloc, champ nom replié derrière Filtres', async () => {
  authToken = null; // simplifie : pas de filtre sport asynchrone en plus
  render(
    <ThemeProvider>
      <ClubDirectory city="Lyon" coords={{ lat: 45.75, lng: 4.85 }} />
    </ThemeProvider>,
  );

  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Lyon', lat: 45.75, lng: 4.85 }),
    ),
  );

  expect(screen.queryByPlaceholderText('Ville ou région')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /autour de moi/i })).not.toBeInTheDocument();
  // Le champ « Nom du club » est replié derrière le bouton « Filtres » (fermé par défaut).
  expect(screen.queryByPlaceholderText('Nom du club')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));
  expect(screen.getByPlaceholderText('Nom du club')).toBeInTheDocument();
});

it('mode contrôlé : un changement de la prop city relance listClubs avec la nouvelle valeur', async () => {
  authToken = null;
  const { rerender } = render(
    <ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>,
  );
  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ city: 'Lyon' })),
  );

  rerender(
    <ThemeProvider><ClubDirectory city="Marseille" /></ThemeProvider>,
  );
  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ city: 'Marseille' })),
  );
});

const clubFixture = {
  id: 'c1', slug: 'club-1', name: 'Padel Club 1', city: 'Paris', description: null,
  accentColor: '#123456', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 1,
};

it('prop deptCodes → listClubs reçoit dept', async () => {
  authToken = null;
  render(<ThemeProvider><ClubDirectory deptCodes={['2A', '2B']} /></ThemeProvider>);
  await waitFor(() => expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ dept: ['2A', '2B'] })));
});

it('onCount reçoit le nombre de clubs affichés', async () => {
  authToken = null;
  listClubs.mockResolvedValue([clubFixture]);
  const onCount = jest.fn();
  render(<ThemeProvider><ClubDirectory onCount={onCount} /></ThemeProvider>);
  await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(1));
});

const clubFixture2 = { ...clubFixture, id: 'c2', slug: 'club-2', name: 'Padel Club 2' };

it('onlySlugs rétrécit les cartes rendues après le fetch', async () => {
  authToken = null;
  listClubs.mockResolvedValue([clubFixture, clubFixture2]);
  render(<ThemeProvider><ClubDirectory onlySlugs={new Set(['club-1'])} /></ThemeProvider>);
  expect(await screen.findByText('Padel Club 1')).toBeInTheDocument();
  expect(screen.queryByText('Padel Club 2')).not.toBeInTheDocument();
});

it('onlySlugs vide (aucune correspondance) → « Aucun club ne correspond. »', async () => {
  authToken = null;
  listClubs.mockResolvedValue([clubFixture]);
  render(<ThemeProvider><ClubDirectory onlySlugs={new Set(['not-a-member'])} /></ThemeProvider>);
  expect(await screen.findByText('Aucun club ne correspond.')).toBeInTheDocument();
});

it('changer onlySlugs ne redéclenche jamais listClubs (filtre 100% client)', async () => {
  authToken = null;
  listClubs.mockResolvedValue([clubFixture, clubFixture2]);
  const { rerender } = render(<ThemeProvider><ClubDirectory /></ThemeProvider>);
  await waitFor(() => expect(screen.getByText('Padel Club 1')).toBeInTheDocument());
  const callsBefore = listClubs.mock.calls.length;

  rerender(<ThemeProvider><ClubDirectory onlySlugs={new Set(['club-1'])} /></ThemeProvider>);
  expect(await screen.findByText('Padel Club 1')).toBeInTheDocument();
  expect(screen.queryByText('Padel Club 2')).not.toBeInTheDocument();
  expect(listClubs.mock.calls.length).toBe(callsBefore);
});

it('onCount reflète le compte post-onlySlugs, pas le compte brut du fetch', async () => {
  authToken = null;
  listClubs.mockResolvedValue([clubFixture, clubFixture2]);
  const onCount = jest.fn();
  render(<ThemeProvider><ClubDirectory onlySlugs={new Set(['club-1'])} onCount={onCount} /></ThemeProvider>);
  await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(1));
});

it('deptCodes vide (tableau explicite) → listClubs ne reçoit pas de clé dept', async () => {
  authToken = null;
  listClubs.mockResolvedValue([clubFixture]);
  render(<ThemeProvider><ClubDirectory deptCodes={[]} /></ThemeProvider>);
  await waitFor(() => expect(listClubs).toHaveBeenCalled());
  const calls = listClubs.mock.calls as [Record<string, unknown>][];
  calls.forEach((args) => expect(args[0]).not.toHaveProperty('dept'));
});

it('onCount reçoit 0 quand listClubs échoue', async () => {
  authToken = null;
  listClubs.mockRejectedValue(new Error('network'));
  const onCount = jest.fn();
  render(<ThemeProvider><ClubDirectory onCount={onCount} /></ThemeProvider>);
  await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(0));
});

describe('mode contrôlé : filtres repliables + mémorisés (page /decouvrir)', () => {
  beforeEach(() => { authToken = null; listClubs.mockResolvedValue([]); });

  it('badge « Filtres · N » reflète nom + sport', async () => {
    render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).not.toMatch(/\d/);
    fireEvent.change(screen.getByPlaceholderText('Nom du club'), { target: { value: 'Padel' } });
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('1');
    fireEvent.click(await screen.findByRole('button', { name: 'Padel' })); // chip sport (fixture `sports`)
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('2');
  });

  it('« Effacer » (à côté du bouton Filtres) vide nom + sport', async () => {
    render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));
    fireEvent.change(screen.getByPlaceholderText('Nom du club'), { target: { value: 'Padel' } });
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect((screen.getByPlaceholderText('Nom du club') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
  });

  it('les filtres se mémorisent entre montages (nom du club)', async () => {
    const first = render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));
    fireEvent.change(screen.getByPlaceholderText('Nom du club'), { target: { value: 'Padel Club' } });
    await waitFor(() => expect(listClubs).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Padel Club' })));
    first.unmount();

    render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(listClubs).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Padel Club' })));
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('1'); // tiroir fermé, badge restauré
  });

  it('une mémoire de filtres existante saute le pré-remplissage du sport préféré', async () => {
    authToken = 'tok';
    getMyProfile.mockResolvedValue({
      id: 'u1', email: 'test@palova.fr', firstName: 'Test', lastName: 'User',
      phone: null, sex: null, birthDate: null, avatarUrl: null, locale: 'fr',
      isSuperAdmin: false, showInLeaderboard: false,
      preferredSport: { id: 's2', key: 'tennis', name: 'Tennis' },
    });
    localStorage.setItem('palova:discover-clubs-filters', JSON.stringify({ q: '', sport: '' }));
    render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    // Le sport préféré (tennis) n'est JAMAIS forcé : toutes les invocations gardent sport vide.
    const calls = listClubs.mock.calls as [{ sport?: string }][];
    calls.forEach((args) => expect(args[0].sport).toBeUndefined());
  });

  it('les cartes utilisent le rail compact 272px, comme les cartes de parties', async () => {
    listClubs.mockResolvedValue([clubFixture]);
    const { container } = render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(screen.getAllByTestId('club-card')).toHaveLength(1));
    const rail = container.querySelector('.ag-rail') as HTMLElement;
    expect(rail.style.getPropertyValue('--ag-cols')).toBe('272px');
    expect(rail.style.getPropertyValue('--ag-mobile-cols')).toBe('272px');
  });

  it('mode autonome (vitrine anonyme) : recherche toujours visible, rail large inchangé', async () => {
    listClubs.mockResolvedValue([clubFixture]);
    const { container } = render(<ThemeProvider><ClubDirectory /></ThemeProvider>);
    await waitFor(() => expect(screen.getAllByTestId('club-card')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /^Filtres/ })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nom du club')).toBeInTheDocument();
    const rail = container.querySelector('.ag-rail') as HTMLElement;
    expect(rail.style.getPropertyValue('--ag-cols')).toBe('calc((100% - 24px) / 3)');
  });
});
