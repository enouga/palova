import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminEventsPage from '../app/admin/events/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const adminGetEvents = jest.fn();
const adminGetClub = jest.fn();
const adminCreateEvent = jest.fn();
const adminUpdateEvent = jest.fn();
const adminDeleteEvent = jest.fn();
const adminCreateEventSeries = jest.fn();
const adminExtendEventSeries = jest.fn();
const adminCancelEventSeries = jest.fn();

jest.mock('../lib/api', () => ({
  api: {
    adminGetEvents: (...a: unknown[]) => adminGetEvents(...a),
    adminGetClub: (...a: unknown[]) => adminGetClub(...a),
    adminCreateEvent: (...a: unknown[]) => adminCreateEvent(...a),
    adminUpdateEvent: (...a: unknown[]) => adminUpdateEvent(...a),
    adminDeleteEvent: (...a: unknown[]) => adminDeleteEvent(...a),
    adminCreateEventSeries: (...a: unknown[]) => adminCreateEventSeries(...a),
    adminExtendEventSeries: (...a: unknown[]) => adminExtendEventSeries(...a),
    adminCancelEventSeries: (...a: unknown[]) => adminCancelEventSeries(...a),
    adminGetEvent: jest.fn(),
    adminPromoteEventRegistration: jest.fn(),
    adminRemoveEventRegistration: jest.fn(),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({
    club: { id: 'c1', name: 'Demo', slug: 'demo', timezone: 'Europe/Paris', clubSports: [] },
  }),
}));

function renderPage() {
  return render(<ThemeProvider><AdminEventsPage /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  adminGetEvents.mockResolvedValue([]);
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
  adminCreateEvent.mockResolvedValue({});
  adminUpdateEvent.mockResolvedValue({});
  adminDeleteEvent.mockResolvedValue({});
  adminCreateEventSeries.mockResolvedValue({ seriesId: 'series-1', created: 4 });
  adminExtendEventSeries.mockResolvedValue({ created: 2 });
  adminCancelEventSeries.mockResolvedValue({ cancelled: 2 });
});

it('affiche le formulaire au clic sur « Nouvel event »', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
  expect(await screen.findByPlaceholderText(/Mêlée du vendredi/)).toBeInTheDocument();
});

it('case « Inscription à régler en ligne » désactivée quand Stripe est NONE', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  expect(cb).toBeDisabled();
  expect(await screen.findByText(/Paiement en ligne →/)).toBeInTheDocument();
});

it('case « Inscription à régler en ligne » activée quand Stripe est ACTIVE', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  await waitFor(() => expect(cb).not.toBeDisabled());
  expect(screen.queryByText(/Paiement en ligne →/)).not.toBeInTheDocument();
});

it('cocher la case et créer envoie requirePrepayment: true', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  await waitFor(() => expect(cb).not.toBeDisabled());
  fireEvent.click(cb);
  fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
  await waitFor(() => expect(adminCreateEvent).toHaveBeenCalled());
  const [, body] = adminCreateEvent.mock.calls[0];
  expect(body.requirePrepayment).toBe(true);
});

it('supprimer un event (0 inscrit) demande confirmation avant d\'appeler l\'API', async () => {
  const existingEvent = {
    id: 'ev1', name: 'Mêlée test', kind: 'MELEE', description: '', status: 'DRAFT',
    startTime: '2026-07-01T10:00:00Z', endTime: null, registrationDeadline: '2026-06-30T10:00:00Z',
    capacity: null, price: null, memberOnly: false, clubSportId: null,
    requirePrepayment: false, confirmedCount: 0, waitlistCount: 0,
  };
  adminGetEvents.mockResolvedValue([existingEvent]);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
  expect(adminDeleteEvent).not.toHaveBeenCalled();
  const buttons = screen.getAllByRole('button', { name: 'Supprimer' });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(adminDeleteEvent).toHaveBeenCalledWith('c1', 'ev1', 'tok'));
});

it('éditer un event charge requirePrepayment depuis l\'event existant', async () => {
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' });
  const existingEvent = {
    id: 'ev1', name: 'Mêlée test', kind: 'MELEE', description: '', status: 'DRAFT',
    startTime: '2026-07-01T10:00:00Z', endTime: null, registrationDeadline: '2026-06-30T10:00:00Z',
    capacity: null, price: null, memberOnly: false, clubSportId: null,
    requirePrepayment: true, confirmedCount: 0, waitlistCount: 0,
  };
  adminGetEvents.mockResolvedValue([existingEvent]);
  renderPage();
  const modifierBtn = await screen.findByRole('button', { name: /Modifier/ });
  fireEvent.click(modifierBtn);
  const cb = await screen.findByRole('checkbox', { name: /Inscription à régler en ligne/ });
  await waitFor(() => expect(cb).toBeChecked());
});

