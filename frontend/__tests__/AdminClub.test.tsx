import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminClubPage from '@/app/admin/club/page';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { AdminRoleContext } from '@/lib/adminRole';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Padel Arena' } }) }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminGetPresentation: jest.fn().mockResolvedValue({
      presentationText: 'Texte', contactPhone: null, contactEmail: null, openingHoursText: null,
      coverImageUrl: null, foundedYear: null, amenities: [],
      photos: [{ id: 'p1', url: '/uploads/club-photos/1.jpg', caption: null, sortOrder: 0 }],
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

const wrap = (role: 'OWNER' | 'ADMIN' | 'STAFF' | null = 'ADMIN') =>
  render(<AdminRoleContext.Provider value={role}><ThemeProvider><AdminClubPage /></ThemeProvider></AdminRoleContext.Provider>);

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

  it('édite année de création + équipements', async () => {
    wrap();
    await waitFor(() => expect(screen.getByLabelText(/Année de création/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Année de création/i), { target: { value: '2021' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Parking/i }));
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
    await waitFor(() => expect(api.adminUpdatePresentation).toHaveBeenCalledWith(
      'c1', expect.objectContaining({ foundedYear: 2021, amenities: ['parking'] }), 't',
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
    expect(body.clubHouseSections).toHaveLength(7);
    expect(body.clubHouseSections.find((s: { key: string }) => s.key === 'top')).toEqual({ key: 'top', visible: false });
  });

  it('carte Sections : ↓ sur « Ça joue bientôt » → ordre permuté dans le PATCH (kiosque reste en tête)', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Descendre Ça joue bientôt'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalled());
    const body = (api.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.clubHouseSections[0].key).toBe('kiosk');
    expect(body.clubHouseSections[1].key).toBe('agenda');
    expect(body.clubHouseSections[2].key).toBe('matches');
  });

  it('carte Sections : Partenaires est réordonnable comme les autres (flèche ↑)', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    expect(screen.getByText('Rivière de logos')).toBeInTheDocument();
    expect(screen.queryByText(/toujours en bas de page/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Descendre Partenaires')).toBeDisabled();
    expect(screen.getByLabelText('Monter Partenaires')).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText('Monter Partenaires'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalled());
    const body = (api.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.clubHouseSections).toHaveLength(7);
    expect(body.clubHouseSections[5].key).toBe('sponsors');
    expect(body.clubHouseSections[6].key).toBe('clubCard');
  });

  it('carte Sections : rangée « À la une » (kiosque) déplaçable/masquable, réglage de défilement replié', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    // Le kiosque est une rangée comme les autres : masquable et réordonnable.
    expect(screen.getByLabelText('Afficher À la une')).toBeInTheDocument();
    expect(screen.getByLabelText('Descendre À la une')).not.toBeDisabled();
    expect(screen.getByLabelText('Monter À la une')).toBeDisabled(); // en tête par défaut
    // Le réglage de défilement est replié tant qu'on ne l'ouvre pas.
    expect(screen.queryByLabelText('Temps de pause entre deux annonces (secondes)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Défilement/i }));
    expect(screen.getByLabelText('Temps de pause entre deux annonces (secondes)')).toBeInTheDocument();
  });

  it('carte Sections : curseur de vitesse du kiosque → PATCH clubHouseKioskSeconds (débouncé)', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Défilement/i })); // déplie le panneau du kiosque
    fireEvent.change(screen.getByLabelText('Temps de pause entre deux annonces (secondes)'), { target: { value: '12' } });
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { clubHouseKioskSeconds: 12 }, 't'));
  });

  it('carte Sections : « Pas de défilement automatique » → PATCH 0 (manuel)', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Défilement/i })); // déplie le panneau du kiosque
    fireEvent.click(screen.getByLabelText('Pas de défilement automatique'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { clubHouseKioskSeconds: 0 }, 't'));
  });

  it('carte Sections : rangée Offres → case « Vendre en ligne » pilote showOffersPublicly (pas le drapeau JSON)', async () => {
    (api.adminGetClub as jest.Mock).mockResolvedValueOnce({ clubHouseSections: null, showOffersPublicly: false });
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    const checkbox = screen.getByLabelText('Vendre en ligne') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { showOffersPublicly: true }, 't'));
    // N'a jamais touché clubHouseSections : ce n'est plus le drapeau qui gate cette section.
    expect((api.adminUpdateClub as jest.Mock).mock.calls[0][1]).not.toHaveProperty('clubHouseSections');
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

  it('viewer STAFF : la carte « Sections du Club-house » est masquée (le reste de la page rendu)', async () => {
    wrap('STAFF');
    // Ancre stable : le compteur de photos vient de la présentation (1 photo mockée).
    await waitFor(() => expect(screen.getByText(/1\/12/)).toBeInTheDocument());
    expect(screen.queryByText('Sections du Club-house')).not.toBeInTheDocument();
    // Assertion robuste au timing : la carte ne doit même pas monter (donc jamais fetcher) pour STAFF.
    expect(api.adminGetClub).not.toHaveBeenCalled();
  });
});
