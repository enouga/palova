import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { DiscoverMatches } from '@/components/discover/DiscoverMatches';
import type { NationalOpenMatch, MyRating } from '@/lib/api';

const getMyRating = jest.fn();

jest.mock('@/lib/api', () => ({
  api: { getMyRating: (...a: unknown[]) => getMyRating(...a) },
  assetUrl: (p: string | null) => p, // Avatar
}));

let authToken: string | null = null;
jest.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ token: authToken, clubId: null, ready: true }),
}));

function makeMatch(over: Partial<NationalOpenMatch> = {}): NationalOpenMatch {
  return {
    id: 'm1',
    resourceName: 'Court 1',
    sport: { key: 'padel', name: 'Padel' },
    startTime: '2026-07-08T16:00:00.000Z',
    endTime: '2026-07-08T17:30:00.000Z',
    maxPlayers: 4,
    spotsLeft: 2,
    full: false,
    targetLevelMin: 4,
    targetLevelMax: 6,
    players: [
      { userId: 'org', firstName: 'Léa', lastName: 'Martin', avatarUrl: null, isOrganizer: true, team: 1, slot: 0 },
      { userId: 'p2', firstName: 'Tom', lastName: 'Durand', avatarUrl: null, isOrganizer: false, team: 2, slot: 0 },
    ],
    club: { slug: 'padel-arena-paris', name: 'Padel Arena Paris', city: 'Paris', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.8566, longitude: 2.3522, department: null, departmentCode: null },
    ...over,
  };
}

function makeRating(over: Partial<MyRating> = {}): MyRating {
  return { calibrated: true, level: 6.2, tier: 'Confirmé', isProvisional: false, reliability: 80, matchesPlayed: 12, ...over };
}

const NOW = new Date('2026-07-08T10:00:00.000Z');

const wrap = (props: Partial<React.ComponentProps<typeof DiscoverMatches>> = {}) =>
  render(
    <ThemeProvider>
      <DiscoverMatches
        matches={props.matches !== undefined ? props.matches : [makeMatch()]}
        location={props.location ?? { city: null, deptCodes: [] }}
        coords={props.coords !== undefined ? props.coords : null}
        now={props.now !== undefined ? props.now : NOW}
        onSeeClubs={props.onSeeClubs ?? jest.fn()}
        onCount={props.onCount}
      />
    </ThemeProvider>,
  );

// Le tiroir de facettes est replié par défaut ; l'ouvrir avant de toucher une puce.
const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));

beforeEach(() => {
  jest.clearAllMocks();
  authToken = null;
  localStorage.clear(); // les filtres persistent en localStorage → sinon fuite entre tests
  getMyRating.mockResolvedValue(null);
});

