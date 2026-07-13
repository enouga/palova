import { render, screen, waitFor } from '@testing-library/react';
import NewClubPage from '../app/clubs/new/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { PANEL_COPY } from '../lib/authShell';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null, loading: false }) }));
jest.mock('../lib/api', () => ({
  api: { getSports: jest.fn(), register: jest.fn(), createClub: jest.fn(), adminAddSport: jest.fn() },
  assetUrl: (p: string | null) => p,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const SPORTS = [
  { id: 'sport-padel', key: 'padel', name: 'Padel', resourceNoun: 'terrain', defaultSlotStepMin: 90, defaultDurationsMin: [90], icon: '🎾', surfaces: [], published: true, hasLighting: false },
];

describe('Page création de club (NewClubPage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getSports.mockResolvedValue(SPORTS);
  });

  it('rend le titre, le panneau B2B et le formulaire complet', async () => {
    render(<ThemeProvider><NewClubPage /></ThemeProvider>);
    expect(screen.getByRole('heading', { name: "Créez l'espace de votre club." })).toBeInTheDocument();
    expect(screen.getByText(PANEL_COPY.club.headline)).toBeInTheDocument(); // panneau Palova B2B
    expect(screen.getByLabelText('Prénom')).toBeInTheDocument();
    expect(screen.getByLabelText('Nom du club')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Sport principal')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Créer mon club' })).toBeInTheDocument();
  });

  it('explique que le compte créé est le compte gérant (admin) du club', async () => {
    render(<ThemeProvider><NewClubPage /></ThemeProvider>);
    expect(screen.getByText(/compte gérant \(administrateur\)/)).toBeInTheDocument();
    expect(screen.getByText(/nommer des admins et du staff/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Sport principal')).toBeInTheDocument());
  });
});
