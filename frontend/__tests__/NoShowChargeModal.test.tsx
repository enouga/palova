import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import NoShowChargeModal from '@/components/admin/NoShowChargeModal';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: {
    getNoShowPreview: jest.fn(),
    chargeNoShow: jest.fn(),
  },
}));

const base = {
  clubId: 'club-1',
  reservationId: 'res-1',
  defaultAmount: 25,
  token: 'tok',
  onSuccess: jest.fn(),
  onClose: jest.fn(),
};

const wrap = (over = {}) => render(<ThemeProvider><NoShowChargeModal {...base} {...over} /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

describe('NoShowChargeModal — récidive', () => {
  it('charge l\'aperçu de récidive au montage avec clubId/reservationId/token', async () => {
    (api.getNoShowPreview as jest.Mock).mockResolvedValue({ previousCount: 0, lastChargedAt: null });
    wrap();
    await waitFor(() => expect(api.getNoShowPreview).toHaveBeenCalledWith('club-1', 'res-1', 'tok'));
  });

  it('affiche un avertissement si le joueur a déjà été facturé pour no-show', async () => {
    (api.getNoShowPreview as jest.Mock).mockResolvedValue({ previousCount: 2, lastChargedAt: '2026-06-17T20:00:00.000Z' });
    wrap();
    expect(await screen.findByText(/déjà facturé 2 fois/i)).toBeInTheDocument();
  });

  it('n\'affiche rien si aucun no-show antérieur', async () => {
    (api.getNoShowPreview as jest.Mock).mockResolvedValue({ previousCount: 0, lastChargedAt: null });
    wrap();
    await waitFor(() => expect(api.getNoShowPreview).toHaveBeenCalled());
    expect(screen.queryByText(/déjà facturé/i)).not.toBeInTheDocument();
  });

  it('reste utilisable si l\'aperçu échoue (best-effort, pas de blocage)', async () => {
    (api.getNoShowPreview as jest.Mock).mockRejectedValue(new Error('network'));
    wrap();
    await waitFor(() => expect(api.getNoShowPreview).toHaveBeenCalled());
    expect(screen.getByText('Facturer un no-show')).toBeInTheDocument();
    expect(screen.queryByText(/déjà facturé/i)).not.toBeInTheDocument();
  });
});
