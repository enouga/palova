import { render, screen, waitFor } from '@testing-library/react';
import ClubPage from '@/app/club/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/components/ClubNav', () => ({ ClubNav: () => <nav /> }));
jest.mock('@/lib/ClubProvider', () => ({
  useClub: () => ({ club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris', address: '1 rue du Padel', city: 'Rodez', logoUrl: null, accentColor: '#5e93da', clubSports: [] }, slug: 'padel-arena' }),
}));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    getClubPresentation: jest.fn().mockResolvedValue({
      presentationText: 'Notre histoire…', coverImageUrl: null,
      address: '1 rue du Padel', city: 'Rodez', latitude: 44.35, longitude: 2.57,
      contactPhone: '0565', contactEmail: 'hello@club.fr', openingHoursText: 'Tous les jours 8h-22h',
      foundedYear: 2021, amenities: ['bar'],
      photos: [{ id: 'p1', url: '/uploads/club-photos/1.jpg', caption: 'Terrain central', sortOrder: 0 }],
    }),
  },
}));

describe('/club', () => {
  it('affiche présentation, galerie, infos pratiques avec itinéraire', async () => {
    render(<ThemeProvider><ClubPage /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Notre histoire…')).toBeInTheDocument());
    expect(screen.getByText('Tous les jours 8h-22h')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Itinéraire/i })[0]).toHaveAttribute('href', expect.stringContaining('google.com/maps'));
    expect(screen.getAllByRole('link', { name: /0565/ })[0]).toHaveAttribute('href', 'tel:0565');
  });

  it('hero + équipements + encart réserver', async () => {
    render(<ThemeProvider><ClubPage /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Notre histoire…')).toBeInTheDocument());
    expect(screen.getByText('Rodez · Depuis 2021')).toBeInTheDocument();
    expect(screen.getByText('Bar & cuisine')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Réserver un terrain/i })[0]).toHaveAttribute('href', '/reserver');
  });
});
