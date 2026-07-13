import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { SubscriptionActions } from '../components/admin/subscriptions/SubscriptionActions';
import { api } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    adminRenewSubscription: jest.fn().mockResolvedValue({ subscription: { id: 's1' } }),
    adminChangeSubscription: jest.fn().mockResolvedValue({ subscription: { id: 's-new' } }),
    adminCancelSubscription: jest.fn().mockResolvedValue({ id: 's1', status: 'CANCELLED' }),
  },
}));

const sub = { id: 's1', planId: 'p1', planName: 'Padel illimité', expiresAt: '2026-08-12T00:00:00Z', monthlyPriceSnapshot: '39.00' } as any;
const plans = [
  { id: 'p1', name: 'Padel illimité', monthlyPrice: '39.00', isActive: true } as any,
  { id: 'p2', name: 'Padel HC', monthlyPrice: '29.00', isActive: true } as any,
];
const wrap = (action: 'renew' | 'change' | 'cancel') => render(
  <ThemeProvider>
    <SubscriptionActions action={action} sub={sub} plans={plans} clubId="c1" token="t" onClose={jest.fn()} onDone={jest.fn()} />
  </ThemeProvider>,
);

it('Renouveler → CB appelle adminRenewSubscription', async () => {
  wrap('renew');
  fireEvent.click(screen.getByRole('button', { name: /Carte|CB/ }));
  fireEvent.click(screen.getByRole('button', { name: /Renouveler ·/ }));
  await waitFor(() => expect(api.adminRenewSubscription).toHaveBeenCalledWith('c1', 's1', expect.objectContaining({ method: 'CARD' }), 't'));
});

it('Changer → choix d\'un autre plan puis confirmer', async () => {
  wrap('change');
  fireEvent.click(screen.getByRole('button', { name: /Padel HC/ }));
  fireEvent.click(screen.getByRole('button', { name: /Confirmer le changement/ }));
  await waitFor(() => expect(api.adminChangeSubscription).toHaveBeenCalledWith('c1', 's1', expect.objectContaining({ planId: 'p2' }), 't'));
});

it('Résilier → confirmation appelle adminCancelSubscription', async () => {
  wrap('cancel');
  fireEvent.click(screen.getByRole('button', { name: /Résilier l’abonnement|Résilier l'abonnement/ }));
  await waitFor(() => expect(api.adminCancelSubscription).toHaveBeenCalledWith('c1', 's1', 't'));
});
