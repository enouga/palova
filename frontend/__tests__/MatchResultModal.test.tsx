import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MatchResultModal } from '@/components/match/MatchResultModal';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: { recordMatchResult: jest.fn().mockResolvedValue({ id: 'm1', status: 'PENDING' }) },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const players = [
  { userId: 'u1', firstName: 'Alice', lastName: 'Martin', avatarUrl: null },
  { userId: 'u2', firstName: 'Bob', lastName: 'Durand', avatarUrl: null },
  { userId: 'u3', firstName: 'Chloe', lastName: 'Roy', avatarUrl: null },
  { userId: 'u4', firstName: 'David', lastName: 'Petit', avatarUrl: null },
];
const fullTeams = { u1: 1, u2: 1, u3: 2, u4: 2 } as Record<string, 1 | 2>;

const renderModal = (extra: Record<string, unknown> = {}) =>
  render(<ThemeProvider><MatchResultModal reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}} {...extra} /></ThemeProvider>);

const type = (digits: number[]) => digits.forEach((d) => fireEvent.click(screen.getByTestId(`key-${d}`)));

beforeEach(() => (api.recordMatchResult as jest.Mock).mockClear());

it('saisit un 6-4 6-3 au pavé et enregistre le bon payload', async () => {
  const onSaved = jest.fn();
  renderModal({ initialTeams: fullTeams, onSaved });
  type([6, 4, 6, 3]);
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
  await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
  const call = (api.recordMatchResult as jest.Mock).mock.calls.at(-1)!;
  expect(call[0]).toBe('r1');
  expect(call[1].teams[1]).toEqual(expect.arrayContaining(['u1', 'u2']));
  expect(call[1].teams[2]).toEqual(expect.arrayContaining(['u3', 'u4']));
  expect(call[1].sets).toEqual([[6, 4], [6, 3]]);
  expect(onSaved).toHaveBeenCalled();
});

it('Enregistrer désactivé tant que le score ne désigne pas un vainqueur', () => {
  renderModal({ initialTeams: fullTeams });
  expect(screen.getByRole('button', { name: /Enregistrer/ })).toBeDisabled();
  type([6, 4]); // un set gagné par l'Éq.1
  expect(screen.getByRole('button', { name: /Enregistrer/ })).toBeEnabled();
});

it('à 1-1 (6-4 puis 4-6) aucun vainqueur : Enregistrer reste désactivé', () => {
  renderModal({ initialTeams: fullTeams });
  type([6, 4, 4, 6]); // set 1 Éq.1, set 2 Éq.2 → égalité, il faut un 3e set
  expect(screen.getByRole('button', { name: /Enregistrer/ })).toBeDisabled();
});

it('taper une case la resélectionne pour corriger', () => {
  renderModal({ initialTeams: fullTeams });
  type([6, 4]);
  fireEvent.click(screen.getByTestId('cell-0-1'));
  type([7]);
  expect(screen.getByTestId('cell-0-1')).toHaveTextContent('7');
});

it('⌫ efface la dernière case remplie', () => {
  renderModal({ initialTeams: fullTeams });
  type([6, 4]); // curseur sur s1 Éq.1 (vide)
  fireEvent.click(screen.getByTestId('key-back'));
  expect(screen.getByTestId('cell-0-2')).toHaveTextContent('');
});

it('le CTA porte le résumé du vainqueur', () => {
  renderModal({ initialTeams: fullTeams });
  type([6, 4, 6, 3]);
  expect(screen.getByRole('button', { name: /Victoire Alice/ })).toBeInTheDocument();
});

it('affiche la ligne de contexte quand context est fourni', () => {
  renderModal({ initialTeams: fullTeams, context: { whenIso: '2026-06-20T16:30:00Z', tz: 'Europe/Paris', courtName: 'Court 2' } });
  expect(screen.getByText(/Court 2/)).toBeInTheDocument();
});

describe('affectation des équipes', () => {
  it('mode résumé quand initialTeams complet, « Modifier les équipes » révèle l\'affectation', () => {
    renderModal({ initialTeams: fullTeams });
    expect(screen.getByText('Modifier les équipes')).toBeInTheDocument();
    expect(screen.queryByTestId('team1-u1')).toBeNull();
    fireEvent.click(screen.getByText('Modifier les équipes'));
    expect(screen.getByTestId('team1-u1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('team2-u3')).toHaveAttribute('data-active', 'true');
  });

  it('initialTeams incomplet : affectation d\'abord, pavé après « Continuer »', () => {
    renderModal({ initialTeams: { u1: 1, u2: 1 } });
    expect(screen.getByTestId('team1-u1')).toBeInTheDocument();
    expect(screen.queryByTestId('key-6')).toBeNull();
    fireEvent.click(screen.getByTestId('team2-u3'));
    fireEvent.click(screen.getByTestId('team2-u4'));
    fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
    expect(screen.getByTestId('key-6')).toBeInTheDocument();
  });
});

describe('Amicale / Compétitive', () => {
  it('résa privée : segmented Compétitive par défaut, envoie competitive=false si Amicale', async () => {
    renderModal({ initialTeams: fullTeams });
    fireEvent.click(screen.getByRole('button', { name: /Amicale/ }));
    type([6, 4]);
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
    expect((api.recordMatchResult as jest.Mock).mock.calls.at(-1)![1].competitive).toBe(false);
  });

  it('partie ouverte (locked) : badge statique, pas de bouton de bascule', () => {
    renderModal({ initialTeams: fullTeams, locked: true, competitive: false });
    expect(screen.getByText(/Partie amicale/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Compétitive/ })).toBeNull();
  });
});
