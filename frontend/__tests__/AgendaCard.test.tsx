import { render, screen, fireEvent } from '@testing-library/react';
import { AgendaCard } from '../components/agenda/AgendaCard';
import { ThemeProvider } from '../lib/ThemeProvider';
import { ACCENTS } from '../lib/theme';

const NOW = new Date('2026-06-10T12:00:00Z');

const base = {
  icon: 'trophy' as const,
  accent: ACCENTS.apricot,
  tag: 'P500 · Messieurs',
  title: 'Grand Prix Messieurs',
  dateLabel: 'jeudi 9 juillet · 14h01',
  deadline: '2026-07-04T12:01:00Z',
  ratio: 7 / 12 as number | null,
  places: { text: 'Plus que 5 places', urgent: true },
  price: '40 €',
  onClick: jest.fn(),
};

const wrap = (over: Partial<Omit<typeof base, 'price'>> & { now: Date | null; subtitle?: string | null; sportLabel?: string | null; extra?: string | null; price?: string | null }) =>
  render(<ThemeProvider><AgendaCard {...base} {...over} /></ThemeProvider>);

describe('AgendaCard', () => {
  it('affiche tag, titre, date, prix vedette, countdown et places', () => {
    wrap({ now: NOW });
    expect(screen.getByText('P500 · Messieurs')).toBeInTheDocument();
    expect(screen.getByText('Grand Prix Messieurs')).toBeInTheDocument();
    expect(screen.getByText('jeudi 9 juillet · 14h01')).toBeInTheDocument();
    expect(screen.getByText('40 €')).toBeInTheDocument();
    expect(screen.getByText('J-24')).toBeInTheDocument();
    expect(screen.getByText('Plus que 5 places')).toBeInTheDocument();
    expect(screen.getByTestId('card-fill').style.width).toBe('58%');
  });

  it('porte le liseré latéral teinté à l’accent du type', () => {
    const { container } = wrap({ now: NOW });
    const stripe = container.querySelector('[data-club-stripe]') as HTMLElement;
    expect(stripe).not.toBeNull();
    expect(stripe).toHaveStyle({ background: ACCENTS.apricot });
  });

  it('extra reste un suffixe de la ligne de date (sans prix)', () => {
    wrap({ now: NOW, price: null, extra: 'Membres' });
    expect(screen.getByText('jeudi 9 juillet · 14h01 · Membres')).toBeInTheDocument();
    expect(screen.queryByText('40 €')).not.toBeInTheDocument();
  });

  it('now=null → pas de countdown, jauge à 0', () => {
    wrap({ now: null });
    expect(screen.queryByText('J-24')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-fill').style.width).toBe('0px');
  });

  it('affiche le subtitle quand fourni', () => {
    wrap({ now: NOW, subtitle: 'Padel Paris · Paris · 8 km' });
    expect(screen.getByText('Padel Paris · Paris · 8 km')).toBeInTheDocument();
  });

  it('affiche le chip sport quand sportLabel fourni, sinon non', () => {
    const { rerender } = wrap({ now: NOW, sportLabel: 'Tennis' });
    expect(screen.getByTestId('sport-badge')).toHaveTextContent('Tennis');
    rerender(<ThemeProvider><AgendaCard {...base} now={NOW} sportLabel={null} /></ThemeProvider>);
    expect(screen.queryByTestId('sport-badge')).not.toBeInTheDocument();
  });

  it('sans capacité → pas de jauge ; clic → onClick', () => {
    const onClick = jest.fn();
    wrap({ now: NOW, ratio: null, onClick });
    expect(screen.queryByTestId('card-fill')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Grand Prix Messieurs'));
    expect(onClick).toHaveBeenCalled();
  });
});
