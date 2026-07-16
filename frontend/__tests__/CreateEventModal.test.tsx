import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { CreateEventModal } from '../components/admin/planning/CreateEventModal';
import type { AdminResource, ClubReservation, Member } from '../lib/api';

const resource = (over: Partial<AdminResource> = {}): AdminResource => ({
  id: 'court-1', name: 'Terrain 1', attributes: {}, isActive: true, price: '26.00', offPeakPrice: null,
  openHour: 8, closeHour: 22, slotStepMin: null,
  clubSport: { id: 'cs', slotStepMin: null, durationsMin: [90], sport: { key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultSlotStepMin: 30, defaultDurationsMin: [90], surfaces: [], hasLighting: false } },
  ...over,
});

const busyResa = (over: Partial<ClubReservation> = {}): ClubReservation => ({
  id: 'rv-busy', resourceId: 'court-1', startTime: '2026-07-12T15:00:00.000Z', endTime: '2026-07-12T16:00:00.000Z',
  status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '26.00', paidAmount: '0.00',
  resource: { id: 'court-1', name: 'Terrain 1' }, user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@x.fr' },
  payments: [], participants: [],
  ...over,
} as unknown as ClubReservation);

const member = (): Member => ({
  id: 'mem-1', userId: 'u9', firstName: 'Léa', lastName: 'Roy', email: 'l@x.fr', phone: null,
  isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null,
});

function setup(overrides: Partial<React.ComponentProps<typeof CreateEventModal>> = {}) {
  const onClose = jest.fn();
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  const createForResa = jest.fn().mockResolvedValue({ tempPassword: null, existed: false });
  const props = {
    open: true,
    onClose,
    resources: [resource()],
    members: [member()],
    coaches: [],
    reservationsOfDay: [] as ClubReservation[],
    gridDate: '2026-07-12',
    peak: null,
    tz: 'Europe/Paris',
    prefill: undefined,
    busy: false,
    error: null,
    onClearError: jest.fn(),
    onSubmit,
    createForResa,
    ...overrides,
  };
  render(<ThemeProvider><CreateEventModal {...props} /></ThemeProvider>);
  return { onClose, onSubmit, createForResa, props };
}

describe('CreateEventModal — préremplissage', () => {
  it("préremplit terrain, heure de début (depuis startHour) et durée par défaut du terrain", () => {
    setup({ prefill: { resourceId: 'court-1', startHour: 17 } });
    expect(screen.getByDisplayValue('17:00')).toBeInTheDocument();
    // durée par défaut du terrain (durationsMin: [90]) → 1h30 sélectionnée
    expect(screen.getByRole('button', { name: '1h30' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('CreateEventModal — saisie clavier de l\'heure', () => {
  it('taper "1830" et valider pose le début à 18:30 et met à jour le récap', () => {
    setup({ prefill: { resourceId: 'court-1', startHour: 17 } });
    const input = screen.getByDisplayValue('17:00');
    fireEvent.change(input, { target: { value: '1830' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('18:30')).toBeInTheDocument();
    expect(screen.getByText(/18:30.*20:00/)).toBeInTheDocument();
  });

  it('une saisie invalide au blur ne modifie pas l\'heure', () => {
    setup({ prefill: { resourceId: 'court-1', startHour: 17 } });
    const input = screen.getByDisplayValue('17:00');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('17:00')).toBeInTheDocument();
  });
});

describe('CreateEventModal — durée', () => {
  it('changer de chip de durée met à jour la fin affichée dans le récap', () => {
    setup({ prefill: { resourceId: 'court-1', startHour: 17 } });
    fireEvent.click(screen.getByRole('button', { name: '1h' }));
    expect(screen.getByText(/17:00.*18:00/)).toBeInTheDocument();
  });
});

describe('CreateEventModal — chips intelligentes', () => {
  it('cliquer « Prochain libre » saute par-dessus le créneau occupé et pose le début', () => {
    setup({
      prefill: { resourceId: 'court-1', startHour: 17 },
      reservationsOfDay: [busyResa()], // 17:00-18:00 heure de Paris (UTC+2 l'été)
    });
    fireEvent.click(screen.getByRole('button', { name: /Prochain libre/ }));
    expect(screen.getByDisplayValue('18:00')).toBeInTheDocument();
  });
});

describe('CreateEventModal — cours encadré (sélection du coach)', () => {
  const coaches = [
    { id: 'c-1', clubId: 'club-1', name: 'Lucas Moreau', photoUrl: null, isActive: true, sortOrder: 0 },
    { id: 'c-2', clubId: 'club-1', name: 'Jean Hub', photoUrl: null, isActive: true, sortOrder: 1 },
  ];

  it('choisir un coach via le picker cherchable (remplace l\'ancien <select>)', () => {
    setup({ prefill: { resourceId: 'court-1', startHour: 17 }, coaches });
    fireEvent.click(screen.getByRole('button', { name: 'Coaching' }));
    fireEvent.click(screen.getByText('Cours encadré (coach + élèves)'));
    fireEvent.focus(screen.getByPlaceholderText('Rechercher un coach…'));
    fireEvent.click(screen.getByText('Lucas Moreau'));
    // Sélectionné → repasse en chip avec « Changer », le champ de recherche disparaît.
    expect(screen.getByText('Lucas Moreau')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Rechercher un coach…')).not.toBeInTheDocument();
    expect(screen.getByText('Changer')).toBeInTheDocument();
  });
});

describe('CreateEventModal — conflit', () => {
  it('affiche un avertissement et désactive la création quand le créneau choisi chevauche une résa existante', () => {
    setup({
      prefill: { resourceId: 'court-1', startHour: 17 },
      reservationsOfDay: [busyResa()], // 17:00-18:00
    });
    expect(screen.getByText(/Chevauche/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer l'événement|Créer la série/ })).toBeDisabled();
  });

  it('« Créneau libre » et bouton actif quand rien ne chevauche', () => {
    setup({ prefill: { resourceId: 'court-1', startHour: 17 } });
    expect(screen.getByText('Créneau libre ✓')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer l'événement|Créer la série/ })).not.toBeDisabled();
  });
});

describe('CreateEventModal — prix suggéré', () => {
  it('affiche le tarif du terrain comme prix suggéré', () => {
    setup({ prefill: { resourceId: 'court-1', startHour: 17 } });
    expect(screen.getByText(/26 €/)).toBeInTheDocument();
  });
});

describe('CreateEventModal — soumission', () => {
  it('appelle onSubmit avec le formulaire composé (type/terrain/jour/début/durée)', async () => {
    const { onSubmit } = setup({ prefill: { resourceId: 'court-1', startHour: 17 } });
    fireEvent.click(screen.getByRole('button', { name: /Créer l'événement|Créer la série/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'COURT', resourceId: 'court-1', date: '2026-07-12', startTime: '17:00', durationMin: 90,
    }));
  });

  it('récurrence : affiche le jour de semaine et transmet recurring+endDate à la soumission', () => {
    const { onSubmit } = setup({ prefill: { resourceId: 'court-1', startHour: 17 } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Répéter chaque semaine/ }));
    expect(screen.getAllByText(/dimanches/).length).toBeGreaterThan(0); // 2026-07-12 est un dimanche
    fireEvent.click(screen.getByRole('button', { name: /Créer l'événement|Créer la série/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ recurring: true }));
  });
});
