import { render, screen } from '@testing-library/react';
import { HomeHero } from '../components/platform/home/HomeHero';
import { ThemeProvider } from '../lib/ThemeProvider';
import { buildAgendaList } from '../lib/calendar';
import { MyReservation } from '../lib/api';

const NOW = Date.parse('2026-07-22T12:00:00.000Z');
const resa: MyReservation = {
  id: 'r1', startTime: '2026-07-23T10:00:00.000Z', endTime: '2026-07-23T11:00:00.000Z',
  status: 'CONFIRMED', totalPrice: '25', capacity: 4, participants: [],
  resource: { id: 'c1', name: 'Terrain 3', club: { name: 'Padel Arena Paris', slug: 'padel-arena-paris', timezone: 'Europe/Paris' } },
};
const [entry] = buildAgendaList([resa], [], [], [], new Date(NOW));

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('HomeHero', () => {
  it('salue par prénom et met la prochaine entrée en vedette avec compte à rebours', () => {
    wrap(<HomeHero firstName="Eric" entry={entry} now={NOW} />);
    expect(screen.getByText(/Bonjour Eric/)).toBeInTheDocument();
    expect(screen.getByText(/Terrain 3/)).toBeInTheDocument();
    expect(screen.getByText('Padel Arena Paris')).toBeInTheDocument();
    expect(screen.getByText(/dans 22 h/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Gérer/ })).toHaveAttribute('href', '/me/reservations');
  });

  it('agenda vide → invitation « Trouve ta prochaine partie » + CTA Découvrir (jamais de hero creux)', () => {
    wrap(<HomeHero firstName="Eric" entry={null} now={NOW} />);
    expect(screen.getByText(/Trouve ta prochaine partie/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Découvrir/ })).toHaveAttribute('href', '/decouvrir');
  });

  it('horloge non résolue (now null) → pas de chip compte à rebours (hydration-safe)', () => {
    wrap(<HomeHero firstName={null} entry={entry} now={null} />);
    expect(screen.queryByText(/dans \d/)).toBeNull();
    expect(screen.getByText(/Terrain 3/)).toBeInTheDocument();
  });
});
