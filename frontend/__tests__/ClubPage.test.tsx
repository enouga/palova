import { render, screen, waitFor } from '@testing-library/react';
import ClubPage from '@/app/club/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/components/ClubNav', () => ({ ClubNav: () => <nav /> }));
jest.mock('@/lib/ClubProvider', () => ({
  useClub: () => ({ club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris', address: '1 rue du Padel', city: 'Rodez' }, slug: 'padel-arena' }),
}));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    getClubPresentation: jest.fn().mockResolvedValue({
      presentationText: 'Notre histoire…', coverImageUrl: null,
      address: '1 rue du Padel', city: 'Rodez', latitude: 44.35, longitude: 2.57,
      contactPhone: '0565', contactEmail: 'hello@club.fr', openingHoursText: 'Tous les jours 8h-22h',
      photos: [{ id: 'p1', url: '/uploads/club-photos/1.jpg', caption: 'Terrain central', sortOrder: 0 }],
    }),
  },
}));

describe('/club', () => {
  it('affiche présentation, galerie, infos pratiques avec itinéraire', async () => {
    render(<ThemeProvider><ClubPage /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Notre histoire…')).toBeInTheDocument());
    expect(screen.getByText('Tous les jours 8h-22h')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Itinéraire/i })).toHaveAttribute('href', expect.stringContaining('google.com/maps'));
    expect(screen.getByRole('link', { name: /0565/ })).toHaveAttribute('href', 'tel:0565');
  });
});
