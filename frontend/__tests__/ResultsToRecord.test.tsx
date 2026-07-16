import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';

const row = {
  reservationId: 'r1', startTime: '2026-06-10T18:00:00Z', endTime: '2026-06-10T19:30:00Z',
  club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
  resourceName: 'Court 1', sport: { key: 'padel', name: 'Padel' },
  players: [
    { userId: 'u1', isOrganizer: true, firstName: 'A', lastName: 'A', avatarUrl: null, team: 1, slot: 0 },
    { userId: 'u2', isOrganizer: false, firstName: 'B', lastName: 'B', avatarUrl: null, team: 1, slot: 1 },
    { userId: 'u3', isOrganizer: false, firstName: 'C', lastName: 'C', avatarUrl: null, team: 2, slot: 0 },
    { userId: 'u4', isOrganizer: false, firstName: 'D', lastName: 'D', avatarUrl: null, team: 2, slot: 1 },
  ],
};

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: {
    getMatchesToRecord: jest.fn(),
    recordMatchResult: jest.fn().mockResolvedValue({ id: 'm1', status: 'PENDING' }),
  },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const wrap = (props = {}) => render(<ThemeProvider><ResultsToRecord token="t" {...props} /></ThemeProvider>);

beforeEach(() => (api.getMatchesToRecord as jest.Mock).mockReset());

it('n\'affiche rien quand la liste est vide', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([]);
  const { container } = wrap();
  await waitFor(() => expect(api.getMatchesToRecord).toHaveBeenCalled());
  expect(container.textContent).not.toContain('Résultat à saisir');
});

it('affiche une carte par match et filtre par club', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row, { ...row, reservationId: 'r2', club: { ...row.club, slug: 'autre' } }]);
  wrap({ clubSlug: 'arena' });
  await waitFor(() => expect(screen.getByText(/Court 1/)).toBeInTheDocument());
  expect(screen.getAllByText(/Résultat à saisir/)).toHaveLength(1);
});

it('ouvre la modale pré-remplie et masque la carte après enregistrement', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  const onRecorded = jest.fn();
  wrap({ onRecorded });
  await waitFor(() => expect(screen.getByText('Saisir')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Saisir'));
  expect(screen.getByText('Modifier les équipes')).toBeInTheDocument();
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  fireEvent.click(screen.getByText('Enregistrer'));
  await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
  expect(onRecorded).toHaveBeenCalled();
});

const namedRow = {
  ...row,
  players: [
    { userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Dupont', avatarUrl: null, team: 1, slot: 0 },
    { userId: 'u2', isOrganizer: false, firstName: 'Marie', lastName: 'Leroy', avatarUrl: null, team: 1, slot: 1 },
    { userId: 'u3', isOrganizer: false, firstName: 'Paul', lastName: 'Roux', avatarUrl: null, team: 2, slot: 0 },
    { userId: 'u4', isOrganizer: false, firstName: 'Lea', lastName: 'Girard', avatarUrl: null, team: 2, slot: 1 },
  ],
};

it('affiche les deux paires face à face avec le séparateur VS', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([namedRow]);
  wrap();
  // Variante compacte en test (matchMedia stubé à matches:false) → noms abrégés.
  await waitFor(() => expect(screen.getByText('J. Dupont & M. Leroy')).toBeInTheDocument());
  expect(screen.getByText('P. Roux & L. Girard')).toBeInTheDocument();
  expect(screen.getByText('vs')).toBeInTheDocument();
});

it('affiche le chip Compétitive par défaut', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  wrap();
  await waitFor(() => expect(screen.getByText('Compétitive')).toBeInTheDocument());
  expect(screen.queryByText('Amicale')).not.toBeInTheDocument();
});

it('affiche le chip Amicale quand competitive est false', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([{ ...row, competitive: false }]);
  wrap();
  await waitFor(() => expect(screen.getByText('Amicale')).toBeInTheDocument());
  expect(screen.queryByText('Compétitive')).not.toBeInTheDocument();
});

it('affiche le terrain et l\'horaire dans le pied de carte', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  wrap();
  await waitFor(() => expect(screen.getByText(/Court 1 ·/)).toBeInTheDocument());
});

it('rend le CTA long et les noms complets en desktop', async () => {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  try {
    (api.getMatchesToRecord as jest.Mock).mockResolvedValue([namedRow]);
    wrap();
    await waitFor(() => expect(screen.getByText('Saisir le score')).toBeInTheDocument());
    expect(screen.getByText('Jean Dupont & Marie Leroy')).toBeInTheDocument();
  } finally {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: original });
  }
});
