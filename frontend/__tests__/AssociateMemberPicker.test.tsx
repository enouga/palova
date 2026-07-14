import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssociateMemberPicker } from '../components/admin/caisse/AssociateMemberPicker';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    searchClubMembers: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));

const member = (over: Record<string, unknown> = {}) => ({
  id: 'mb', userId: 'u1', firstName: 'Léa', lastName: 'Roy', email: 'l@x.fr', phone: null,
  isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, ...over,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

const renderPicker = (props: Record<string, unknown> = {}) => render(
  <ThemeProvider>
    <AssociateMemberPicker slug="padel-arena-paris" token="tok" excludeIds={[]} members={[]}
      onSelect={jest.fn()} onCancel={jest.fn()} onCreate={jest.fn()} {...props} />
  </ThemeProvider>,
);

beforeEach(() => { jest.clearAllMocks(); (api.searchClubMembers as jest.Mock).mockResolvedValue([]); });

it('affiche l\'annuaire (avatars + niveau) SANS la rangée « Favoris ★ »', async () => {
  (api.searchClubMembers as jest.Mock).mockResolvedValueOnce([
    { id: 'u2', firstName: 'Nora', lastName: 'Kaci', level: null },
  ]);
  renderPicker();
  expect(await screen.findByText('Nora Kaci')).toBeInTheDocument();
  expect(screen.queryByText('Favoris ★')).not.toBeInTheDocument();
});

it('exclut les joueurs déjà présents', async () => {
  (api.searchClubMembers as jest.Mock).mockResolvedValueOnce([
    { id: 'u2', firstName: 'Nora', lastName: 'Kaci', level: null },
    { id: 'u3', firstName: 'Max', lastName: 'Bo', level: null },
  ]);
  renderPicker({ excludeIds: ['u3'] });
  expect(await screen.findByText('Nora Kaci')).toBeInTheDocument();
  expect(screen.queryByText('Max Bo')).not.toBeInTheDocument();
});

it('choisir un membre appelle onSelect avec son userId', async () => {
  (api.searchClubMembers as jest.Mock).mockResolvedValueOnce([
    { id: 'u2', firstName: 'Nora', lastName: 'Kaci', level: null },
  ]);
  const onSelect = jest.fn();
  renderPicker({ onSelect });
  fireEvent.click(await screen.findByRole('button', { name: /Nora Kaci/ }));
  expect(onSelect).toHaveBeenCalledWith('u2');
});

it('repli sur la liste locale des membres actifs si l\'annuaire échoue', async () => {
  (api.searchClubMembers as jest.Mock).mockRejectedValueOnce(new Error('MEMBERSHIP_REQUIRED'));
  renderPicker({ members: [member({ userId: 'u1', firstName: 'Léa', lastName: 'Roy' }), member({ userId: 'u4', firstName: 'Ali', lastName: 'Ben', status: 'BLOCKED' })] });
  expect(await screen.findByText('Léa Roy')).toBeInTheDocument();
  expect(screen.queryByText('Ali Ben')).not.toBeInTheDocument();   // bloqué → masqué
});

it('« + Créer un joueur » ouvre le formulaire et appelle onCreate', async () => {
  const onCreate = jest.fn().mockResolvedValue({ tempPassword: 'abc', existed: false });
  renderPicker({ onCreate });
  fireEvent.click(screen.getByRole('button', { name: /Créer un joueur/ }));
  fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Jo' } });
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Doe' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jo@x.fr' } });
  fireEvent.click(screen.getByRole('button', { name: /Créer le joueur/ }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Jo', lastName: 'Doe', email: 'jo@x.fr' })));
});
