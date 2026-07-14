import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MatchAlertSheet } from '@/components/openmatch/MatchAlertSheet';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: { createMatchAlert: jest.fn() },
  assetUrl: (u: string) => u,
}));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '#000' }) }) }));

const club = { slug: 'arena', timezone: 'Europe/Paris' } as any;

describe('MatchAlertSheet', () => {
  beforeEach(() => (api.createMatchAlert as jest.Mock).mockReset());

  it('crée une alerte avec date/from/to et appelle onCreated', async () => {
    (api.createMatchAlert as jest.Mock).mockResolvedValue({ id: 'a1', windowStart: '2026-07-16T16:00:00Z', windowEnd: '2026-07-16T19:00:00Z' });
    const onCreated = jest.fn();
    render(<MatchAlertSheet club={club} token="t" initial={{ date: '2026-07-16', from: '18:00', to: '21:00' }} onClose={() => {}} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole('button', { name: /créer l.alerte/i }));
    await waitFor(() => expect(api.createMatchAlert).toHaveBeenCalledWith('arena', { date: '2026-07-16', from: '18:00', to: '21:00' }, 't'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('affiche le message d\'erreur ALERT_LIMIT_REACHED', async () => {
    (api.createMatchAlert as jest.Mock).mockRejectedValue(new Error('ALERT_LIMIT_REACHED'));
    render(<MatchAlertSheet club={club} token="t" initial={{ date: '2026-07-16', from: '18:00', to: '21:00' }} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /créer l.alerte/i }));
    await waitFor(() => expect(screen.getByText(/déjà 5 alertes/i)).toBeInTheDocument());
  });
});
