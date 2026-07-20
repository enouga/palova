import { render, screen, fireEvent, within } from '@testing-library/react';
import { OffersShowcase } from '@/components/clubhouse/OffersShowcase';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { PublicOffers } from '@/lib/api';
import { ACCENTS } from '@/lib/theme';

jest.mock('next/dynamic', () => () => {
  const Stub = () => <div data-testid="stripe-step" />;
  return Stub;
});
let clubCtx: { club: { clubSports?: { sport: { key: string; name: string } }[] } | null; slug: string } =
  { club: null, slug: 'padel-arena' };
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => clubCtx }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    createOfferPlanIntent: jest.fn(),
    createOfferPackageIntent: jest.fn(),
    confirmOfferPayment: jest.fn(),
  },
}));

const offers: PublicOffers = {
  plans: [{ id: 'pl1', name: 'Abo Or', description: 'Accès illimité aux heures creuses, résiliable après 12 mois.', imageUrl: null, monthlyPrice: '39.00', commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: 1, weeklyCap: null, sportKeys: ['padel'] }],
  packages: [{ id: 'tp1', name: 'Carnet 10', sportKeys: [], description: null, imageUrl: null, kind: 'ENTRIES', price: '90.00', entriesCount: 10, walletAmount: null, validityDays: 365 }],
  onlinePurchase: true,
};

const wrap = (over: { offers?: PublicOffers; token?: string | null; onAuthPrompt?: () => void }) =>
  render(
    <ThemeProvider>
      <OffersShowcase
        offers={over.offers ?? offers}
        token={over.token === undefined ? 't' : over.token}
        onAuthPrompt={over.onAuthPrompt ?? (() => {})}
        onPurchased={() => {}}
      />
    </ThemeProvider>,
  );

