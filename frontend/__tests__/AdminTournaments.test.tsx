import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminTournamentsPage from '../app/admin/tournaments/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const adminGetTournaments = jest.fn();
const adminGetSports = jest.fn();
const adminGetClub = jest.fn();
const adminCreateTournament = jest.fn();
const adminUpdateTournament = jest.fn();
const adminGetReferees = jest.fn();

jest.mock('../lib/api', () => ({
  api: {
    adminGetTournaments: (...a: unknown[]) => adminGetTournaments(...a),
    adminGetSports: (...a: unknown[]) => adminGetSports(...a),
    adminGetClub: (...a: unknown[]) => adminGetClub(...a),
    adminCreateTournament: (...a: unknown[]) => adminCreateTournament(...a),
    adminUpdateTournament: (...a: unknown[]) => adminUpdateTournament(...a),
    adminGetReferees: (...a: unknown[]) => adminGetReferees(...a),
    adminGetTournament: jest.fn(),
    adminPromoteRegistration: jest.fn(),
    adminRemoveRegistration: jest.fn(),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Demo', slug: 'demo' } }) }));

function renderPage() {
  return render(<ThemeProvider><AdminTournamentsPage /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  adminGetTournaments.mockResolvedValue([]);
  adminGetSports.mockResolvedValue([{ id: 'cs-padel', sport: { key: 'padel', name: 'Padel' } }]);
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
  adminCreateTournament.mockResolvedValue({});
  adminUpdateTournament.mockResolvedValue({});
  adminGetReferees.mockResolvedValue([]);
});

it('le formulaire Messieurs montre la case « Ouvert aux femmes » cochée par défaut', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const cb = await screen.findByRole('checkbox', { name: /Ouvert aux femmes/ });
  expect(cb).toBeChecked();
});

it('la case « Ouvert aux femmes » disparaît pour un tournoi Dames', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  await screen.findByRole('checkbox', { name: /Ouvert aux femmes/ }); // présente en Messieurs
  fireEvent.change(screen.getByDisplayValue('Messieurs'), { target: { value: 'WOMEN' } });
  await waitFor(() =>
    expect(screen.queryByRole('checkbox', { name: /Ouvert aux femmes/ })).not.toBeInTheDocument(),
  );
});

it('case « Inscription à régler en ligne » désactivée quand Stripe est NONE', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  expect(cb).toBeDisabled();
  expect(await screen.findByText(/Paiement en ligne →/)).toBeInTheDocument();
});

it('case « Inscription à régler en ligne » activée quand Stripe est ACTIVE', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  await waitFor(() => expect(cb).not.toBeDisabled());
  expect(screen.queryByText(/Paiement en ligne →/)).not.toBeInTheDocument();
});

it('cocher la case et créer envoie requirePrepayment: true', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  await waitFor(() => expect(cb).not.toBeDisabled());
  fireEvent.click(cb);
  fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
  await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
  const [, body] = adminCreateTournament.mock.calls[0];
  expect(body.requirePrepayment).toBe(true);
});

it('désigne un J/A du vivier dans le formulaire → refereeUserId envoyé', async () => {
  adminGetReferees.mockResolvedValue([
    { userId: 'u1', firstName: 'Léa', lastName: 'Girard', avatarUrl: null },
    { userId: 'u2', firstName: 'Julien', lastName: 'Martin', avatarUrl: null },
  ]);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const select = await screen.findByLabelText(/Juge-arbitre/i);
  await waitFor(() => expect(screen.getByRole('option', { name: 'Léa Girard' })).toBeInTheDocument());
  fireEvent.change(select, { target: { value: 'u1' } });
  fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
  await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
  expect(adminCreateTournament).toHaveBeenCalledWith('c1', expect.objectContaining({ refereeUserId: 'u1' }), 'tok');
});

it('« Aucun » (défaut) envoie refereeUserId null', async () => {
  adminGetReferees.mockResolvedValue([{ userId: 'u1', firstName: 'Léa', lastName: 'Girard', avatarUrl: null }]);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  await screen.findByLabelText(/Juge-arbitre/i);
  fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
  await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
  expect(adminCreateTournament).toHaveBeenCalledWith('c1', expect.objectContaining({ refereeUserId: null }), 'tok');
});

