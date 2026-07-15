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

describe('MatchResultModal', () => {
  it('pré-sélectionne les équipes depuis initialTeams', () => {
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" token="t" onClose={() => {}} onSaved={() => {}}
      players={[
        { userId: 'a', firstName: 'A', lastName: 'A', avatarUrl: null },
        { userId: 'b', firstName: 'B', lastName: 'B', avatarUrl: null },
        { userId: 'c', firstName: 'C', lastName: 'C', avatarUrl: null },
        { userId: 'd', firstName: 'D', lastName: 'D', avatarUrl: null },
      ]}
      initialTeams={{ a: 1, b: 1, c: 2, d: 2 }}
    /></ThemeProvider>);
    // Équipes complètes (2/2) → mode résumé par défaut ; « Modifier les équipes » révèle l'affectation pré-remplie.
    fireEvent.click(screen.getByText('Modifier les équipes'));
    expect(screen.getByTestId('team1-a')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('team2-c')).toHaveAttribute('data-active', 'true');
  });
});

it('permet de retirer un set ajouté (pas de bouton retirer avec un seul set)', () => {
  renderModal();
  expect(screen.queryByTestId('set0-remove')).toBeNull();
  fireEvent.click(screen.getByText('+ Ajouter un set'));
  expect(screen.getByTestId('set0-remove')).toBeInTheDocument();
  expect(screen.getByTestId('set1-remove')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('set1-remove'));
  expect(screen.queryByTestId('set1-remove')).toBeNull();
  expect(screen.queryByTestId('set0-remove')).toBeNull();
});

const fullTeams = { u1: 1, u2: 1, u3: 2, u4: 2 } as Record<string, 1 | 2>;

describe('MatchResultModal — mode résumé', () => {
  it('montre le résumé et cache les boutons 1/2 quand les équipes sont complètes', () => {
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}}
      initialTeams={fullTeams} /></ThemeProvider>);
    expect(screen.getByText('Modifier les équipes')).toBeInTheDocument();
    expect(screen.queryByTestId('team1-u1')).toBeNull();
    expect(screen.getByTestId('set0-team1-plus')).toBeInTheDocument();
  });

  it('« Modifier les équipes » révèle l\'affectation pré-remplie', () => {
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}}
      initialTeams={fullTeams} /></ThemeProvider>);
    fireEvent.click(screen.getByText('Modifier les équipes'));
    expect(screen.getByTestId('team1-u1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('team2-u3')).toHaveAttribute('data-active', 'true');
  });

  it('enregistre directement depuis le mode résumé', async () => {
    const onSaved = jest.fn();
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={onSaved}
      initialTeams={fullTeams} /></ThemeProvider>);
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
    const call = (api.recordMatchResult as jest.Mock).mock.calls.at(-1)!;
    expect(call[1].teams[1]).toEqual(expect.arrayContaining(['u1', 'u2']));
    expect(call[1].teams[2]).toEqual(expect.arrayContaining(['u3', 'u4']));
  });

  it('affiche l\'affectation directe si initialTeams incomplet', () => {
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}}
      initialTeams={{ u1: 1, u2: 1 }} /></ThemeProvider>);
    expect(screen.queryByText('Modifier les équipes')).toBeNull();
    expect(screen.getByTestId('team1-u1')).toBeInTheDocument();
  });
});

describe('MatchResultModal — Amicale/Compétitive', () => {
  it('résa privée : segmented par défaut Compétitive, envoie competitive au submit', async () => {
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}}
      initialTeams={fullTeams} /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Amicale/ }));
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
    const call = (api.recordMatchResult as jest.Mock).mock.calls.at(-1)!;
    expect(call[1].competitive).toBe(false);
  });

  it('partie ouverte (locked) : badge statique, pas de bouton de bascule', () => {
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}}
      initialTeams={fullTeams} locked competitive={false} /></ThemeProvider>);
    expect(screen.getByText(/Partie amicale/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Compétitive/ })).not.toBeInTheDocument();
  });
});
