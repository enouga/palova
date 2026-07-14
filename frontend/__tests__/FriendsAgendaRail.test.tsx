import { render, screen, fireEvent } from '@testing-library/react';
import { FriendsAgendaRail } from '@/components/social/FriendsAgendaRail';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc',
  text: '#111', textMute: '#666', fontUI: 'sans-serif', fontDisplay: 'serif', mode: 'light',
} }) }));
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p }));

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const item = {
  kind: 'match' as const, id: 'r1', startTime: '2026-07-18T16:30:00Z', endTime: null,
  label: 'Partie ouverte · Court 1',
  friends: [{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null }],
};

beforeEach(() => { push.mockReset(); });

it('rien si vide', () => {
  const { container } = render(<FriendsAgendaRail items={[]} timezone="Europe/Paris" />);
  expect(container.firstChild).toBeNull();
});

it('carte → navigation vers la partie', () => {
  render(<FriendsAgendaRail items={[item]} timezone="Europe/Paris" />);
  fireEvent.click(screen.getByText('Partie ouverte · Court 1'));
  expect(push).toHaveBeenCalledWith('/parties/r1');
});

it('tournoi → /tournois/:id', () => {
  render(<FriendsAgendaRail items={[{ ...item, kind: 'tournament', id: 't1', label: 'P100' }]} timezone="Europe/Paris" />);
  fireEvent.click(screen.getByText('P100'));
  expect(push).toHaveBeenCalledWith('/tournois/t1');
});