it('retirer le J/A après l\'avoir choisi renvoie à « Aucun » → null', async () => {
  adminGetReferees.mockResolvedValue([{ userId: 'u1', firstName: 'Léa', lastName: 'Girard', avatarUrl: null }]);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const select = await screen.findByLabelText(/Juge-arbitre/i);
  await waitFor(() => expect(screen.getByRole('option', { name: 'Léa Girard' })).toBeInTheDocument());
  fireEvent.change(select, { target: { value: 'u1' } });
  fireEvent.change(select, { target: { value: '' } }); // retour à « Aucun »
  fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
  await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
  expect(adminCreateTournament).toHaveBeenCalledWith('c1', expect.objectContaining({ refereeUserId: null }), 'tok');
});

// Sans cette phrase, un admin devant une liste vide n'a aucun moyen de deviner qu'il faut
// d'abord cocher « Juge-arbitre » sur une fiche membre.
it('vivier vide : « Aucun » seul + l\'aide explique comment peupler la liste', async () => {
  adminGetReferees.mockResolvedValue([]);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const select = await screen.findByLabelText(/Juge-arbitre/i);
  expect(within(select as HTMLSelectElement).getAllByRole('option')).toHaveLength(1);
  expect(screen.getByRole('option', { name: 'Aucun' })).toBeInTheDocument();
  expect(screen.getByText(/Cochez « Juge-arbitre » sur la fiche d’un membre/)).toBeInTheDocument();
});

it('le vivier indisponible (API en échec) ne casse pas le formulaire', async () => {
  adminGetReferees.mockRejectedValue(new Error('BOOM'));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouveau tournoi/ }));
  const select = await screen.findByLabelText(/Juge-arbitre/i);
  expect(within(select as HTMLSelectElement).getAllByRole('option')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
  await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
  expect(adminCreateTournament).toHaveBeenCalledWith('c1', expect.objectContaining({ refereeUserId: null }), 'tok');
});

