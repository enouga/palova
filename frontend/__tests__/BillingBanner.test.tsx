import { render, screen, waitFor } from '@testing-library/react';
import { BillingBanner } from '@/components/admin/BillingBanner';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { fontUI: '', text: '#000', textMute: '#555', accent: '#06c' } }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const getBilling = jest.fn();
jest.mock('@/lib/api', () => ({ api: { adminGetBilling: (...a: unknown[]) => getBilling(...a) } }));

describe('BillingBanner', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rien si l état est FREE ou OK', async () => {
    getBilling.mockResolvedValue({ state: 'FREE', activeMembers: 10, monthlyPriceCents: 0 });
    const { container } = render(<BillingBanner clubId="c1" token="t" />);
    await waitFor(() => expect(getBilling).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('bandeau si TO_REGULARIZE avec le prix du palier', async () => {
    getBilling.mockResolvedValue({ state: 'TO_REGULARIZE', activeMembers: 180, monthlyPriceCents: 5900 });
    render(<BillingBanner clubId="c1" token="t" />);
    await waitFor(() => expect(screen.getByText(/dépasse le palier gratuit/i)).toBeInTheDocument());
    expect(screen.getByText(/59,00 €/)).toBeInTheDocument();
  });

  it('bandeau si PAST_DUE', async () => {
    getBilling.mockResolvedValue({ state: 'PAST_DUE', activeMembers: 180, monthlyPriceCents: 5900 });
    render(<BillingBanner clubId="c1" token="t" />);
    await waitFor(() => expect(screen.getByText(/paiement .* échoué/i)).toBeInTheDocument());
  });

  it('rien si l API échoue', async () => {
    getBilling.mockRejectedValue(new Error('x'));
    const { container } = render(<BillingBanner clubId="c1" token="t" />);
    await waitFor(() => expect(getBilling).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