describe('OffersShowcase', () => {
  beforeEach(() => { clubCtx = { club: null, slug: 'padel-arena' }; });

  it('cartes plan + carnet avec prix et avantages', () => {
    wrap({});
    expect(screen.getByText('Abo Or')).toBeInTheDocument();
    expect(screen.getByText('39,00 €')).toBeInTheDocument();
    expect(screen.getByText('/ mois')).toBeInTheDocument();
    // Chips de type teintées par carte.
    expect(screen.getByText('Abonnement')).toBeInTheDocument();
    expect(screen.getByText('Carnet')).toBeInTheDocument();
    expect(screen.getByText('Carnet 10')).toBeInTheDocument();
  });

  it('les abonnements sont toujours affichés (même déjà abonné)', () => {
    // Choix produit « toujours tout afficher » : plus aucun masquage des plans.
    wrap({});
    expect(screen.getByText('Abo Or')).toBeInTheDocument();
    expect(screen.getByText('Carnet 10')).toBeInTheDocument();
  });

  it('Souscrire sur une carte ouvre la modale de détail avec la description complète', () => {
    wrap({});
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Accès illimité aux heures creuses/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Engagement 12 mois/)).toBeInTheDocument();
  });

  it('anonyme peut voir la modale de détail sans être connecté', () => {
    wrap({ token: null });
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Accès illimité aux heures creuses/)).toBeInTheDocument();
  });

  it('offre sans description : pas de paragraphe superflu, les caractéristiques restent affichées', () => {
    wrap({});
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[1]); // carnet, description: null
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/10 entrées/)).toBeInTheDocument();
  });

  it('image de l’offre affichée dans la modale si présente, absente sinon', () => {
    wrap({ offers: { ...offers, plans: [{ ...offers.plans[0], imageUrl: '/uploads/offers/pl1-1.jpg' }] } });
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', expect.stringContaining('/uploads/offers/pl1-1.jpg'));

    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[1]); // carnet, imageUrl: null
    expect(within(screen.getByRole('dialog')).queryByRole('img')).toBeNull();
  });

  it('depuis la modale : souscrire ouvre la feuille de paiement Stripe (connecté)', () => {
    wrap({});
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Souscrire ·/i }));
    // Case CGV obligatoire avant que le formulaire de paiement n'apparaisse
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByTestId('stripe-step')).toBeInTheDocument();
  });

  it('depuis la modale : souscrire anonyme déclenche onAuthPrompt, pas de feuille Stripe', () => {
    const onAuthPrompt = jest.fn();
    wrap({ token: null, onAuthPrompt });
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Souscrire ·/i }));
    expect(onAuthPrompt).toHaveBeenCalled();
    expect(screen.queryByTestId('stripe-step')).toBeNull();
  });

  it('achat en ligne indisponible → la modale invite à régler à l’accueil, pas de bouton de paiement', () => {
    wrap({ offers: { ...offers, onlinePurchase: false } });
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/se règle directement à l’accueil du club/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Souscrire ·/i })).toBeNull();
  });

  it('Fermer ferme la modale sans ouvrir de paiement', () => {
    wrap({});
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('club multi-sport : le sport apparaît sur la carte et dans la modale', () => {
    clubCtx = {
      slug: 'padel-arena',
      club: { clubSports: [{ sport: { key: 'padel', name: 'Padel' } }, { sport: { key: 'tennis', name: 'Tennis' } }] },
    };
    wrap({ offers: { ...offers, packages: [{ ...offers.packages[0], sportKeys: ['tennis'] }] } });
    // Sur la carte, les lignes d'avantages sont jointes en une seule chaîne (`lines.join(' · ')`) —
    // la ligne sport est en tête, d'où le match par regex plutôt qu'un texte exact.
    expect(screen.getByText(/^Padel ·/)).toBeInTheDocument(); // carte abonnement
    expect(screen.getByText(/^Tennis ·/)).toBeInTheDocument(); // carte carnet
    // Dans la modale, chaque avantage est un <li> séparé — la ligne sport y est un texte exact isolé.
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    expect(within(screen.getByRole('dialog')).getByText('Padel')).toBeInTheDocument();
  });

  it('club mono-sport (ou non chargé) : bandeau de couleur de type, aucune section de sport', () => {
    wrap({});
    expect(screen.queryByTestId('offer-sport-kicker')).toBeNull();
    const stripe = screen.getByText('Abo Or').closest('.of-card')!.querySelector('[data-testid="offer-stripe"]')!;
    expect(stripe).toHaveStyle({ background: ACCENTS.blue });
  });

  it('club multi-sport : sections par sport dans l’ordre du club, « Tous sports » en dernier, bandeau ≠ badge', () => {
    clubCtx = {
      slug: 'padel-arena',
      club: { clubSports: [{ sport: { key: 'padel', name: 'Padel' } }, { sport: { key: 'tennis', name: 'Tennis' } }] },
    };
    wrap({
      offers: {
        ...offers,
        plans: [{ ...offers.plans[0], sportKeys: ['padel'] }],
        packages: [
          { ...offers.packages[0], id: 'tp-tennis', name: 'Carnet Tennis', sportKeys: ['tennis'] },
          { ...offers.packages[0], id: 'tp-multi', name: 'Carnet Multi', sportKeys: [] },
        ],
      },
    });
    const kickers = screen.getAllByTestId('offer-sport-kicker');
    expect(kickers.map((k) => k.textContent)).toEqual(['Padel', 'Tennis', 'Tous sports']);

    const padelStripe = screen.getByText('Abo Or').closest('.of-card')!.querySelector('[data-testid="offer-stripe"]')!;
    expect(padelStripe).toHaveStyle({ background: '#7FAE86' });
    expect(padelStripe).not.toHaveStyle({ background: ACCENTS.blue });

    const multiStripe = screen.getByText('Carnet Multi').closest('.of-card')!.querySelector('[data-testid="offer-stripe"]')!;
    expect(multiStripe).toHaveStyle({ background: '#B9B3A8' });
  });
});
