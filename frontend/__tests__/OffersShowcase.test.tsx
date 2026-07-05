import { render, screen, fireEvent } from '@testing-library/react';
import { OffersShowcase } from '@/components/clubhouse/OffersShowcase';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { PublicOffers } from '@/lib/api';

jest.mock('next/dynamic', () => () => {
  const Stub = () => <div data-testid="stripe-step" />;
  return Stub;
});
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: null, slug: 'padel-arena' }) }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    createOfferPlanIntent: jest.fn(),
    createOfferPackageIntent: jest.fn(),
    confirmOfferPayment: jest.fn(),
  },
}));

const offers: PublicOffers = {
  plans: [{ id: 'pl1', name: 'Abo Or', monthlyPrice: '39.00', commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: 1, weeklyCap: null, sportKeys: ['padel'] }],
  packages: [{ id: 'tp1', name: 'Carnet 10', kind: 'ENTRIES', price: '90.00', entriesCount: 10, walletAmount: null, validityDays: 365 }],
  onlinePurchase: true,
};

const wrap = (over: { offers?: PublicOffers; token?: string | null; hasSub?: boolean; onAuthPrompt?: () => void }) =>
  render(
    <ThemeProvider>
      <OffersShowcase
        offers={over.offers ?? offers}
        token={over.token === undefined ? 't' : over.token}
        hasActiveSubscription={over.hasSub ?? false}
        onAuthPrompt={over.onAuthPrompt ?? (() => {})}
        onPurchased={() => {}}
      />
    </ThemeProvider>,
  );

describe('OffersShowcase', () => {
  it('cartes plan + carnet avec prix et avantages', () => {
    wrap({});
    expect(screen.getByText('Abo Or')).toBeInTheDocument();
    expect(screen.getByText('39,00 €')).toBeInTheDocument();
    expect(screen.getByText('/ mois')).toBeInTheDocument();
    expect(screen.getByText(/Heures creuses/)).toBeInTheDocument();
    expect(screen.getByText('Carnet 10')).toBeInTheDocument();
  });

  it('déjà abonné → cartes plan masquées, carnets conservés', () => {
    wrap({ hasSub: true });
    expect(screen.queryByText('Abo Or')).toBeNull();
    expect(screen.getByText('Carnet 10')).toBeInTheDocument();
  });

  it('Souscrire ouvre la feuille de paiement Stripe', () => {
    wrap({});
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    expect(screen.getByTestId('stripe-step')).toBeInTheDocument();
  });

  it('anonyme → onAuthPrompt, pas de feuille', () => {
    const onAuthPrompt = jest.fn();
    wrap({ token: null, onAuthPrompt });
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    expect(onAuthPrompt).toHaveBeenCalled();
    expect(screen.queryByTestId('stripe-step')).toBeNull();
  });

  it('achat en ligne indisponible → CTA accueil, pas de bouton Souscrire', () => {
    wrap({ offers: { ...offers, onlinePurchase: false } });
    expect(screen.queryByRole('button', { name: /Souscrire/i })).toBeNull();
    expect(screen.getAllByText(/Renseignez-vous à l’accueil/i).length).toBeGreaterThan(0);
  });
});
