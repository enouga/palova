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

const renderModal = (extra: Record<string, unknown> = {}) =>
  render(
    <ThemeProvider>
      <MatchResultModal reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}} {...extra} />
    </ThemeProvider>,
  );

function assignTeams() {
  fireEvent.click(screen.getByTestId('team1-u1'));
  fireEvent.click(screen.getByTestId('team1-u2'));
  fireEvent.click(screen.getByTestId('team2-u3'));
  fireEvent.click(screen.getByTestId('team2-u4'));
}

it('enregistre un résultat 2+2 avec un set', async () => {
  const onSaved = jest.fn();
  render(
    <ThemeProvider>
      <MatchResultModal reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={onSaved} />
    </ThemeProvider>,
  );
  assignTeams();
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  fireEvent.click(screen.getByText('Enregistrer'));
  await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
  const call = (api.recordMatchResult as jest.Mock).mock.calls[0];
  expect(call[0]).toBe('r1');
  expect(call[1].teams[1]).toEqual(expect.arrayContaining(['u1', 'u2']));
  expect(call[1].teams[2]).toEqual(expect.arrayContaining(['u3', 'u4']));
  expect(call[1].sets[0]).toEqual([6, 4]);
  expect(onSaved).toHaveBeenCalled();
});

it('désactive Enregistrer si composition incomplète', () => {
  renderModal();
  expect(screen.getByText('Enregistrer')).toBeDisabled();
});

it('affiche les noms des joueurs', () => {
  renderModal();
  expect(screen.getByText('Alice Martin')).toBeInTheDocument();
  expect(screen.getByText('David Petit')).toBeInTheDocument();
});

it('affiche le badge vainqueur après une saisie valide', () => {
  renderModal();
  assignTeams();
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  expect(screen.getByText(/Équipe 1 gagne/)).toBeInTheDocument();
});

it('affiche la ligne de contexte quand context est fourni', () => {
  renderModal({ context: { whenIso: '2026-06-20T16:30:00Z', tz: 'Europe/Paris', courtName: 'Court 2' } });
  expect(screen.getByText(/Court 2/)).toBeInTheDocument();
});

it('aucune ligne de contexte quand context est absent', () => {
  renderModal();
  expect(screen.queryByText(/Court 2/)).toBeNull();
});

it('affiche le vainqueur Équipe 2 quand elle gagne', () => {
  renderModal();
  assignTeams();
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  expect(screen.getByText(/Équipe 2 gagne/)).toBeInTheDocument();
});

it('pas de badge vainqueur si les sets sont à égalité (1 set chacun)', () => {
  renderModal();
  assignTeams();
  // set 1 : 6-4 (équipe 1)
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  // ajoute set 2 : 4-6 (équipe 2)
  fireEvent.click(screen.getByText('+ Ajouter un set'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set1-team1-plus'));
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set1-team2-plus'));
  expect(screen.queryByText(/gagne/)).toBeNull();
});
