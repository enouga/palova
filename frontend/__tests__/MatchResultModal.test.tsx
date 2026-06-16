import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MatchResultModal } from '@/components/match/MatchResultModal';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: { recordMatchResult: jest.fn().mockResolvedValue({ id: 'm1', status: 'PENDING' }) },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const players = [
  { userId: 'u1', firstName: 'A', lastName: 'A', avatarUrl: null },
  { userId: 'u2', firstName: 'B', lastName: 'B', avatarUrl: null },
  { userId: 'u3', firstName: 'C', lastName: 'C', avatarUrl: null },
  { userId: 'u4', firstName: 'D', lastName: 'D', avatarUrl: null },
];

it('enregistre un résultat 2+2 avec un set', async () => {
  const onSaved = jest.fn();
  render(<MatchResultModal reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={onSaved} />);
  fireEvent.click(screen.getByTestId('team1-u1'));
  fireEvent.click(screen.getByTestId('team1-u2'));
  fireEvent.click(screen.getByTestId('team2-u3'));
  fireEvent.click(screen.getByTestId('team2-u4'));
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  fireEvent.click(screen.getByText('Enregistrer'));
  await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
  const call = (api.recordMatchResult as jest.Mock).mock.calls[0];
  expect(call[0]).toBe('r1');
  expect(call[1].teams[1]).toEqual(expect.arrayContaining(['u1', 'u2']));
  expect(call[1].teams[2]).toEqual(expect.arrayContaining(['u3', 'u4']));
  expect(call[1].sets[0]).toEqual([6, 4]);
  expect(onSaved).toHaveBeenCalled();
});

it('désactive Enregistrer si composition incomplète', () => {
  render(<MatchResultModal reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByText('Enregistrer')).toBeDisabled();
});
