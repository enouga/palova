import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkTable } from '@/components/tournament/MarkTable';
import { api } from '@/lib/api';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/api');

const view = {
  tournament: { id: 't1', name: 'Grand Prix', category: 'P500', gender: 'MEN', maxTeams: 12 },
  registrations: [{
    id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE', waitlistPosition: null,
    captain: { userId: 'c1', firstName: 'Bernard', lastName: 'X', avatarUrl: null, phone: null, membershipNo: null, presence: 'ABSENT' },
    partner: { userId: 'p1', firstName: 'Andre', lastName: 'Y', avatarUrl: null, phone: null, membershipNo: '999', presence: 'PRESENT' },
  }],
  bench: [{ userId: 'u9', firstName: 'Kevin', lastName: 'Vasseur', avatarUrl: null, phone: null, membershipNo: null, source: 'WALK_IN' }],
  recentLog: [], pointedCount: 1, totalSlots: 2, waitlistCount: 0,
};

function setup() {
  (api.getRefereeMarkTable as jest.Mock).mockResolvedValue(view);
  render(
    <ThemeProvider>
      <MarkTable mode="referee" slug="demo" tournamentId="t1" token="t" memberSearchSlug="demo" />
    </ThemeProvider>,
  );
}

it('affiche les chips vivantes', async () => {
  setup();
  expect(await screen.findByText(/1\s*\/\s*2 pointés/i)).toBeInTheDocument();
});

it('tap un joueur cycle la présence (optimiste + appel serveur)', async () => {
  (api.refereeSetPresence as jest.Mock).mockResolvedValue({ ok: true });
  setup();
  await userEvent.click(await screen.findByText('Bernard X'));
  await waitFor(() => expect(api.refereeSetPresence).toHaveBeenCalledWith('demo', 't1', 'r1', 'CAPTAIN', 'UNSEEN', 't'));
});

it('geste banc -> place : sélectionner Vasseur puis taper le slot ABSENT de Bernard remplace', async () => {
  (api.refereeReplacePlayer as jest.Mock).mockResolvedValue({ ok: true });
  setup();
  await userEvent.click(await screen.findByText('Kevin Vasseur'));
  const target = await screen.findByRole('button', { name: /mettre kevin/i });
  await userEvent.click(target);
  await waitFor(() => expect(api.refereeReplacePlayer).toHaveBeenCalledWith('demo', 't1', 'r1', 'CAPTAIN', 'u9', 't'));
});

it('erreur mappée en français', async () => {
  (api.refereeSetPresence as jest.Mock).mockRejectedValue(new Error('TOURNAMENT_NOT_YOURS'));
  setup();
  await userEvent.click(await screen.findByText('Bernard X'));
  expect(await screen.findByText(/n'êtes plus juge-arbitre/i)).toBeInTheDocument();
});

// Correctif obligatoire (cf. note d'implémenteur du plan, Task 14) : le forfait annule toute
// l'inscription — il ne doit JAMAIS pouvoir s'exécuter sans passer par une confirmation explicite.

it('le menu ⋮ ouvre des options, pas une action directe', async () => {
  setup();
  await userEvent.click(await screen.findAllByLabelText(/options pour/i).then((els) => els[0]));
  expect(await screen.findByText(/déclarer forfait/i)).toBeInTheDocument();
  expect(api.refereeForfeit).not.toHaveBeenCalled();
});

it("le forfait exige une confirmation avant l'appel réseau", async () => {
  (api.refereeForfeit as jest.Mock).mockResolvedValue({ id: 'r1' });
  setup();
  await userEvent.click(await screen.findAllByLabelText(/options pour/i).then((els) => els[0]));
  await userEvent.click(await screen.findByText(/déclarer forfait/i));
  expect(api.refereeForfeit).not.toHaveBeenCalled(); // pas encore — la confirmation n'a pas été validée
  await userEvent.click(await screen.findByRole('button', { name: /confirmer/i }));
  await waitFor(() => expect(api.refereeForfeit).toHaveBeenCalled());
});
