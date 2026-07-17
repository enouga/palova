import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MemberPicker } from '@/components/tournament/MemberPicker';

// Factory mock (pas d'automock `jest.mock('@/lib/api')`) : `lib/api.ts` exporte des centaines de
// symboles et `Avatar` (rendu par ce composant) importe `assetUrl` — pattern déjà en place dans
// NewConversationPanel.test.tsx / AssociateMemberPicker.test.tsx.
jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: { searchClubMembers: jest.fn() },
}));
const apiMock = jest.requireMock('@/lib/api').api;

const renderPicker = (onPick = jest.fn(), onClose = jest.fn()) =>
  render(
    <ThemeProvider>
      <MemberPicker slug="demo" token="t" onPick={onPick} onClose={onClose} />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
});

it('champ vide -> invite à taper un nom, pas de recherche déclenchée', () => {
  renderPicker();
  expect(screen.getByText('Tapez un nom pour trouver un membre.')).toBeInTheDocument();
  expect(apiMock.searchClubMembers).not.toHaveBeenCalled();
});

it('cherche et sélectionne un membre', async () => {
  apiMock.searchClubMembers.mockResolvedValue([{ id: 'u9', firstName: 'Kevin', lastName: 'Vasseur' }]);
  const onPick = jest.fn();
  renderPicker(onPick);
  await userEvent.type(screen.getByPlaceholderText(/nom/i), 'Vasseur');
  await waitFor(() => expect(screen.getByText('Kevin Vasseur')).toBeInTheDocument());
  await userEvent.click(screen.getByText('Kevin Vasseur'));
  expect(onPick).toHaveBeenCalledWith('u9', 'Kevin Vasseur');
  await waitFor(() => expect(apiMock.searchClubMembers).toHaveBeenCalledWith('demo', 'Vasseur', 't'));
});

it('échec réseau -> message, pas de liste vide muette', async () => {
  apiMock.searchClubMembers.mockRejectedValue(new Error('fail'));
  renderPicker();
  await userEvent.type(screen.getByPlaceholderText(/nom/i), 'x');
  await waitFor(() => expect(screen.getByText(/indisponible/i)).toBeInTheDocument());
  expect(screen.queryByText('Aucun membre trouvé.')).not.toBeInTheDocument();
});

it('recherche sans résultat -> "Aucun membre trouvé."', async () => {
  apiMock.searchClubMembers.mockResolvedValue([]);
  renderPicker();
  await userEvent.type(screen.getByPlaceholderText(/nom/i), 'zzz');
  await waitFor(() => expect(screen.getByText('Aucun membre trouvé.')).toBeInTheDocument());
});

it('une recherche qui réussit après un échec efface le message d\'erreur', async () => {
  apiMock.searchClubMembers.mockRejectedValueOnce(new Error('down'));
  renderPicker();
  const input = screen.getByPlaceholderText(/nom/i);
  await userEvent.type(input, 'a');
  await waitFor(() => expect(screen.getByText(/indisponible/i)).toBeInTheDocument());
  apiMock.searchClubMembers.mockResolvedValue([{ id: 'u1', firstName: 'Anna', lastName: 'B' }]);
  await userEvent.type(input, 'nna');
  await waitFor(() => expect(screen.getByText('Anna B')).toBeInTheDocument());
  expect(screen.queryByText(/indisponible/i)).not.toBeInTheDocument();
});

it('clic sur le bouton Fermer appelle onClose', () => {
  const onClose = jest.fn();
  renderPicker(jest.fn(), onClose);
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onClose).toHaveBeenCalled();
});

it('clic sur le fond (hors panneau) appelle onClose', () => {
  const onClose = jest.fn();
  renderPicker(jest.fn(), onClose);
  fireEvent.click(screen.getByRole('dialog'));
  expect(onClose).toHaveBeenCalled();
});
