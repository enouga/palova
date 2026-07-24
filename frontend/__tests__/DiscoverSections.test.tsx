import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { NationalOpenMatch, NationalTournament } from '@/lib/api';

// Les trois moteurs de section sont testés isolément (DiscoverMatches, TournamentFinder,
// ClubDirectory) : ici on stubbe, et on n'observe QUE ce que le conteneur leur transmet —
// c'est tout son métier (localisation partagée + filtre « Mes clubs » + compteurs).
const matchesProps = jest.fn();
const tournamentsProps = jest.fn();
const clubsProps = jest.fn();

jest.mock('@/components/discover/DiscoverMatches', () => ({
  DiscoverMatches: (p: { matches: unknown[] | null; onCount?: (n: number) => void }) => {
    matchesProps(p);
    return <button data-testid="matches" onClick={() => p.onCount?.(7)}>compter parties</button>;
  },
}));
jest.mock('@/components/calendar/TournamentFinder', () => ({
  TournamentFinder: (p: unknown) => { tournamentsProps(p); return <div data-testid="tournaments" />; },
}));
jest.mock('@/components/ClubDirectory', () => ({
  ClubDirectory: (p: unknown) => { clubsProps(p); return <div data-testid="clubs" />; },
}));

import { DiscoverSections } from '@/components/platform/home/DiscoverSections';

const club = (slug: string, city: string) => ({
  slug, name: slug, city, timezone: 'Europe/Paris', accentColor: '#5e93da',
  logoUrl: null, latitude: null, longitude: null, department: null, departmentCode: null,
});
const match = (id: string, slug: string, city: string) =>
  ({ id, club: club(slug, city) } as unknown as NationalOpenMatch);
const tournament = (id: string, slug: string, city: string) =>
  ({ id, club: club(slug, city) } as unknown as NationalTournament);

const MATCHES = [match('m1', 'padel-arena', 'Paris'), match('m2', 'toulouse-padel', 'Toulouse')];
const TOURNAMENTS = [tournament('t1', 'padel-arena', 'Paris'), tournament('t2', 'toulouse-padel', 'Toulouse')];

function wrap(over: Partial<React.ComponentProps<typeof DiscoverSections>> = {}) {
  return render(
    <ThemeProvider>
      <DiscoverSections matches={MATCHES} tournaments={TOURNAMENTS} now={new Date('2026-07-24T10:00:00Z')}
        myClubSlugs={null} {...over} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('DiscoverSections — habillage', () => {
  it('garde les titres de la vitrine (et pas ceux de l’ex-page /decouvrir)', () => {
    wrap();
    expect(screen.getByRole('heading', { name: 'Ça joue bientôt' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prochains tournois' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clubs près de chez vous' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tournois' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Clubs' })).toBeNull();
  });

  it('insère `intro` APRÈS la barre de recherche et AVANT la première section', () => {
    const { container } = wrap({ intro: <div data-testid="intro" /> });
    const nodes = Array.from(container.querySelectorAll('input, [data-testid="intro"], #parties'));
    expect(nodes.map((n) => n.getAttribute('data-testid') || n.id || n.tagName))
      .toEqual(['INPUT', 'intro', 'parties']);
  });

  it('remonte le compteur d’une section dans sa pastille d’ancre', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('matches'));
    expect(await screen.findByText('7')).toBeInTheDocument();
  });
});

describe('DiscoverSections — recherche par lieu partagée', () => {
  it('une ville saisie descend dans les TROIS sections d’un coup', async () => {
    wrap();
    fireEvent.change(screen.getByPlaceholderText(/Ville, code postal/), { target: { value: 'Toulouse' } });
    await waitFor(() => {
      expect(matchesProps).toHaveBeenLastCalledWith(expect.objectContaining({ location: { city: 'Toulouse', deptCodes: [] } }));
    });
    expect(tournamentsProps).toHaveBeenLastCalledWith(expect.objectContaining({ city: 'Toulouse', deptCodes: [] }));
    expect(clubsProps).toHaveBeenLastCalledWith(expect.objectContaining({ city: 'Toulouse', deptCodes: [] }));
  });

  it('un code postal devient un département, pas une ville', async () => {
    wrap();
    fireEvent.change(screen.getByPlaceholderText(/Ville, code postal/), { target: { value: '31000' } });
    await waitFor(() => {
      expect(clubsProps).toHaveBeenLastCalledWith(expect.objectContaining({ city: '', deptCodes: ['31'] }));
    });
  });

  it('mémorise la recherche d’une session à l’autre, et la restaure au montage', async () => {
    const first = wrap();
    fireEvent.change(screen.getByPlaceholderText(/Ville, code postal/), { target: { value: 'Lyon' } });
    await waitFor(() => expect(localStorage.getItem('palova:discover-location')).toBe('Lyon'));

    first.unmount(); // sinon les deux instances cohabitent dans le document
    wrap();
    expect(await screen.findByDisplayValue('Lyon')).toBeInTheDocument();
  });
});

describe('DiscoverSections — filtre « Mes clubs »', () => {
  it('pas de chip pour un visiteur (aucun bouton mort)', () => {
    wrap({ myClubSlugs: null });
    expect(screen.queryByLabelText('Mes clubs')).toBeNull();
  });

  it('chip présente dès qu’un club actif existe, et ne filtre qu’une fois activée', async () => {
    wrap({ myClubSlugs: new Set(['toulouse-padel']) });
    expect(matchesProps).toHaveBeenLastCalledWith(expect.objectContaining({ matches: MATCHES }));

    fireEvent.click(screen.getByLabelText('Mes clubs'));
    await waitFor(() => {
      expect(matchesProps).toHaveBeenLastCalledWith(expect.objectContaining({ matches: [MATCHES[1]] }));
    });
    expect(tournamentsProps).toHaveBeenLastCalledWith(expect.objectContaining({ items: [TOURNAMENTS[1]] }));
    expect(clubsProps).toHaveBeenLastCalledWith(expect.objectContaining({ onlySlugs: new Set(['toulouse-padel']) }));
  });

  it('l’annuaire n’est pas restreint tant que la chip est éteinte', () => {
    wrap({ myClubSlugs: new Set(['toulouse-padel']) });
    expect(clubsProps).toHaveBeenLastCalledWith(expect.objectContaining({ onlySlugs: null }));
  });
});

describe('DiscoverSections — deep-links hérités de l’ancienne vitrine', () => {
  it('?q= préremplit la recherche', async () => {
    window.history.replaceState(null, '', '/?q=Bordeaux');
    wrap();
    expect(await screen.findByDisplayValue('Bordeaux')).toBeInTheDocument();
  });

  it('?q= prime sur la recherche mémorisée', async () => {
    localStorage.setItem('palova:discover-location', 'Lyon');
    window.history.replaceState(null, '', '/?q=Bordeaux');
    wrap();
    expect(await screen.findByDisplayValue('Bordeaux')).toBeInTheDocument();
  });
});
