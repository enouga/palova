import { render, screen, fireEvent } from '@testing-library/react';
import { FriendCard } from '@/components/social/FriendCard';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc',
  text: '#111', textMute: '#666', fontUI: 'sans-serif', fontDisplay: 'serif', mode: 'light',
} }) }));
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));

const friend = { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true,
  playedTogetherCount: 12, lastPlayedTogetherAt: '2026-07-11T10:00:00', level: null };
const NOW = new Date('2026-07-14T10:00:00');

it('affiche la ligne vivante et déclenche les actions', () => {
  const onInvite = jest.fn(); const onMessage = jest.fn(); const onRemove = jest.fn();
  render(<FriendCard friend={friend} now={NOW} onInvite={onInvite} onMessage={onMessage} onRemove={onRemove} />);
  expect(screen.getByText('12 parties ensemble · samedi')).toBeInTheDocument();
  fireEvent.click(screen.getByText('⚡ Inviter à jouer'));
  expect(onInvite).toHaveBeenCalledWith(friend);
  fireEvent.click(screen.getByLabelText('Écrire à Léa M'));
  expect(onMessage).toHaveBeenCalledWith(friend);
  fireEvent.click(screen.getByText('Retirer'));
  expect(onRemove).toHaveBeenCalledWith(friend);
});

it('sans historique commun : pas de ligne vivante', () => {
  render(<FriendCard friend={{ ...friend, playedTogetherCount: 0, lastPlayedTogetherAt: null }} now={NOW}
    onInvite={jest.fn()} onMessage={jest.fn()} onRemove={jest.fn()} />);
  expect(screen.queryByText(/ensemble/)).not.toBeInTheDocument();
});
