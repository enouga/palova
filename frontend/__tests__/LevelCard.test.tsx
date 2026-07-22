import { render, screen, waitFor } from '@testing-library/react';
import { LevelCard } from '../components/platform/home/LevelCard';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p, api: { getMyRating: jest.fn() } }));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

describe('LevelCard', () => {
  it('pastille niveau + matchs joués + lien profil', async () => {
    mocked.getMyRating.mockResolvedValue({ calibrated: true, level: 6, tier: 'Confirmé', isProvisional: false, reliability: 93, matchesPlayed: 17 } as never);
    render(<ThemeProvider><LevelCard token="tok" /></ThemeProvider>);
    expect(await screen.findByText(/17 matchs joués/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ma progression/ })).toHaveAttribute('href', '/me/profile?tab=niveau');
  });

  it('pas de rating (level null) → rien', async () => {
    mocked.getMyRating.mockResolvedValue({ calibrated: false, level: null, tier: '—', isProvisional: true, reliability: 0, matchesPlayed: 0 } as never);
    const { container } = render(<ThemeProvider><LevelCard token="tok" /></ThemeProvider>);
    await waitFor(() => expect(mocked.getMyRating).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
