import { render, screen, waitFor } from '@testing-library/react';
import { ClubPresentationClient } from '@/app/club/ClubPresentationClient';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { api } from '@/lib/api';

jest.mock('@/components/ClubNav', () => ({ ClubNav: () => <nav /> }));
const baseClub = { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris', address: '1 rue du Padel', city: 'Rodez', logoUrl: null, accentColor: '#5e93da', clubSports: [] as unknown[] };
const clubVal: { club: Record<string, unknown>; slug: string } = { club: baseClub, slug: 'padel-arena' };
jest.mock('@/lib/ClubProvider', () => ({
  useClub: () => clubVal,
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
  beforeEach(() => { clubVal.club = { ...baseClub }; });

  it('affiche présentation, galerie, infos pratiques avec itinéraire', async () => {
    render(<ThemeProvider><ClubPresentationClient /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Notre histoire…')).toBeInTheDocument());
    expect(screen.getByText('Tous les jours 8h-22h')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Itinéraire/i })[0]).toHaveAttribute('href', expect.stringContaining('google.com/maps'));
    expect(screen.getAllByRole('link', { name: /0565/ })[0]).toHaveAttribute('href', 'tel:0565');
  });

  it('hero + équipements + encart réserver', async () => {
    render(<ThemeProvider><ClubPresentationClient /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Notre histoire…')).toBeInTheDocument());
    expect(screen.getByText('Rodez · Depuis 2021')).toBeInTheDocument();
    expect(screen.getByText('Bar & cuisine')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Réserver un terrain/i })[0]).toHaveAttribute('href', '/reserver');
  });

  it("n'affiche pas deux fois la ville quand l'adresse la contient", async () => {
    clubVal.club = { ...clubVal.club, address: '12 rue du Padel, 75011 Paris', city: 'Paris' };
    render(<ThemeProvider><ClubPresentationClient /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Notre histoire…')).toBeInTheDocument());
    expect(await screen.findByText(/12 rue du Padel, 75011 Paris —/)).toBeInTheDocument();
    expect(screen.queryByText(/Paris, Paris/)).not.toBeInTheDocument();
  });

  it('texte horaires libre masque la chip horaires dérivée (pas de contradiction)', async () => {
    clubVal.club = {
      ...clubVal.club,
      clubSports: [{ sport: { name: 'Padel' }, resources: [{ openHour: 8, closeHour: 22 }] }],
    };
    render(<ThemeProvider><ClubPresentationClient /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Notre histoire…')).toBeInTheDocument());
    expect(screen.getByText('Tous les jours 8h-22h')).toBeInTheDocument();
    expect(screen.queryByText(/^Ouvert · jusqu'à/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Ouvre à/)).not.toBeInTheDocument();
  });

  it('sans texte horaires libre, la chip horaires dérivée reste affichée', async () => {
    clubVal.club = {
      ...clubVal.club,
      clubSports: [{ sport: { name: 'Padel' }, resources: [{ openHour: 0, closeHour: 24 }] }],
    };
    (api.getClubPresentation as jest.Mock).mockResolvedValueOnce({
      presentationText: 'Notre histoire…', coverImageUrl: null,
      address: '1 rue du Padel', city: 'Rodez', latitude: 44.35, longitude: 2.57,
      contactPhone: '0565', contactEmail: 'hello@club.fr', openingHoursText: null,
      foundedYear: 2021, amenities: ['bar'],
      photos: [{ id: 'p1', url: '/uploads/club-photos/1.jpg', caption: 'Terrain central', sortOrder: 0 }],
    });
    render(<ThemeProvider><ClubPresentationClient /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Notre histoire…')).toBeInTheDocument());
    expect(await screen.findByText(/^Ouvert · jusqu'à/)).toBeInTheDocument();
  });
});
