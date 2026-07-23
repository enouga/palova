import { render, screen } from '@testing-library/react';
import { MyClubsRow } from '../components/platform/home/MyClubsRow';
import { ThemeProvider } from '../lib/ThemeProvider';
import { PlayerMembership } from '../lib/api';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p, api: {} }));

const membership = (slug: string, status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE'): PlayerMembership => ({
  clubId: `id-${slug}`, slug, isSubscriber: false, status,
  club: { id: `id-${slug}`, slug, name: slug.toUpperCase(), city: 'Paris', region: null, latitude: null, longitude: null,
    description: null, accentColor: '#5e93da', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 3 },
});

describe('MyClubsRow', () => {
  it('cartes des adhésions ACTIVE (lien vers l\'app du club) + carte « Trouver un club »', () => {
    render(<ThemeProvider><MyClubsRow memberships={[membership('padel-arena'), membership('bloque', 'BLOCKED')]} /></ThemeProvider>);
    const club = screen.getByRole('link', { name: /PADEL-ARENA/ });
    expect(club.getAttribute('href')).toContain('padel-arena.');
    expect(screen.queryByText('BLOQUE')).toBeNull(); // BLOCKED filtré
    expect(screen.getByRole('link', { name: /Trouver un club/ })).toHaveAttribute('href', '/decouvrir#clubs');
  });

  it('aucune adhésion → la carte « Trouver un club » reste (invitation)', () => {
    render(<ThemeProvider><MyClubsRow memberships={[]} /></ThemeProvider>);
    expect(screen.getByRole('link', { name: /Trouver un club/ })).toBeInTheDocument();
  });
});
