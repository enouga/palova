import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { TournamentFinder } from '../components/calendar/TournamentFinder';
import { api } from '../lib/api';
import type { NationalTournament } from '../lib/api';

const NAT: NationalTournament[] = [
  { id: 'a', clubId: 'c', clubSportId: 'cs', name: 'GP Paris', category: 'P500', gender: 'MEN', openToWomen: true,
    description: null, contactInfo: null, startTime: '2026-07-02T12:00:00Z', endTime: null, registrationDeadline: '2026-07-01T12:00:00Z',
    maxTeams: 16, entryFee: null, status: 'PUBLISHED', confirmedCount: 0, waitlistCount: 0,
    club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', department: 'Paris', departmentCode: '75', timezone: 'Europe/Paris', accentColor: '#000', logoUrl: null, latitude: 48.85, longitude: 2.35 } },
  { id: 'b', clubId: 'c2', clubSportId: 'cs', name: 'Open Lyon', category: 'P1000', gender: 'WOMEN', openToWomen: true,
    description: null, contactInfo: null, startTime: '2026-07-20T12:00:00Z', endTime: null, registrationDeadline: '2026-07-19T12:00:00Z',
    maxTeams: 16, entryFee: null, status: 'PUBLISHED', confirmedCount: 0, waitlistCount: 0,
    club: { slug: 'lyon', name: 'Lyon Padel', city: 'Lyon', department: 'Rhône', departmentCode: '69', timezone: 'Europe/Paris', accentColor: '#000', logoUrl: null, latitude: 45.76, longitude: 4.83 } },
];

jest.mock('@/lib/api', () => ({
  api: { listNationalTournaments: jest.fn(() => Promise.resolve(NAT)) },
  assetUrl: (p: string | null) => p,
}));

describe('TournamentFinder', () => {
  // window.location persists across tests in jsdom. The URL-sync effect in TournamentFinder
  // writes filter params (e.g. ?dept=75 after test 2 clicks a chip). Without a reset,
  // test 3 mounts with ?dept=75 already in the URL, which filters out Open Lyon and
  // breaks the "Autour de moi" sorting assertion.
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    (api.listNationalTournaments as jest.Mock).mockClear();
  });
  it('charge et liste les tournois nationaux', async () => {
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    expect(await screen.findByText('GP Paris')).toBeInTheDocument();
    expect(screen.getByText('Open Lyon')).toBeInTheDocument();
  });

  it('filtrer par département 75 ne garde que Paris', async () => {
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    await screen.findByText('GP Paris');
    fireEvent.click(screen.getByRole('button', { name: 'Paris' })); // chip département (compteur en aria-hidden)
    await waitFor(() => expect(screen.queryByText('Open Lyon')).not.toBeInTheDocument());
    expect(screen.getByText('GP Paris')).toBeInTheDocument();
  });

  it('« Autour de moi » via géoloc trie par distance (Lyon en premier)', async () => {
    (navigator.geolocation.getCurrentPosition as any) = (ok: PositionCallback) =>
      ok({ coords: { latitude: 45.76, longitude: 4.83 } } as GeolocationPosition);
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    await screen.findByText('GP Paris');
    fireEvent.click(screen.getByRole('button', { name: /Autour de moi/i }));
    await waitFor(() => {
      const titles = screen.getAllByText(/GP Paris|Open Lyon/).map((n) => n.textContent);
      expect(titles[0]).toBe('Open Lyon');
    });
  });

  it("l'écriture de l'URL fusionne avec les paramètres existants de la page hôte (ex. ?tab=)", async () => {
    window.history.replaceState(null, '', '/decouvrir?tab=tournois');
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    await screen.findByText('GP Paris');
    fireEvent.click(screen.getByRole('button', { name: 'Paris' })); // chip département (compteur en aria-hidden)
    await waitFor(() => expect(window.location.search).toContain('dept=75'));
    expect(window.location.search).toContain('tab=tournois');
  });

  it('prop coords trie par distance sans solliciter la géolocalisation native', async () => {
    const getCurrentPosition = jest.fn();
    (navigator.geolocation.getCurrentPosition as any) = getCurrentPosition;
    render(<ThemeProvider><TournamentFinder coords={{ lat: 45.76, lng: 4.83 }} /></ThemeProvider>);
    await screen.findByText('GP Paris');
    await waitFor(() => {
      const titles = screen.getAllByText(/GP Paris|Open Lyon/).map((n) => n.textContent);
      expect(titles[0]).toBe('Open Lyon');
    });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Autour de moi/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('prop city filtre les résultats ET les facettes de département', async () => {
    render(<ThemeProvider><TournamentFinder city="lyon" /></ThemeProvider>);
    await screen.findByText('Open Lyon');
    expect(screen.queryByText('GP Paris')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Paris' })).not.toBeInTheDocument();
  });

  it('prop items : données préchargées, aucun fetch', async () => {
    render(<ThemeProvider><TournamentFinder items={NAT} /></ThemeProvider>);
    expect(await screen.findByText('GP Paris')).toBeInTheDocument();
    expect(api.listNationalTournaments).not.toHaveBeenCalled();
  });

  it('prop deptCodes filtre par code département (facettes comprises)', async () => {
    render(<ThemeProvider><TournamentFinder items={NAT} deptCodes={['69']} /></ThemeProvider>);
    expect(await screen.findByText('Open Lyon')).toBeInTheDocument();
    expect(screen.queryByText('GP Paris')).not.toBeInTheDocument();
  });

  it('prop city matche aussi le nom du département', async () => {
    render(<ThemeProvider><TournamentFinder items={NAT} city="rhone" /></ThemeProvider>);
    expect(await screen.findByText('Open Lyon')).toBeInTheDocument();
    expect(screen.queryByText('GP Paris')).not.toBeInTheDocument();
  });

  it('onCount reçoit le nombre de résultats affichés', async () => {
    const onCount = jest.fn();
    render(<ThemeProvider><TournamentFinder items={NAT} onCount={onCount} /></ThemeProvider>);
    await screen.findByText('GP Paris');
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(2));
  });

  it('writeUrl préserve le hash', async () => {
    window.history.replaceState(null, '', '/decouvrir#tournois');
    render(<ThemeProvider><TournamentFinder items={NAT} /></ThemeProvider>);
    await screen.findByText('GP Paris');
    fireEvent.click(screen.getByRole('button', { name: 'Paris' }));
    await waitFor(() => expect(window.location.search).toContain('dept=75'));
    expect(window.location.hash).toBe('#tournois');
  });

  it('hideTitle (mode embarqué) : pas de minHeight plein écran', async () => {
    const { container } = render(<ThemeProvider><TournamentFinder hideTitle /></ThemeProvider>);
    await screen.findByText('GP Paris');
    expect((container.firstChild as HTMLElement).style.minHeight).toBe('');
  });

  it('hideTitle : étagère 2 lignes plafonnée à 8, la page /tournois autonome reste complète', async () => {
    const many: NationalTournament[] = Array.from({ length: 15 }, (_, i) => ({
      ...NAT[0], id: `t${i}`, name: `Tournoi ${i}`,
    }));
    const onCount = jest.fn();
    const { container, rerender } = render(
      <ThemeProvider><TournamentFinder hideTitle items={many} onCount={onCount} /></ThemeProvider>,
    );
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(8));
    expect(screen.getAllByText(/^Tournoi \d+$/)).toHaveLength(8);
    expect(container.querySelector('.discover-tournaments-grid')).not.toBeNull();
    expect(screen.getByText('8 tournois')).toBeInTheDocument();

    // La page autonome (pas de hideTitle) ne tronque rien.
    rerender(<ThemeProvider><TournamentFinder items={many} /></ThemeProvider>);
    expect(screen.getAllByText(/^Tournoi \d+$/)).toHaveLength(15);
  });

  it('0 résultat avec filtres actifs : bouton « Effacer les filtres » qui relance la liste', async () => {
    // Les facettes ne proposent jamais de combo à 0 résultat (design) → seul le filtre DATES
    // peut vider la liste. Posé de façon déterministe via le deep-link ?du=&au= (lu au montage).
    window.history.replaceState(null, '', '/?du=2030-01-01&au=2030-01-02');
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    expect(await screen.findByText('Aucun tournoi ne correspond à votre recherche.')).toBeInTheDocument();
    const btns = screen.getAllByRole('button', { name: /Effacer les filtres/ });
    fireEvent.click(btns[btns.length - 1]); // celui de l'état vide (le pied du tiroir en a un aussi)
    expect(await screen.findByText('GP Paris')).toBeInTheDocument();
  });
});
