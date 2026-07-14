import { render, screen, fireEvent } from '@testing-library/react';
import { FriendRequestsBanner } from '@/components/social/FriendRequestsBanner';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc',
  text: '#111', textMute: '#666', fontUI: 'sans-serif', fontDisplay: 'serif', mode: 'light',
} }) }));
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p }));

const f = (id: string, first: string) => ({ id, firstName: first, lastName: 'X', avatarUrl: null, mutual: false });

it('rien sans demande', () => {
  const { container } = render(<FriendRequestsBanner requests={{ received: [], sent: [] }} busyId={null} onRespond={jest.fn()} onCancelSent={jest.fn()} />);
  expect(container.firstChild).toBeNull();
});

it('reçue : Accepter/Refuser appellent onRespond', () => {
  const onRespond = jest.fn();
  render(<FriendRequestsBanner requests={{ received: [f('u2', 'Léa')], sent: [] }} busyId={null} onRespond={onRespond} onCancelSent={jest.fn()} />);
  fireEvent.click(screen.getByText('Accepter'));
  expect(onRespond).toHaveBeenCalledWith('u2', true);
  fireEvent.click(screen.getByText('Refuser'));
  expect(onRespond).toHaveBeenCalledWith('u2', false);
});

it('envoyées : repliées, Annuler appelle onCancelSent', () => {
  const onCancelSent = jest.fn();
  render(<FriendRequestsBanner requests={{ received: [], sent: [f('u3', 'Tom')] }} busyId={null} onRespond={jest.fn()} onCancelSent={onCancelSent} />);
  expect(screen.queryByText('Tom X')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(/1 demande envoyée/));
  fireEvent.click(screen.getByText('Annuler'));
  expect(onCancelSent).toHaveBeenCalledWith('u3');
});