describe('récurrence hebdomadaire', () => {
  it('la case « Se répète chaque semaine » est décochée par défaut : soumission = adminCreateEvent', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Mêlée du vendredi/), { target: { value: 'Mêlée' } });
    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateEvent).toHaveBeenCalled());
    expect(adminCreateEventSeries).not.toHaveBeenCalled();
  });

  it('cocher la case affiche les champs de récurrence (jour, date de fin, délai de clôture)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Se répète chaque semaine/i }));
    expect(await screen.findByLabelText(/Jour de la semaine/i)).toBeInTheDocument();
  });

  it('récurrent sans heure de fin → message d\'erreur explicite, aucun appel API (la durée d\'une occurrence vient de Début→Fin)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Mêlée du vendredi/), { target: { value: 'Mêlée du jeudi' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Se répète chaque semaine/i }));
    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    expect(await screen.findByText(/heure de fin est requise/i)).toBeInTheDocument();
    expect(adminCreateEventSeries).not.toHaveBeenCalled();
    expect(adminCreateEvent).not.toHaveBeenCalled();
  });

  it('affiche la puce « Série » et le bouton « Série… » sur un event avec seriesId', async () => {
    adminGetEvents.mockResolvedValue([{
      id: 'ev1', name: 'Mêlée du jeudi', kind: 'MELEE', status: 'PUBLISHED',
      startTime: new Date(Date.now() + 86400_000).toISOString(), endTime: null,
      registrationDeadline: new Date(Date.now() + 3600_000).toISOString(),
      capacity: null, price: null, memberOnly: true, confirmedCount: 0, waitlistCount: 0,
      seriesId: 'series-1',
    }]);
    renderPage();
    expect(await screen.findByText('Série')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Série…/ })).toBeInTheDocument();
  });

  it('« Prolonger » depuis le dialog appelle adminExtendEventSeries avec la nouvelle date', async () => {
    adminGetEvents.mockResolvedValue([{
      id: 'ev1', name: 'Mêlée du jeudi', kind: 'MELEE', status: 'PUBLISHED',
      startTime: new Date(Date.now() + 86400_000).toISOString(), endTime: null,
      registrationDeadline: new Date(Date.now() + 3600_000).toISOString(),
      capacity: null, price: null, memberOnly: true, confirmedCount: 0, waitlistCount: 0,
      seriesId: 'series-1',
    }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Série…/ }));
    expect(await screen.findByText(/Gérer la série/i)).toBeInTheDocument();
    // Le champ « Nouvelle date de fin » n'est qu'un DateField (pas d'heure) : un clic sur le
    // déclencheur puis « Aujourd'hui » suffit à lui donner une valeur valide.
    fireEvent.click(screen.getByRole('button', { name: /Nouvelle date de fin/i }));
    fireEvent.click(screen.getByRole('button', { name: /Aujourd'hui/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Prolonger$/i }));
    await waitFor(() => expect(adminExtendEventSeries).toHaveBeenCalledWith('c1', 'series-1', expect.any(String), 'tok'));
  });

  it('« Annuler la série » puis confirmer appelle adminCancelEventSeries', async () => {
    adminGetEvents.mockResolvedValue([{
      id: 'ev1', name: 'Mêlée du jeudi', kind: 'MELEE', status: 'PUBLISHED',
      startTime: new Date(Date.now() + 86400_000).toISOString(), endTime: null,
      registrationDeadline: new Date(Date.now() + 3600_000).toISOString(),
      capacity: null, price: null, memberOnly: true, confirmedCount: 0, waitlistCount: 0,
      seriesId: 'series-1',
    }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Série…/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Annuler la série/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Confirmer$/i }));
    await waitFor(() => expect(adminCancelEventSeries).toHaveBeenCalledWith('c1', 'series-1', 'tok'));
  });
});

describe('Dupliquer un event', () => {
  const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  it('ouvre la création pré-remplie, nom « (copie) », sans récurrence, dates futures', async () => {
    adminGetEvents.mockResolvedValue([
      {
        id: 'e1', name: 'Mêlée Test', kind: 'MELEE', description: '', status: 'PUBLISHED',
        startTime: iso(-20), endTime: null, registrationDeadline: iso(-22),
        capacity: 12, price: '8', memberOnly: true, clubSportId: null,
        requirePrepayment: false, confirmedCount: 0, waitlistCount: 0,
      },
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Dupliquer/ }));

    // mode création (pas édition)
    expect(screen.queryByText("Modifier l'event")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer/ })).toBeInTheDocument();
    // nom copié + suffixe
    expect(screen.getByDisplayValue('Mêlée Test (copie)')).toBeInTheDocument();
    // la récurrence n'est pas héritée
    expect(screen.getByRole('checkbox', { name: /Se répète chaque semaine/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateEvent).toHaveBeenCalled());
    expect(adminUpdateEvent).not.toHaveBeenCalled();
    expect(adminCreateEventSeries).not.toHaveBeenCalled();
    const [, body] = adminCreateEvent.mock.calls[0];
    expect(body.name).toBe('Mêlée Test (copie)');
    expect(body.capacity).toBe(12);
    expect(body.memberOnly).toBe(true);
    expect(new Date(body.startTime).getTime()).toBeGreaterThan(Date.now());
  });
});
