import { render, screen } from '@testing-library/react';
import { PricingContent } from '@/components/platform/PricingContent';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: {
    fontUI: '', fontDisplay: '', fontMono: '', text: '#000', textMute: '#555', textFaint: '#999',
    bg: '#fff', bgElev: '#fff', line: '#eee', accent: '#06c',
  } }),
}));

describe('PricingContent (/tarifs)', () => {
  it('affiche la grille des 5 paliers avec les prix', () => {
    render(<PricingContent />);
    expect(screen.getByText('Gratuit')).toBeInTheDocument();
    expect(screen.getByText('29 €')).toBeInTheDocument();
    expect(screen.getByText('59 €')).toBeInTheDocument();
    expect(screen.getByText('99 €')).toBeInTheDocument();
    expect(screen.getByText('149 €')).toBeInTheDocument();
    expect(screen.getByText('801+')).toBeInTheDocument();
  });

  it('met en avant le zéro commission et le tout-inclus pour tous', () => {
    render(<PricingContent />);
    expect(screen.getAllByText(/0 % de commission/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Aucune fonctionnalité n'est verrouillée derrière un palier/)).toBeInTheDocument();
    expect(screen.getByText('Zéro frais caché')).toBeInTheDocument();
    expect(screen.getByText(/Commission Palova sur vos encaissements/)).toBeInTheDocument();
  });

  it('explique le fonctionnement de Stripe (fonds directs au club, frais Stripe seuls)', () => {
    render(<PricingContent />);
    expect(screen.getByText(/Stripe, en direct/)).toBeInTheDocument();
    expect(screen.getByText(/Votre club connecte SON compte Stripe/)).toBeInTheDocument();
    expect(screen.getByText(/ne transitent jamais par Palova/)).toBeInTheDocument();
    expect(screen.getByText(/Palova ne touche jamais votre argent/)).toBeInTheDocument();
  });

  it('définit le membre actif et les règles d ajustement', () => {
    render(<PricingContent />);
    expect(screen.getByText(/90 derniers jours/)).toBeInTheDocument();
    expect(screen.getByText(/deux mois consécutifs/)).toBeInTheDocument();
    expect(screen.getByText(/Aucun prorata/)).toBeInTheDocument();
  });

  it('CTA de création de club', () => {
    render(<PricingContent />);
    expect(screen.getByRole('link', { name: /créer mon club/i })).toHaveAttribute('href', '/clubs/new');
  });
});
