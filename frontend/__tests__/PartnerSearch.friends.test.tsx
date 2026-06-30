import { render, screen, fireEvent } from '@testing-library/react';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc', text: '#111', textMute: '#666', textFaint:'#999', fontUI: 'sans-serif' } }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
const listClubFriends = jest.fn();
const searchClubMembers = jest.fn();
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: { listClubFriends: (...a: unknown[]) => listClubFriends(...a), searchClubMembers: (...a: unknown[]) => searchClubMembers(...a) } }));

describe('PartnerSearch — rangée Mes amis', () => {
  beforeEach(() => {
    listClubFriends.mockReset().mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true }]);
    searchClubMembers.mockReset().mockResolvedValue([]);
  });

  it('au focus, propose mes amis et les sélectionne au clic', async () => {
    const onSelect = jest.fn();
    render(<PartnerSearch slug="demo" token="t" selected={null} onSelect={onSelect} onClear={jest.fn()} />);
    fireEvent.focus(screen.getByPlaceholderText(/tapez un nom/i));
    fireEvent.click(await screen.findByRole('button', { name: /léa/i }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }));
  });
});
