import { render, screen } from '@testing-library/react';
import { HomeAgenda } from '../components/platform/home/HomeAgenda';
import { ThemeProvider } from '../lib/ThemeProvider';
import { buildAgendaList } from '../lib/calendar';
import { MyReservation } from '../lib/api';

const NOW = new Date('2026-07-22T12:00:00.000Z');
const res = (id: string, slug: string, name: string, accentColor?: string): MyReservation => ({
  id, startTime: '2026-07-23T10:00:00.000Z', endTime: '2026-07-23T11:00:00.000Z',
  status: 'CONFIRMED', totalPrice: '25', capacity: 4, participants: [],
  resource: { id: `c-${id}`, name, club: { name: slug, slug, timezone: 'Europe/Paris', ...(accentColor ? { accentColor } : {}) } },
});

describe('HomeAgenda', () => {
  it('cartes avec marqueur club (liseré + chip — plateforme : marqueur partout) et lien Tout voir', () => {
    const items = buildAgendaList([res('1', 'padel-arena', 'Court A', '#5e93da'), res('2', 'bordeaux', 'Court B', '#7c5cff')], [], [], [], NOW);
    const { container } = render(<ThemeProvider><HomeAgenda items={items} /></ThemeProvider>);
    expect(screen.getByText('Court A')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-club-stripe]')).toHaveLength(2);
    expect(screen.getByText('bordeaux').tagName).toBe('SPAN'); // chip club
    expect(screen.getByRole('link', { name: /Tout voir/ })).toHaveAttribute('href', '/me/reservations');
  });

  it('aucune entrée → rien (la section disparaît, le hero fallback fait l\'invitation)', () => {
    const { container } = render(<ThemeProvider><HomeAgenda items={[]} /></ThemeProvider>);
    expect(container.firstChild).toBeNull();
  });
});
