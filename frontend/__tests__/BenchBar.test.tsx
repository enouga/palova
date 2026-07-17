import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BenchBar } from '../components/tournament/BenchBar';
import { ThemeProvider } from '../lib/ThemeProvider';

const bench = [
  { userId: 'u1', firstName: 'Kevin', lastName: 'Vasseur', avatarUrl: null, phone: null, membershipNo: null, source: 'WALK_IN' as const },
  { userId: 'u2', firstName: 'Sarah', lastName: 'Marchand', avatarUrl: null, phone: null, membershipNo: '111', source: 'FORFEIT' as const },
];

it('tap un joueur du banc le sélectionne', async () => {
  const onTap = jest.fn();
  render(<ThemeProvider><BenchBar bench={bench} selection={[]} onTapPlayer={onTap} onAddWalkIn={jest.fn()} onPair={jest.fn()} /></ThemeProvider>);
  await userEvent.click(screen.getByText('Kevin Vasseur'));
  expect(onTap).toHaveBeenCalledWith('u1');
});

it('2 sélectionnés affichent le bouton Apparier', () => {
  render(<ThemeProvider><BenchBar bench={bench} selection={['u1', 'u2']} onTapPlayer={jest.fn()} onAddWalkIn={jest.fn()} onPair={jest.fn()} /></ThemeProvider>);
  expect(screen.getByRole('button', { name: /apparier/i })).toBeInTheDocument();
});

it('banc vide -> message neutre, pas de crash', () => {
  render(<ThemeProvider><BenchBar bench={[]} selection={[]} onTapPlayer={jest.fn()} onAddWalkIn={jest.fn()} onPair={jest.fn()} /></ThemeProvider>);
  expect(screen.getByText(/banc vide/i)).toBeInTheDocument();
});

it('bouton Apparier absent tant que moins de 2 sélectionnés', () => {
  render(<ThemeProvider><BenchBar bench={bench} selection={['u1']} onTapPlayer={jest.fn()} onAddWalkIn={jest.fn()} onPair={jest.fn()} /></ThemeProvider>);
  expect(screen.queryByRole('button', { name: /apparier/i })).not.toBeInTheDocument();
});

it('tap sur + déclenche onAddWalkIn', async () => {
  const onAddWalkIn = jest.fn();
  render(<ThemeProvider><BenchBar bench={bench} selection={[]} onTapPlayer={jest.fn()} onAddWalkIn={onAddWalkIn} onPair={jest.fn()} /></ThemeProvider>);
  await userEvent.click(screen.getByRole('button', { name: /ajouter un retardataire/i }));
  expect(onAddWalkIn).toHaveBeenCalled();
});
