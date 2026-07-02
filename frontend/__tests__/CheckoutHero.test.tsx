import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { CheckoutHero } from '@/components/checkout/CheckoutHero';

const slot = { startTime: '2026-07-03T16:00:00Z', endTime: '2026-07-03T17:30:00Z', offPeak: false };
const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

it('affiche court, prix, part joueur et timer', () => {
  wrap(<CheckoutHero slot={slot} timezone="Europe/Paris" resourceName="Court 2" format="double"
    sportKey="padel" totalPrice="25" perPerson="6,25" capacity={4} durLabel="1h30"
    phase="held" mm="04" ss="23" urgent={false} secondsLeft={263} holdSeconds={300} />);
  expect(screen.getByTestId('checkout-hero')).toBeInTheDocument();
  expect(screen.getByText('Court 2')).toBeInTheDocument();
  // Regex exacte : "6,25 € / joueur" contient aussi la sous-chaîne "25 €",
  // donc on cible le texte exact du prix total plutôt qu'un motif ambigu.
  expect(screen.getByText((_, node) => node?.textContent === '25€')).toBeInTheDocument();
  expect(screen.getByText(/6,25/)).toBeInTheDocument();
  expect(screen.getByText(/04:23/)).toBeInTheDocument();
});

it('barre de hold et timer masqués en phase error', () => {
  wrap(<CheckoutHero slot={slot} timezone="Europe/Paris" resourceName="Court 2"
    sportKey="padel" totalPrice="25" perPerson="6,25" capacity={4} durLabel="1h30"
    phase="error" mm="00" ss="00" urgent={true} secondsLeft={0} holdSeconds={300} />);
  expect(screen.getByTestId('checkout-hero')).toBeInTheDocument();
  expect(screen.queryByText(/00:00/)).toBeNull();   // timer pill hidden in error phase
});
