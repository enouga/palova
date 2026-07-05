import { render, screen } from '@testing-library/react';
import { ClubPresentationCard } from '@/components/clubhouse/ClubPresentationCard';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const pres = {
  presentationText: 'Le plus beau club du Sud-Ouest.', coverImageUrl: '/uploads/covers/c.jpg',
  address: '1 rue', city: 'Rodez', latitude: null, longitude: null,
  contactPhone: null, contactEmail: null, openingHoursText: null,
  photos: [{ id: 'p1', url: '/uploads/club-photos/1.jpg', caption: null, sortOrder: 0 }],
};

describe('ClubPresentationCard', () => {
  it('teaser : extrait + miniatures + lien vers /club', () => {
    render(<ThemeProvider><ClubPresentationCard presentation={pres} clubName="Padel Arena" /></ThemeProvider>);
    expect(screen.getByText(/plus beau club/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Découvrir le club/i })).toHaveAttribute('href', '/club');
  });

  it('rien si ni texte ni photos', () => {
    const { container } = render(
      <ThemeProvider><ClubPresentationCard presentation={{ ...pres, presentationText: null, photos: [] }} clubName="X" /></ThemeProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});
