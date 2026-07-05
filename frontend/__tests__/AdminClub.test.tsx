import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminClubPage from '@/app/admin/club/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Padel Arena' } }) }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminGetPresentation: jest.fn().mockResolvedValue({
      presentationText: 'Texte', contactPhone: null, contactEmail: null, openingHoursText: null,
      coverImageUrl: null, photos: [{ id: 'p1', url: '/uploads/club-photos/1.jpg', caption: null, sortOrder: 0 }],
    }),
    adminUpdatePresentation: jest.fn().mockResolvedValue({}),
    adminAddClubPhoto: jest.fn(),
    adminUpdateClubPhoto: jest.fn(),
    adminDeleteClubPhoto: jest.fn().mockResolvedValue({ ok: true }),
  },
}));
import { api } from '@/lib/api';

const wrap = () => render(<ThemeProvider><AdminClubPage /></ThemeProvider>);

describe('/admin/club', () => {
  it('charge la présentation et enregistre les modifications', async () => {
    wrap();
    await waitFor(() => expect(screen.getByDisplayValue('Texte')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Présentation du club/i), { target: { value: 'Nouveau texte' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
    await waitFor(() => expect(api.adminUpdatePresentation).toHaveBeenCalledWith(
      'c1', expect.objectContaining({ presentationText: 'Nouveau texte' }), 't',
    ));
  });

  it('affiche la galerie avec compteur x/12 et suppression', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText(/1\/12/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Supprimer/i })).toBeInTheDocument();
  });
});
