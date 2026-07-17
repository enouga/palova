import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewClubByPlatform from '../app/superadmin/clubs/new/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const platformCreateClub = jest.fn();
jest.mock('../lib/api', () => ({
  api: {
    platformCreateClub: (...a: unknown[]) => platformCreateClub(...a),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok' }) }));

function renderPage() {
  return render(<ThemeProvider><NewClubByPlatform /></ThemeProvider>);
}

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/Nom du club/i), { target: { value: 'X' } });
  fireEvent.change(screen.getByLabelText(/Pr[ée]nom/i), { target: { value: 'A' } });
  fireEvent.change(screen.getByLabelText(/^Nom$/i), { target: { value: 'B' } });
  fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'a@b.fr' } });
  fireEvent.change(screen.getByLabelText(/^Mot de passe/i), { target: { value: 'password123' } });
}

beforeEach(() => jest.clearAllMocks());

it('transmet un SIRET optionnel si saisi', async () => {
  platformCreateClub.mockResolvedValue({ club: { id: 'c', slug: 's', name: 'X' }, owner: { id: 'o', email: 'e' } });
  renderPage();
  fillRequired();
  fireEvent.change(screen.getByLabelText(/SIRET/i), { target: { value: '44306184100047' } });
  fireEvent.click(screen.getByRole('button', { name: /cr[ée]er/i }));
  await waitFor(() => expect(platformCreateClub).toHaveBeenCalledWith(
    expect.objectContaining({ club: expect.objectContaining({ siret: '44306184100047' }) }), expect.anything()));
});

it('sans SIRET saisi, ne transmet pas de siret', async () => {
  platformCreateClub.mockResolvedValue({ club: { id: 'c', slug: 's', name: 'X' }, owner: { id: 'o', email: 'e' } });
  renderPage();
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: /cr[ée]er/i }));
  await waitFor(() => expect(platformCreateClub).toHaveBeenCalledWith(
    expect.objectContaining({ club: expect.objectContaining({ siret: undefined }) }), expect.anything()));
});

it('SIRET_INVALID affiche un message dédié', async () => {
  platformCreateClub.mockRejectedValue(new Error('SIRET_INVALID'));
  renderPage();
  fillRequired();
  fireEvent.change(screen.getByLabelText(/SIRET/i), { target: { value: 'abc' } });
  fireEvent.click(screen.getByRole('button', { name: /cr[ée]er/i }));
  expect(await screen.findByText(/SIRET invalide/)).toBeInTheDocument();
});
