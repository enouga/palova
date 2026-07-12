import { render, screen } from '@testing-library/react';
import { ClubShowcase } from '@/components/clubhouse/ClubShowcase';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const club = {
  id: 'c1', slug: 'arena', name: 'Padel Arena', address: '1 rue', city: 'Paris',
  timezone: 'Europe/Paris', logoUrl: null, accentColor: '#5e93da',
  clubSports: [{
    id: 'cs1', slotStepMin: null, durationsMin: [], sport: { id: 's1', key: 'padel', name: 'Padel' },
    resources: [
      { id: 'r1', name: 'P1', attributes: { coverage: 'indoor' }, price: '25', openHour: 8, closeHour: 22 },
      { id: 'r2', name: 'P2', attributes: {}, price: '25', openHour: 8, closeHour: 22 },
    ],
  }],
} as any;

const pres = {
  presentationText: 'Le plus beau club du 11e.', coverImageUrl: '/uploads/covers/c.jpg',
  address: '1 rue', city: 'Paris', latitude: null, longitude: null,
  contactPhone: null, contactEmail: null, openingHoursText: null,
  foundedYear: 2021, amenities: ['bar', 'parking'],
  photos: [
    { id: 'p1', url: '/uploads/club-photos/1.jpg', caption: null, sortOrder: 0 },
    { id: 'p2', url: '/uploads/club-photos/2.jpg', caption: 'Terrasse', sortOrder: 1 },
  ],
} as any;

const NOON = new Date('2026-07-12T10:00:00Z'); // 12h à Paris → ouvert (8-22)

describe('ClubShowcase', () => {
  it('scène photo : kicker, titre, chips pistes + horaires vivants, CTA, bande Sur place', () => {
    render(<ThemeProvider><ClubShowcase presentation={pres} club={club} now={NOON} /></ThemeProvider>);
    expect(screen.getByText('Paris · Depuis 2021')).toBeInTheDocument();
    expect(screen.getByText('Padel Arena')).toBeInTheDocument();
    expect(screen.getByText('2 pistes · 1 indoor')).toBeInTheDocument();
    expect(screen.getByText("Ouvert · jusqu'à 22h")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Découvrir Padel Arena/i })).toHaveAttribute('href', '/club');
    expect(screen.getByText('Bar & cuisine')).toBeInTheDocument();
    expect(screen.getByText('2 photos')).toBeInTheDocument();
  });

  it('sans horloge (now null) la chip horaires est absente — hydration-safe', () => {
    render(<ThemeProvider><ClubShowcase presentation={pres} club={club} now={null} /></ThemeProvider>);
    expect(screen.queryByText(/Ouvert ·/)).toBeNull();
  });

  it('repli brume bleue : aucune photo → aucune <img>, contenu intact', () => {
    const { container } = render(
      <ThemeProvider><ClubShowcase presentation={{ ...pres, coverImageUrl: null, photos: [] }} club={club} now={NOON} /></ThemeProvider>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Padel Arena')).toBeInTheDocument();
  });

  it('bande « Sur place » masquée si aucun équipement', () => {
    render(<ThemeProvider><ClubShowcase presentation={{ ...pres, amenities: [] }} club={club} now={NOON} /></ThemeProvider>);
    expect(screen.queryByText('Sur place')).toBeNull();
  });
});
