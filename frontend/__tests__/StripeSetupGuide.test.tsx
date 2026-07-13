import { render, screen, fireEvent } from '@testing-library/react';
import { StripeSetupGuide } from '@/components/admin/StripeSetupGuide';
import { ThemeProvider } from '@/lib/ThemeProvider';

const wrap = (status: 'NONE' | 'PENDING' | 'RESTRICTED' | 'ACTIVE') =>
  render(<ThemeProvider><StripeSetupGuide status={status} /></ThemeProvider>);

describe('StripeSetupGuide', () => {
  it('statut non-ACTIVE : le guide est ouvert par défaut', () => {
    wrap('NONE');
    expect(screen.getByText('Préparez vos informations')).toBeVisible();
  });

  it('statut ACTIVE : le guide est replié par défaut', () => {
    wrap('ACTIVE');
    expect(screen.queryByText('Préparez vos informations')).not.toBeInTheDocument();
  });

  it('le clic sur l\'en-tête ouvre/replie le guide', () => {
    wrap('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: /Comment activer le paiement en ligne/ }));
    expect(screen.getByText('Préparez vos informations')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Comment activer le paiement en ligne/ }));
    expect(screen.queryByText('Préparez vos informations')).not.toBeInTheDocument();
  });

  it('affiche les 4 étapes', () => {
    wrap('NONE');
    expect(screen.getByText('Préparez vos informations')).toBeInTheDocument();
    expect(screen.getByText('Connectez votre compte')).toBeInTheDocument();
    expect(screen.getByText("Vérifiez l'activation")).toBeInTheDocument();
    expect(screen.getByText('Choisissez vos options et testez')).toBeInTheDocument();
  });

  it('affiche l\'encart de test en conditions réelles, sans encart développeurs', () => {
    wrap('NONE');
    expect(screen.getByText('En conditions réelles (recommandé)')).toBeInTheDocument();
    expect(screen.queryByText('Environnement de test (développeurs)')).not.toBeInTheDocument();
    expect(screen.queryByText(/4242 4242 4242 4242/)).not.toBeInTheDocument();
  });

  it('affiche les liens vers la documentation Stripe officielle', () => {
    wrap('NONE');
    const link = screen.getByRole('link', { name: /Créer un compte Stripe Express/ });
    expect(link).toHaveAttribute('href', 'https://docs.stripe.com/connect/express-accounts?locale=fr-FR');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
