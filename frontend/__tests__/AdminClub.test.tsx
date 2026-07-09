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
    adminGetClub: jest.fn().mockResolvedValue({ clubHouseSections: null }),
    adminUpdateClub: jest.fn().mockResolvedValue({}),
  },
}));
import { api } from '@/lib/api';

const wrap = () => render(<ThemeProvider><AdminClubPage /></ThemeProvider>);

describe('/admin/club', () => {
  beforeEach(() => { jest.clearAllMocks(); });

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

  it('carte Sections : lignes + Partenaires ; masquer une section → PATCH liste complète', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    expect(screen.getByText('Ça joue bientôt')).toBeInTheDocument();
    expect(screen.getByText('Partenaires')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Afficher Top du mois'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalled());
    const body = (api.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.clubHouseSections).toHaveLength(6);
    expect(body.clubHouseSections.find((s: { key: string }) => s.key === 'top')).toEqual({ key: 'top', visible: false });
  });

  it('carte Sections : ↓ sur la première ligne → ordre permuté dans le PATCH', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Descendre Ça joue bientôt'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalled());
    const body = (api.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.clubHouseSections[0].key).toBe('agenda');
    expect(body.clubHouseSections[1].key).toBe('matches');
  });

  it('carte Sections : curseur de vitesse du kiosque → PATCH clubHouseKioskSeconds (débouncé)', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Défilement des annonces')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Temps de pause entre deux annonces (secondes)'), { target: { value: '12' } });
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { clubHouseKioskSeconds: 12 }, 't'));
  });

  it('carte Sections : « Pas de défilement automatique » → PATCH 0 (manuel)', async () => {
    wrap();
    await waitFor(() => expect(screen.getByLabelText('Pas de défilement automatique')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Pas de défilement automatique'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { clubHouseKioskSeconds: 0 }, 't'));
  });

  it('carte Sections : config personnalisée → Réinitialiser → ConfirmDialog → PATCH null', async () => {
    (api.adminGetClub as jest.Mock).mockResolvedValueOnce({ clubHouseSections: [{ key: 'top', visible: false }] });
    wrap();
    await waitFor(() => expect(screen.getByText('Réinitialiser l’ordre par défaut')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Réinitialiser l’ordre par défaut'));
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { clubHouseSections: null }, 't'));
    await waitFor(() => expect(screen.queryByText('Réinitialiser l’ordre par défaut')).not.toBeInTheDocument());
  });
});
