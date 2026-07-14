import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { LevelOverrideForm } from '../components/admin/LevelOverrideForm';

// Comportements de LevelOverrideForm extraits de l'ex AdminMemberLevel.test.tsx (page [userId]
// supprimée, cf. Task 11) — la fiche cockpit (GameCard) réutilise ce composant tel quel.
const adminSetMemberLevel = jest.fn();
jest.mock('../lib/api', () => ({
  api: { adminSetMemberLevel: (...a: unknown[]) => adminSetMemberLevel(...a) },
}));

const SPORTS = [{ key: 'padel', name: 'Padel' }];
const wrap = (props: Partial<Parameters<typeof LevelOverrideForm>[0]> = {}) => {
  const onSaved = jest.fn();
  render(
    <ThemeProvider>
      <LevelOverrideForm clubId="c1" userId="u1" token="tok" sports={SPORTS} onSaved={onSaved} {...props} />
    </ThemeProvider>,
  );
  return { onSaved };
};

beforeEach(() => {
  jest.clearAllMocks();
  adminSetMemberLevel.mockResolvedValue({ calibrated: true, level: 5, tier: 'Confirmé', isProvisional: false, reliability: 95, matchesPlayed: 0 });
});

it('soumettre le formulaire appelle adminSetMemberLevel puis onSaved', async () => {
  const { onSaved } = wrap();
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText(/Motif/i), { target: { value: 'décision comité' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  await waitFor(() => expect(adminSetMemberLevel).toHaveBeenCalledWith(
    'c1', 'u1', { sportKey: 'padel', level: 5, reason: 'décision comité' }, 'tok',
  ));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('arrondit le niveau au dixième avant l\'envoi', async () => {
  wrap();
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '4.25' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  await waitFor(() => expect(adminSetMemberLevel).toHaveBeenCalledWith(
    'c1', 'u1', { sportKey: 'padel', level: 4.3, reason: undefined }, 'tok',
  ));
});

it('rejette côté client un niveau invalide (9) sans appeler l\'API', async () => {
  wrap();
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Niveau invalide (doit être entre 0 et 8).')).toBeInTheDocument();
  expect(adminSetMemberLevel).not.toHaveBeenCalled();
});

it('mappe une erreur 403 (FORBIDDEN) en message français', async () => {
  adminSetMemberLevel.mockRejectedValue(new Error('FORBIDDEN'));
  wrap();
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Réservé aux administrateurs du club.')).toBeInTheDocument();
});

it('affiche une confirmation de succès après une correction réussie, qui disparaît à la prochaine édition', async () => {
  wrap();
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
  expect(await screen.findByText('Niveau corrigé.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Niveau \(0–8\)/i), { target: { value: '6' } });
  expect(screen.queryByText('Niveau corrigé.')).not.toBeInTheDocument();
});

it('sélecteur de sport affiché seulement si plusieurs sports', () => {
  wrap({ sports: SPORTS });
  expect(screen.queryByLabelText('Sport')).not.toBeInTheDocument();
  const onSaved = jest.fn();
  render(
    <ThemeProvider>
      <LevelOverrideForm clubId="c1" userId="u1" token="tok" sports={[{ key: 'padel', name: 'Padel' }, { key: 'tennis', name: 'Tennis' }]} onSaved={onSaved} />
    </ThemeProvider>,
  );
  expect(screen.getByLabelText('Sport')).toBeInTheDocument();
});
