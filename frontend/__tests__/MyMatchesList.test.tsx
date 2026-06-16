import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MyMatchesList } from '@/components/match/MyMatchesList';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: { confirmMatch: jest.fn().mockResolvedValue({ ok: true }), disputeMatch: jest.fn().mockResolvedValue({ ok: true }) },
}));
import { api } from '@/lib/api';

const matches = [{
  matchId: 'm1', reservationId: 'r1', status: 'PENDING', sets: [[6, 4], [6, 3]] as [number, number][],
  playedAt: '2026-06-10T10:00:00Z', winningTeam: 1, myTeam: 2, myConfirmation: 'PENDING', ratingAfter: null, needsMyConfirmation: true,
}];

it('affiche le score et permet de confirmer', async () => {
  const onChanged = jest.fn();
  render(<MyMatchesList matches={matches as any} token="t" onChanged={onChanged} />);
  expect(screen.getByText('6-4 / 6-3')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Confirmer'));
  await waitFor(() => expect(api.confirmMatch).toHaveBeenCalledWith('m1', 't'));
  expect(onChanged).toHaveBeenCalled();
});

it('un match sans confirmation requise ne montre pas les boutons', () => {
  render(<MyMatchesList matches={[{ ...matches[0], needsMyConfirmation: false }] as any} token="t" onChanged={() => {}} />);
  expect(screen.queryByText('Confirmer')).toBeNull();
});
