import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FriendsQuickRow } from '@/components/social/FriendsQuickRow';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc', text: '#111', textMute: '#666', fontUI: 'sans-serif' } }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
const listClubFriends = jest.fn();
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: { listClubFriends: (...a: unknown[]) => listClubFriends(...a) } }));

describe('FriendsQuickRow', () => {
  beforeEach(() => { listClubFriends.mockReset(); });

  it('liste les amis du club et déclenche onPick au clic', async () => {
    listClubFriends.mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true }]);
    const onPick = jest.fn();
    render(<FriendsQuickRow slug="demo" token="t" excludeIds={[]} onPick={onPick} />);
    const chip = await screen.findByRole('button', { name: /léa/i });
    fireEvent.click(chip);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }));
  });

  it('masque les amis déjà ajoutés (excludeIds) et ne rend rien si vide', async () => {
    listClubFriends.mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true }]);
    const { container } = render(<FriendsQuickRow slug="demo" token="t" excludeIds={['u2']} onPick={jest.fn()} />);
    await waitFor(() => expect(listClubFriends).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement(); // tous filtrés → rien
  });
});
