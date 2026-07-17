import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkTableTile } from '../components/tournament/MarkTableTile';
import { ThemeProvider } from '../lib/ThemeProvider';

const reg = {
  id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE', waitlistPosition: null,
  captain: { userId: 'c1', firstName: 'Bernard', lastName: 'X', avatarUrl: null, phone: null, membershipNo: null, presence: 'ABSENT' as const },
  partner: { userId: 'p1', firstName: 'Andre', lastName: 'Y', avatarUrl: null, phone: null, membershipNo: '999', presence: 'PRESENT' as const },
};

it('tap sur un joueur cycle la présence', async () => {
  const onTapPlayer = jest.fn();
  render(<ThemeProvider><MarkTableTile reg={reg} replaceHighlight={null} onTapPlayer={onTapPlayer} onTapReplaceTarget={jest.fn()} onOpenMenu={jest.fn()} /></ThemeProvider>);
  await userEvent.click(screen.getByText('Bernard X'));
  expect(onTapPlayer).toHaveBeenCalledWith('r1', 'CAPTAIN');
});

it('un slot ABSENT devient une cible de remplacement quand replaceHighlight est actif', async () => {
  const onTapReplaceTarget = jest.fn();
  render(<ThemeProvider><MarkTableTile reg={reg} replaceHighlight="u9" onTapPlayer={jest.fn()} onTapReplaceTarget={onTapReplaceTarget} onOpenMenu={jest.fn()} /></ThemeProvider>);
  await userEvent.click(screen.getByRole('button', { name: /mettre .* ici/i }));
  expect(onTapReplaceTarget).toHaveBeenCalledWith('r1', 'CAPTAIN');
});

it('un slot PRESENT n\'est jamais une cible même en mode remplacement', () => {
  render(<ThemeProvider><MarkTableTile reg={reg} replaceHighlight="u9" onTapPlayer={jest.fn()} onTapReplaceTarget={jest.fn()} onOpenMenu={jest.fn()} /></ThemeProvider>);
  expect(screen.queryByRole('button', { name: /mettre .* dans andre/i })).not.toBeInTheDocument();
});

it('tap sur ⋮ ouvre le menu (onOpenMenu appelé avec regId + side)', async () => {
  const onOpenMenu = jest.fn();
  render(<ThemeProvider><MarkTableTile reg={reg} replaceHighlight={null} onTapPlayer={jest.fn()} onTapReplaceTarget={jest.fn()} onOpenMenu={onOpenMenu} /></ThemeProvider>);
  await userEvent.click(screen.getByRole('button', { name: /options pour bernard x/i }));
  expect(onOpenMenu).toHaveBeenCalledWith('r1', 'CAPTAIN');
});
