import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepSports } from '@/components/onboarding/StepSports';
import { StepCourts } from '@/components/onboarding/StepCourts';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { AdminClubSport, AdminResource, Sport } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminAddSport: jest.fn(),
    adminCreateResource: jest.fn(),
  },
}));
import { api } from '@/lib/api';

const catalog = [
  { id: 's-padel', key: 'padel', name: 'Padel', resourceNoun: 'piste', icon: '🎾', surfaces: [], published: true, hasLighting: true, defaultSlotStepMin: 30, defaultDurationsMin: [60, 90] },
  { id: 's-tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'court', icon: null, surfaces: [], published: true, hasLighting: true, defaultSlotStepMin: 30, defaultDurationsMin: [60] },
] as unknown as Sport[];

const padelCs = {
  id: 'cs-padel', slotStepMin: null, durationsMin: [],
  sport: { id: 's-padel', key: 'padel', name: 'Padel', resourceNoun: 'piste', defaultDurationsMin: [60, 90], surfaces: [], hasLighting: true },
} as unknown as AdminClubSport;

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('StepSports', () => {
  beforeEach(() => jest.clearAllMocks());

  it('le sport déjà actif est coché et non décochable ; en ajouter un appelle adminAddSport', async () => {
    (api.adminAddSport as jest.Mock).mockResolvedValue({ id: 'cs-tennis', sport: catalog[1] });
    const onAdded = jest.fn(); const advance = jest.fn();
    wrap(<StepSports clubName="Padel Riviera" catalog={catalog} clubSports={[padelCs]} clubId="c1" token="t" onAdded={onAdded} advance={advance} />);
    // Padel actif : le bouton est désactivé
    expect(screen.getByRole('checkbox', { name: /Padel/ })).toBeDisabled();
    // cocher Tennis puis continuer
    fireEvent.click(screen.getByRole('checkbox', { name: /Tennis/ }));
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(api.adminAddSport).toHaveBeenCalledWith('c1', 's-tennis', 't'));
    expect(onAdded).toHaveBeenCalled();
    expect(advance).toHaveBeenCalled();
  });

  it('sans nouveau sport coché, Continuer avance sans appel API', async () => {
    const advance = jest.fn();
    wrap(<StepSports clubName="Padel Riviera" catalog={catalog} clubSports={[padelCs]} clubId="c1" token="t" onAdded={jest.fn()} advance={advance} />);
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(advance).toHaveBeenCalled());
    expect(api.adminAddSport).not.toHaveBeenCalled();
  });
});

describe('StepCourts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('crée N terrains numérotés à la suite de l’existant, avec prix et couverture', async () => {
    (api.adminCreateResource as jest.Mock).mockImplementation((_c, body) => Promise.resolve({
      id: `r-${body.name}`, name: body.name, price: String(body.price), isActive: true,
      attributes: body.attributes, clubSport: padelCs,
    }));
    const onCreated = jest.fn(); const advance = jest.fn();
    wrap(<StepCourts clubName="Padel Riviera" clubSports={[padelCs]} resources={[]} clubId="c1" token="t" onCreated={onCreated} advance={advance} />);
    // stepper : 2 par défaut → prix requis
    fireEvent.change(screen.getByLabelText('Prix au créneau (€) — Padel'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(advance).toHaveBeenCalled());
    expect(api.adminCreateResource).toHaveBeenCalledTimes(2);
    expect(api.adminCreateResource).toHaveBeenNthCalledWith(1, 'c1',
      { clubSportId: 'cs-padel', name: 'Piste 1', price: 25, attributes: { coverage: 'indoor' } }, 't');
    expect(api.adminCreateResource).toHaveBeenNthCalledWith(2, 'c1',
      { clubSportId: 'cs-padel', name: 'Piste 2', price: 25, attributes: { coverage: 'indoor' } }, 't');
    expect(onCreated).toHaveBeenCalledTimes(2);
  });

  it('affiche l’existant et numérote à la suite', async () => {
    (api.adminCreateResource as jest.Mock).mockImplementation((_c, body) => Promise.resolve({
      id: `r-${body.name}`, name: body.name, price: String(body.price), isActive: true,
      attributes: body.attributes, clubSport: padelCs,
    }));
    const existing = [
      { id: 'r1', name: 'Piste 1', clubSport: padelCs, price: '25', isActive: true, attributes: {} },
      { id: 'r2', name: 'Piste 2', clubSport: padelCs, price: '25', isActive: true, attributes: {} },
    ] as unknown as AdminResource[];
    const advance = jest.fn();
    wrap(<StepCourts clubName="Padel Riviera" clubSports={[padelCs]} resources={existing} clubId="c1" token="t" onCreated={jest.fn()} advance={advance} />);
    expect(screen.getByText(/déjà 2 pistes/)).toBeInTheDocument();
    // en ajouter 1 : le compteur démarre à 0 quand il y a de l'existant
    fireEvent.click(screen.getByLabelText('Ajouter un terrain — Padel'));
    fireEvent.change(screen.getByLabelText('Prix au créneau (€) — Padel'), { target: { value: '30' } });
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(api.adminCreateResource).toHaveBeenCalledWith('c1',
      { clubSportId: 'cs-padel', name: 'Piste 3', price: 30, attributes: { coverage: 'indoor' } }, 't'));
  });

  it('prix manquant avec un compteur > 0 → erreur, aucun appel', async () => {
    const advance = jest.fn();
    wrap(<StepCourts clubName="Padel Riviera" clubSports={[padelCs]} resources={[]} clubId="c1" token="t" onCreated={jest.fn()} advance={advance} />);
    fireEvent.click(screen.getByText('Continuer →'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.adminCreateResource).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it('échec partiel : les créations réussies sont propagées, erreur affichée, pas d’avance', async () => {
    (api.adminCreateResource as jest.Mock)
      .mockResolvedValueOnce({ id: 'r-a', name: 'Piste 1', price: '25', isActive: true, attributes: {}, clubSport: padelCs })
      .mockRejectedValueOnce(new Error('boom'));
    const onCreated = jest.fn(); const advance = jest.fn();
    wrap(<StepCourts clubName="Padel Riviera" clubSports={[padelCs]} resources={[]} clubId="c1" token="t" onCreated={onCreated} advance={advance} />);
    fireEvent.change(screen.getByLabelText('Prix au créneau (€) — Padel'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Continuer →'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(advance).not.toHaveBeenCalled();
  });
});
