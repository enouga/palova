import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClubProvider, useClub } from '../lib/ClubProvider';

jest.mock('../lib/api', () => ({
  api: { getClub: jest.fn() },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

// Consommateur de test : affiche le flag « paiement en ligne » du club du contexte,
// + un bouton qui déclenche le refresh exposé par le provider.
function Consumer() {
  const ctx = useClub() as ReturnType<typeof useClub> & { refresh?: () => void };
  return (
    <>
      <span data-testid="flag">{String(ctx.club?.requireOnlinePayment)}</span>
      <button onClick={() => ctx.refresh?.()}>refresh</button>
    </>
  );
}

describe('ClubProvider', () => {
  beforeEach(() => { mocked.getClub.mockReset(); });

  // Régression : l'admin active « Exiger le paiement CB » dans /admin/settings, mais le club
  // partagé (ClubProvider, fetché une seule fois au montage) restait périmé → la modale de
  // réservation proposait « Régler au club » au lieu du paiement en ligne. refresh() doit
  // recharger le club pour refléter le changement sans recharger la page.
  it('refresh() refetches the club so settings changes appear without a reload', async () => {
    mocked.getClub
      .mockResolvedValueOnce({ slug: 'demo', requireOnlinePayment: false } as never)
      .mockResolvedValueOnce({ slug: 'demo', requireOnlinePayment: true } as never);

    render(<ClubProvider slug="demo"><Consumer /></ClubProvider>);

    // Chargement initial : paiement en ligne désactivé.
    await waitFor(() => expect(screen.getByTestId('flag')).toHaveTextContent('false'));

    // L'admin vient d'activer le paiement en ligne → on rafraîchit le contexte.
    fireEvent.click(screen.getByText('refresh'));

    await waitFor(() => expect(screen.getByTestId('flag')).toHaveTextContent('true'));
    expect(mocked.getClub).toHaveBeenCalledTimes(2);
  });
});