describe('Modifier un tournoi existant (formulaire)', () => {
  it('affiche « Modifier » sur chaque carte et pré-remplit le formulaire', async () => {
    adminGetTournaments.mockResolvedValue([
      tournament({ id: 't1', name: 'Open Test', category: 'P250', gender: 'MIXED', status: 'PUBLISHED', startTime: new Date(Date.now() + 5 * 86_400_000).toISOString(), entryFee: '12', requirePrepayment: true }),
    ]);
    adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
    renderPage();

    const modifierBtn = await screen.findByRole('button', { name: /Modifier/ });
    fireEvent.click(modifierBtn);

    expect(await screen.findByText('Modifier le tournoi')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Open Test')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
    await waitFor(() => expect(cb).toBeChecked());
  });

  it('Enregistrer appelle adminUpdateTournament avec les champs édités', async () => {
    adminGetTournaments.mockResolvedValue([
      tournament({ id: 't1', name: 'Open Test', category: 'P250', gender: 'MIXED', status: 'PUBLISHED', startTime: new Date(Date.now() + 5 * 86_400_000).toISOString() }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Modifier/ }));
    const nameInput = await screen.findByDisplayValue('Open Test');
    fireEvent.change(nameInput, { target: { value: 'Open Test Renommé' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

    await waitFor(() => expect(adminUpdateTournament).toHaveBeenCalled());
    const [clubId, id, body, tok] = adminUpdateTournament.mock.calls[0];
    expect(clubId).toBe('c1');
    expect(id).toBe('t1');
    expect(body.name).toBe('Open Test Renommé');
    expect(tok).toBe('tok');
    expect(adminCreateTournament).not.toHaveBeenCalled();
  });

  it('« Nouveau tournoi » depuis un état d’édition repasse en mode création', async () => {
    adminGetTournaments.mockResolvedValue([
      tournament({ id: 't1', name: 'Open Test', category: 'P250', gender: 'MIXED', status: 'PUBLISHED', startTime: new Date(Date.now() + 5 * 86_400_000).toISOString() }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Modifier/ }));
    await screen.findByText('Modifier le tournoi');
    fireEvent.click(screen.getByRole('button', { name: /Nouveau tournoi/ }));

    await waitFor(() => expect(screen.queryByText('Modifier le tournoi')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
    expect(adminUpdateTournament).not.toHaveBeenCalled();
  });
});

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const tournament = (over: Record<string, unknown>) => ({
  id: 'x', clubId: 'c1', clubSportId: 'cs', category: 'P100', name: 'X', gender: 'MIXED',
  openToWomen: true, description: null, contactInfo: null, endTime: null,
  registrationDeadline: iso(1), maxTeams: 10, entryFee: null, requirePrepayment: false,
  confirmedCount: 0, waitlistCount: 0, ...over,
});

it('groupe les tournois par statut et montre les actions contextuelles', async () => {
  adminGetTournaments.mockResolvedValue([
    tournament({ id: 'd1', name: 'Brouillon Test', status: 'DRAFT', startTime: iso(10) }),
    tournament({ id: 'u1', name: 'A venir Test', status: 'PUBLISHED', startTime: iso(5) }),
    tournament({ id: 'p1', name: 'Passe Test', status: 'PUBLISHED', startTime: iso(-5) }),
  ]);
  renderPage();

  expect(await screen.findByText('Brouillon Test')).toBeInTheDocument();
  expect(screen.getByText('Brouillons')).toBeInTheDocument();
  expect(screen.getByText('Publiés · à venir')).toBeInTheDocument();
  expect(screen.getByText('Passés')).toBeInTheDocument();

  // Un seul « Publier » (le brouillon) et un seul « Annuler » (le publié à venir) ;
  // le passé n'a ni l'un ni l'autre → getByRole ne trouve qu'une occurrence de chaque.
  expect(screen.getByRole('button', { name: 'Publier' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
});

// T13b — la page est create-only : sans contrôle sur la carte, on ne pourrait désigner un J/A
// qu'à la seconde de la création (et jamais le remplacer, ni en donner un aux tournois existants).
describe('J/A d’un tournoi existant (carte de la liste)', () => {
  const REFEREES = [
    { userId: 'u1', firstName: 'Léa', lastName: 'Girard', avatarUrl: null },
    { userId: 'u2', firstName: 'Julien', lastName: 'Martin', avatarUrl: null },
  ];

  it('changer le J/A appelle adminUpdateTournament avec refereeUserId', async () => {
    adminGetReferees.mockResolvedValue(REFEREES);
    adminGetTournaments.mockResolvedValue([
      tournament({ id: 'u1t', name: 'A venir Test', status: 'PUBLISHED', startTime: iso(5), refereeUserId: null }),
    ]);
    renderPage();

    const select = await screen.findByLabelText('Juge-arbitre — A venir Test');
    await waitFor(() => expect(within(select as HTMLSelectElement).getByRole('option', { name: 'Léa Girard' })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: 'u1' } });

    await waitFor(() => expect(adminUpdateTournament).toHaveBeenCalled());
    expect(adminUpdateTournament).toHaveBeenCalledWith('c1', 'u1t', { refereeUserId: 'u1' }, 'tok');
  });

  it('choisir « Aucun » retire le J/A (null)', async () => {
    adminGetReferees.mockResolvedValue(REFEREES);
    adminGetTournaments.mockResolvedValue([
      tournament({ id: 'u1t', name: 'A venir Test', status: 'PUBLISHED', startTime: iso(5), refereeUserId: 'u1' }),
    ]);
    renderPage();

    const select = await screen.findByLabelText('Juge-arbitre — A venir Test');
    fireEvent.change(select, { target: { value: '' } });

    await waitFor(() => expect(adminUpdateTournament).toHaveBeenCalled());
    expect(adminUpdateTournament).toHaveBeenCalledWith('c1', 'u1t', { refereeUserId: null }, 'tok');
  });

  it('le J/A courant du tournoi est pré-sélectionné', async () => {
    adminGetReferees.mockResolvedValue(REFEREES);
    adminGetTournaments.mockResolvedValue([
      tournament({ id: 'u1t', name: 'A venir Test', status: 'PUBLISHED', startTime: iso(5), refereeUserId: 'u2' }),
    ]);
    renderPage();

    const select = await screen.findByLabelText('Juge-arbitre — A venir Test') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('u2'));
  });

  it('un J/A refusé par le serveur affiche un message lisible, pas le code brut', async () => {
    adminGetReferees.mockResolvedValue(REFEREES);
    adminGetTournaments.mockResolvedValue([
      tournament({ id: 'u1t', name: 'A venir Test', status: 'PUBLISHED', startTime: iso(5), refereeUserId: null }),
    ]);
    adminUpdateTournament.mockRejectedValue(new Error('REFEREE_INVALID'));
    renderPage();

    const select = await screen.findByLabelText('Juge-arbitre — A venir Test');
    fireEvent.change(select, { target: { value: 'u1' } });

    expect(await screen.findByText(/n’est pas juge-arbitre/i)).toBeInTheDocument();
    expect(screen.queryByText('REFEREE_INVALID')).not.toBeInTheDocument();
  });

  it('un tournoi annulé n’a pas de sélecteur de J/A', async () => {
    adminGetReferees.mockResolvedValue(REFEREES);
    adminGetTournaments.mockResolvedValue([
      tournament({ id: 'c1t', name: 'Annule Test', status: 'CANCELLED', startTime: iso(5) }),
    ]);
    renderPage();

    await screen.findByText('Annule Test');
    expect(screen.queryByLabelText('Juge-arbitre — Annule Test')).not.toBeInTheDocument();
  });

  // Le J/A garde sa mission quand on lui retire la facette (spec §4 : refereeUserId n'est pas
  // effacé, on recoche et il retrouve son tournoi). Le vivier ne le liste plus pour autant :
  // sans option correspondante, le select afficherait « Aucun » — une UI qui ment.
  it('J/A hors vivier : la carte le signale au lieu d’afficher « Aucun »', async () => {
    adminGetReferees.mockResolvedValue(REFEREES); // u3 n'y est plus
    adminGetTournaments.mockResolvedValue([
      tournament({ id: 'u1t', name: 'A venir Test', status: 'PUBLISHED', startTime: iso(5), refereeUserId: 'u3' }),
    ]);
    renderPage();

    const select = await screen.findByLabelText('Juge-arbitre — A venir Test') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('u3'));
    expect(within(select).getByRole('option', { name: /hors liste/i })).toBeInTheDocument();
  });

  // Vivier en échec → on ne sait pas si le J/A a perdu sa facette ; on ne prétend donc rien,
  // mais on n'efface pas non plus sa désignation de l'écran.
  it('vivier indisponible : le J/A désigné reste visible, sans cause inventée', async () => {
    adminGetReferees.mockRejectedValue(new Error('BOOM'));
    adminGetTournaments.mockResolvedValue([
      tournament({ id: 'u1t', name: 'A venir Test', status: 'PUBLISHED', startTime: iso(5), refereeUserId: 'u2' }),
    ]);
    renderPage();

    const select = await screen.findByLabelText('Juge-arbitre — A venir Test') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('u2')); // pas retombé sur « Aucun »
    expect(within(select).queryByRole('option', { name: /facette/i })).not.toBeInTheDocument();
  });
});

describe('Dupliquer un tournoi', () => {
  it('ouvre le formulaire en création, nom suffixé « (copie) », dates futures', async () => {
    adminGetTournaments.mockResolvedValue([
      tournament({
        id: 't1', name: 'Open Test', category: 'P250', gender: 'MIXED', status: 'PUBLISHED',
        startTime: iso(-30), endTime: null, registrationDeadline: iso(-33), maxTeams: 16, entryFee: '20',
      }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Dupliquer/ }));

    // mode création (pas édition)
    expect(screen.queryByText('Modifier le tournoi')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer/ })).toBeInTheDocument();
    // nom copié + suffixe
    expect(screen.getByDisplayValue('Open Test (copie)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
    expect(adminUpdateTournament).not.toHaveBeenCalled();
    const [, body] = adminCreateTournament.mock.calls[0];
    expect(body.name).toBe('Open Test (copie)');
    expect(body.category).toBe('P250');
    expect(body.maxTeams).toBe(16);
    expect(new Date(body.registrationDeadline).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(body.startTime).getTime()).toBeGreaterThan(Date.now());
  });

  it('ne copie pas le prépaiement quand Stripe est inactif', async () => {
    adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
    adminGetTournaments.mockResolvedValue([
      tournament({
        id: 't1', name: 'Open Test', status: 'PUBLISHED',
        startTime: iso(-30), registrationDeadline: iso(-33), requirePrepayment: true,
      }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Dupliquer/ }));
    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
    const [, body] = adminCreateTournament.mock.calls[0];
    expect(body.requirePrepayment).toBe(false);
  });

  it('ne copie pas un J/A absent du vivier', async () => {
    adminGetReferees.mockResolvedValue([{ userId: 'u1', firstName: 'Léa', lastName: 'Girard', avatarUrl: null }]);
    adminGetTournaments.mockResolvedValue([
      tournament({
        id: 't1', name: 'Open Test', status: 'PUBLISHED',
        startTime: iso(-30), registrationDeadline: iso(-33), refereeUserId: 'u9', // hors vivier
      }),
    ]);
    renderPage();

    // s'assurer que le vivier est chargé avant de dupliquer (le select J/A de la carte le prouve)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Léa Girard' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Dupliquer/ }));
    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
    const [, body] = adminCreateTournament.mock.calls[0];
    expect(body.refereeUserId).toBeNull();
  });
});