describe('DiscoverMatches', () => {
  it('rend 1 carte par partie, aucun filtre de date par défaut', () => {
    wrap({ matches: [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2', club: { ...makeMatch().club, name: 'Autre club' } })] });
    expect(screen.getByText('Padel Arena Paris')).toBeInTheDocument();
    expect(screen.getByText('Autre club')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('le tiroir de facettes est replié par défaut ; « Filtres » le déplie', () => {
    wrap();
    expect(screen.queryByText('Quand')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Aujourd'hui" })).not.toBeInTheDocument();
    openFilters();
    expect(screen.getByText('Quand')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Aujourd'hui" })).toBeInTheDocument();
  });

  it('filtre par type de partie (Pour le fun)', () => {
    wrap({
      matches: [
        makeMatch({ id: 'c', competitive: true }),
        makeMatch({ id: 'f', competitive: false, club: { ...makeMatch().club, name: 'Fun Club' } }),
      ],
    });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Pour le fun' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Fun Club')).toBeInTheDocument();
  });

  it('filtre par genre (Féminine)', () => {
    wrap({
      matches: [
        makeMatch({ id: 'w', gender: 'WOMEN' }),
        makeMatch({ id: 'm', gender: 'MIXED', club: { ...makeMatch().club, name: 'Mixte Club' } }),
      ],
    });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Féminine' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('Mixte Club')).not.toBeInTheDocument();
  });

  it('badge « Filtres · N » + « Effacer » réapparaît sur un filtre actif et le réinitialise', () => {
    wrap({
      matches: [
        makeMatch({ id: 'c', competitive: true }),
        makeMatch({ id: 'f', competitive: false, club: { ...makeMatch().club, name: 'Fun Club' } }),
      ],
    });
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Pour le fun' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
  });

  it('chip Aujourd\'hui filtre les parties hors de la journée', () => {
    wrap({
      now: NOW,
      matches: [
        makeMatch({ id: 'today', startTime: '2026-07-08T16:00:00.000Z', endTime: '2026-07-08T17:00:00.000Z' }),
        makeMatch({ id: 'later', club: { ...makeMatch().club, name: 'Club plus tard' }, startTime: '2026-07-15T16:00:00.000Z', endTime: '2026-07-15T17:00:00.000Z' }),
      ],
    });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Aujourd\'hui' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('Club plus tard')).not.toBeInTheDocument();
  });

  it('location.city filtre par ville', () => {
    wrap({
      location: { city: 'lyon', deptCodes: [] },
      matches: [
        makeMatch({ id: 'paris', club: { ...makeMatch().club, name: 'Club Paris', city: 'Paris' } }),
        makeMatch({ id: 'lyon', club: { ...makeMatch().club, name: 'Club Lyon', city: 'Lyon' } }),
      ],
    });
    expect(screen.getByText('Club Lyon')).toBeInTheDocument();
    expect(screen.queryByText('Club Paris')).not.toBeInTheDocument();
  });

  it('location.deptCodes filtre par code département', async () => {
    const matchParis = makeMatch({
      id: 'paris',
      club: { ...makeMatch().club, name: 'Padel Paris', city: 'Paris', departmentCode: '75' },
    });
    const matchLyon = makeMatch({
      id: 'lyon',
      club: { ...makeMatch().club, name: 'Padel Lyon', city: 'Lyon', departmentCode: '69' },
    });
    wrap({ matches: [matchParis, matchLyon], location: { city: null, deptCodes: ['69'] } });
    expect(await screen.findByText('Padel Lyon')).toBeInTheDocument();
    expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument();
  });

  it('onCount reçoit le nombre de cartes affichées', async () => {
    const onCount = jest.fn();
    const matchParis = makeMatch({
      id: 'paris',
      club: { ...makeMatch().club, name: 'Padel Paris', city: 'Paris', departmentCode: '75' },
    });
    const matchLyon = makeMatch({
      id: 'lyon',
      club: { ...makeMatch().club, name: 'Padel Lyon', city: 'Lyon', departmentCode: '69' },
    });
    wrap({ matches: [matchParis, matchLyon], location: { city: null, deptCodes: [] }, onCount });
    await screen.findByText('Padel Paris');
    expect(onCount).toHaveBeenLastCalledWith(2);
  });

  it('coords Paris trie Paris avant Lyon et affiche la distance', () => {
    wrap({
      coords: { lat: 48.8566, lng: 2.3522 }, // Paris
      matches: [
        makeMatch({
          id: 'lyon',
          club: { slug: 'club-lyon', name: 'Club Lyon', city: 'Lyon', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 45.7640, longitude: 4.8357, department: null, departmentCode: null },
        }),
        makeMatch({
          id: 'paris',
          club: { slug: 'club-paris', name: 'Club Paris', city: 'Paris', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.8566, longitude: 2.3522, department: null, departmentCode: null },
        }),
      ],
    });
    const clubNames = screen.getAllByText(/^Club (Lyon|Paris)$/).map((el) => el.textContent);
    expect(clubNames).toEqual(['Club Paris', 'Club Lyon']);
    // Paris à ~0km, Lyon à ~390km : au moins une mention de distance en km.
    expect(screen.getAllByText(/km$/).length).toBeGreaterThan(0);
  });

  it('anonyme : pas de chip « À mon niveau » et getMyRating jamais appelé', () => {
    authToken = null;
    wrap();
    openFilters();
    expect(screen.queryByRole('button', { name: 'À mon niveau' })).not.toBeInTheDocument();
    expect(getMyRating).not.toHaveBeenCalled();
  });

  it('connecté (niveau 6.2) : chip présente, au clic filtre par niveau', async () => {
    authToken = 'tok';
    getMyRating.mockResolvedValue(makeRating({ level: 6.2 }));
    wrap({
      matches: [
        makeMatch({ id: 'inrange', club: { ...makeMatch().club, name: 'Club dans la fourchette' }, targetLevelMin: 5, targetLevelMax: 7 }),
        makeMatch({ id: 'outrange', club: { ...makeMatch().club, name: 'Club hors fourchette' }, targetLevelMin: 1, targetLevelMax: 2 }),
        makeMatch({ id: 'open', club: { ...makeMatch().club, name: 'Club ouvert à tous' }, targetLevelMin: null, targetLevelMax: null }),
      ],
    });

    await waitFor(() => expect(getMyRating).toHaveBeenCalledWith('tok', 'padel'));
    openFilters();
    const levelChip = await screen.findByRole('button', { name: 'À mon niveau' });

    // Avant le clic : les 3 parties sont visibles.
    expect(screen.getByText('Club hors fourchette')).toBeInTheDocument();

    fireEvent.click(levelChip);

    expect(screen.queryByText('Club hors fourchette')).not.toBeInTheDocument();
    expect(screen.getByText('Club dans la fourchette')).toBeInTheDocument();
    expect(screen.getByText('Club ouvert à tous')).toBeInTheDocument();
  });

  it('état vide : bouton « Voir les clubs » appelle onSeeClubs', () => {
    const onSeeClubs = jest.fn();
    wrap({ matches: [], onSeeClubs });
    const btn = screen.getByRole('button', { name: /Voir les clubs/ });
    fireEvent.click(btn);
    expect(onSeeClubs).toHaveBeenCalledTimes(1);
  });

  it('plafonne l’affichage à 9 cartes même avec plus de parties disponibles', async () => {
    const onCount = jest.fn();
    const many = Array.from({ length: 15 }, (_, i) =>
      makeMatch({ id: `m${i}`, club: { ...makeMatch().club, name: `Club ${i}` } }),
    );
    wrap({ matches: many, onCount });
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(9));
    expect(screen.getAllByRole('link')).toHaveLength(9);
  });

  it('affiche le compteur de résultats', async () => {
    wrap({ matches: [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2', club: { ...makeMatch().club, name: 'Autre club' } })] });
    expect(await screen.findByText('2 parties')).toBeInTheDocument();
  });

  it('matches null → Chargement…', () => {
    wrap({ matches: null });
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });

  it('now null → Chargement…', () => {
    wrap({ now: null });
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });

  it('les filtres sont mémorisés entre montages (restaurés depuis localStorage, tiroir replié)', async () => {
    const twoMatches = () => [
      makeMatch({ id: 'c', competitive: true }),
      makeMatch({ id: 'f', competitive: false, club: { ...makeMatch().club, name: 'Fun Club' } }),
    ];
    const first = wrap({ matches: twoMatches() });
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Pour le fun' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    first.unmount();

    wrap({ matches: twoMatches() });
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(1)); // filtre restauré, tiroir fermé
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('1');
  });
});
