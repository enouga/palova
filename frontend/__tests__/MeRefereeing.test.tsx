import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MeRefereeingPage from '../app/me/refereeing/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }), logout: jest.fn() }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: 'demo', club: { id: 'c1', name: 'Club', timezone: 'Europe/Paris' } }) }));
// ClubNav/ProfileMenu montés par la page : les stuber pour ne pas hériter de leurs appels API.
jest.mock('../components/ClubNav', () => ({ ClubNav: () => null }));
jest.mock('../components/ProfileMenu', () => ({ ProfileMenu: () => null }));
jest.mock('../lib/api', () => ({
  api: {
    getRefereeTournaments: jest.fn(),
    getRefereeRegistrations: jest.fn(),
    refereePromoteRegistration: jest.fn(),
    refereeRemoveRegistration: jest.fn(),
    getRefereeContactPolicy: jest.fn(),
    setRefereeContactPolicy: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const tournament = {
  id: 't1', name: 'Open de Paris', category: 'P250', gender: 'MEN', status: 'PUBLISHED',
  startTime: '2099-07-12T07:00:00Z', endTime: '2099-07-12T16:00:00Z',
  registrationDeadline: '2099-07-10T22:00:00Z',
  maxTeams: 16, confirmedCount: 12, waitlistCount: 2,
};

const player = (firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
  ({ firstName, lastName, avatarUrl: null, phone: null, membershipNo: null, ...extra });

const regs = [
  {
    id: 'r0', status: 'CONFIRMED', paymentStatus: 'NONE', waitlistPosition: null,
    captain: player('Ana', 'Blanc', { membershipNo: '123456', phone: '0611223344' }),
    partner: player('Luc', 'Cerf', { membershipNo: '654321' }),
  },
  {
    id: 'r1', status: 'WAITLISTED', paymentStatus: 'NONE', waitlistPosition: 1,
    captain: player('Zoe', 'Dumas'), partner: player('Max', 'Elan'),
  },
];

const mount = () => render(<ThemeProvider><MeRefereeingPage /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  (api.getRefereeTournaments as jest.Mock).mockResolvedValue([tournament]);
  (api.getRefereeRegistrations as jest.Mock).mockResolvedValue(regs);
  (api.getRefereeContactPolicy as jest.Mock).mockResolvedValue({ policy: 'AFTER_DEADLINE' });
});

it('NOT_A_REFEREE → message dédié, jamais le code d\'erreur brut', async () => {
  (api.getRefereeTournaments as jest.Mock).mockRejectedValue(new Error('NOT_A_REFEREE'));
  mount();
  await screen.findByText(/réservé aux juges-arbitres/i);
  expect(screen.queryByText(/NOT_A_REFEREE/)).not.toBeInTheDocument();
});

it('liste les tournois du J/A avec le compteur de binômes', async () => {
  mount();
  await screen.findByText('Open de Paris');
  expect(api.getRefereeTournaments).toHaveBeenCalledWith('demo', 'upcoming', 't');
  expect(screen.getByText(/12 \/ 16/)).toBeInTheDocument();
  expect(screen.getByText(/2 en attente/)).toBeInTheDocument();
});

it('ne charge pas les rosters tant qu\'on ne déplie pas', async () => {
  mount();
  await screen.findByText('Open de Paris');
  expect(api.getRefereeRegistrations).not.toHaveBeenCalled();
});

it('replier puis redéplier rafraîchit le roster (il bouge pendant le tournoi)', async () => {
  mount();
  await screen.findByText('Open de Paris');
  const inscrits = screen.getByRole('button', { name: /Inscrits/i });

  fireEvent.click(inscrits);
  await waitFor(() => expect(api.getRefereeRegistrations).toHaveBeenCalledTimes(1));
  fireEvent.click(inscrits); // replie : aucune requête
  expect(api.getRefereeRegistrations).toHaveBeenCalledTimes(1);
  fireEvent.click(inscrits); // redéplie : relit, sinon le J/A verrait un roster périmé
  await waitFor(() => expect(api.getRefereeRegistrations).toHaveBeenCalledTimes(2));
});

it('déplie le roster : licences visibles, puis promouvoir un binôme en attente', async () => {
  mount();
  await screen.findByText('Open de Paris');

  fireEvent.click(screen.getByRole('button', { name: /Inscrits/i }));
  await waitFor(() => expect(api.getRefereeRegistrations).toHaveBeenCalledWith('demo', 't1', 't'));

  // Le J/A vérifie les licences à la table de marque : elles doivent être lisibles.
  expect(await screen.findByText(/123456/)).toBeInTheDocument();
  expect(screen.getByText(/654321/)).toBeInTheDocument();
  expect(screen.getByText(/Ana Blanc/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^Promouvoir/ }));
  await waitFor(() => expect(api.refereePromoteRegistration).toHaveBeenCalledWith('demo', 't1', 'r1', 't'));
});

it('seul un binôme en attente est promouvable', async () => {
  mount();
  await screen.findByText('Open de Paris');
  fireEvent.click(screen.getByRole('button', { name: /Inscrits/i }));
  await screen.findByText(/123456/);
  // 2 binômes affichés, 1 seul WAITLISTED → un seul bouton Promouvoir.
  expect(screen.getAllByRole('button', { name: /^Promouvoir/ })).toHaveLength(1);
  expect(screen.getByText(/Liste d'attente 1/)).toBeInTheDocument();
});

it('retirer un binôme passe par une confirmation puis appelle l\'API', async () => {
  mount();
  await screen.findByText('Open de Paris');
  fireEvent.click(screen.getByRole('button', { name: /Inscrits/i }));
  await screen.findByText(/123456/);

  fireEvent.click(screen.getByRole('button', { name: /^Retirer Ana Blanc/ }));
  // ConfirmDialog ouvert : son bouton d'action porte le nom exact « Retirer » (confirmLabel).
  fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
  await waitFor(() => expect(api.refereeRemoveRegistration).toHaveBeenCalledWith('demo', 't1', 'r0', 't'));
});

it('bascule sur « Passés » recharge en scope past, sans action d\'écriture', async () => {
  mount();
  await screen.findByText('Open de Paris');
  fireEvent.click(screen.getByRole('button', { name: /Passés/i }));
  await waitFor(() => expect(api.getRefereeTournaments).toHaveBeenCalledWith('demo', 'past', 't'));

  fireEvent.click(screen.getByRole('button', { name: /Inscrits/i }));
  await screen.findByText(/123456/);
  expect(screen.queryByRole('button', { name: /^Promouvoir/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Retirer / })).not.toBeInTheDocument();
});

it('état vide selon le scope', async () => {
  (api.getRefereeTournaments as jest.Mock).mockResolvedValue([]);
  mount();
  await screen.findByText('Aucun tournoi à venir.');
  fireEvent.click(screen.getByRole('button', { name: /Passés/i }));
  await screen.findByText('Aucun tournoi passé.');
});

// Réglage de contactabilité : Segmented 3 états, persistance immédiate optimiste
// (la page n'a pas d'infrastructure brouillon/SaveBar — pattern ClubHouseSectionsCard).
describe('réglage de contactabilité', () => {
  it('affiche le réglage chargé avec ses 3 états', async () => {
    mount();
    await screen.findByText('Open de Paris');
    expect(await screen.findByRole('button', { name: 'Après clôture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toujours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jamais' })).toBeInTheDocument();
  });

  it('changer le réglage → PATCH avec la nouvelle valeur', async () => {
    (api.setRefereeContactPolicy as jest.Mock).mockResolvedValue({ policy: 'NEVER' });
    mount();
    await screen.findByText('Open de Paris');
    fireEvent.click(await screen.findByRole('button', { name: 'Jamais' }));
    await waitFor(() => expect(api.setRefereeContactPolicy).toHaveBeenCalledWith('demo', 'NEVER', 't'));
  });

  it('échec du PATCH → erreur affichée (et pas de crash)', async () => {
    (api.setRefereeContactPolicy as jest.Mock).mockRejectedValue(new Error('VALIDATION_ERROR'));
    mount();
    await screen.findByText('Open de Paris');
    fireEvent.click(await screen.findByRole('button', { name: 'Jamais' }));
    expect(await screen.findByText(/VALIDATION_ERROR/)).toBeInTheDocument();
  });

  it('pas J/A → pas de bloc Contact', async () => {
    (api.getRefereeTournaments as jest.Mock).mockRejectedValue(new Error('NOT_A_REFEREE'));
    (api.getRefereeContactPolicy as jest.Mock).mockRejectedValue(new Error('NOT_A_REFEREE'));
    mount();
    await screen.findByText(/réservé aux juges-arbitres/i);
    expect(screen.queryByRole('button', { name: 'Jamais' })).not.toBeInTheDocument();
  });
});
