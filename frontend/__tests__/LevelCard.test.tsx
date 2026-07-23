import { render, screen, waitFor } from '@testing-library/react';
import { LevelCard } from '../components/platform/home/LevelCard';
import { ThemeProvider } from '../lib/ThemeProvider';
import { clubUrl } from '../lib/clubUrl';
import type { PlayerMembership } from '../lib/api';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p, api: { getMyRating: jest.fn() } }));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

function membership(slug: string, status: PlayerMembership['status'] = 'ACTIVE'): PlayerMembership {
  return {
    clubId: `c-${slug}`, slug, isSubscriber: false, status,
    club: {
      id: `c-${slug}`, slug, name: slug, city: null, region: null, latitude: null, longitude: null,
      description: null, accentColor: '#000', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 1,
    },
  };
}

describe('LevelCard', () => {
  it('sans club (aucune adhésion active) : lien plateforme /me/profile?tab=niveau', async () => {
    mocked.getMyRating.mockResolvedValue({ calibrated: true, level: 6, tier: 'Confirmé', isProvisional: false, reliability: 93, matchesPlayed: 17 } as never);
    render(<ThemeProvider><LevelCard token="tok" memberships={[]} /></ThemeProvider>);
    expect(await screen.findByText(/17 matchs joués/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ma progression/ })).toHaveAttribute('href', '/me/profile?tab=niveau');
  });

  it('avec une adhésion active : lien vers le premier club (résultats club-scopés autrement absents)', async () => {
    mocked.getMyRating.mockResolvedValue({ calibrated: true, level: 6, tier: 'Confirmé', isProvisional: false, reliability: 93, matchesPlayed: 17 } as never);
    render(<ThemeProvider><LevelCard token="tok" memberships={[membership('padel-arena')]} /></ThemeProvider>);
    expect(await screen.findByText(/17 matchs joués/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ma progression/ })).toHaveAttribute('href', clubUrl('padel-arena', '/me/profile?tab=niveau'));
  });

  it('une adhésion BLOCKED n\'est pas retenue comme « premier club »', async () => {
    mocked.getMyRating.mockResolvedValue({ calibrated: true, level: 6, tier: 'Confirmé', isProvisional: false, reliability: 93, matchesPlayed: 17 } as never);
    render(<ThemeProvider><LevelCard token="tok" memberships={[membership('bloque', 'BLOCKED'), membership('padel-arena')]} /></ThemeProvider>);
    expect(await screen.findByText(/17 matchs joués/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ma progression/ })).toHaveAttribute('href', clubUrl('padel-arena', '/me/profile?tab=niveau'));
  });

  it('pas de rating (level null) → rien', async () => {
    mocked.getMyRating.mockResolvedValue({ calibrated: false, level: null, tier: '—', isProvisional: true, reliability: 0, matchesPlayed: 0 } as never);
    const { container } = render(<ThemeProvider><LevelCard token="tok" memberships={[]} /></ThemeProvider>);
    await waitFor(() => expect(mocked.getMyRating).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
