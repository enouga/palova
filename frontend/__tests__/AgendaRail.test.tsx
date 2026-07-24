import { render, screen, fireEvent } from '@testing-library/react';
import { AgendaRail } from '../components/agenda/AgendaRail';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const cards = (n: number) => Array.from({ length: n }, (_, i) => <div key={i}>Carte {i + 1}</div>);

describe('AgendaRail', () => {
  it('rend les enfants, le compteur et un point cliquable par carte', () => {
    wrap(<AgendaRail countLabel="8 tournois" prevLabel="Préc" nextLabel="Suiv">{cards(8)}</AgendaRail>);
    expect(screen.getByText('8 tournois')).toBeInTheDocument();
    expect(screen.getByText('Carte 1')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Aller à la carte/ })).toHaveLength(8);
  });

  it('1 seule carte, ou plus de 12 → pas de points', () => {
    const { unmount } = wrap(<AgendaRail prevLabel="p" nextLabel="s">{cards(1)}</AgendaRail>);
    expect(screen.queryByRole('button', { name: /Aller à la carte/ })).not.toBeInTheDocument();
    unmount();
    wrap(<AgendaRail prevLabel="p" nextLabel="s">{cards(13)}</AgendaRail>);
    expect(screen.queryByRole('button', { name: /Aller à la carte/ })).not.toBeInTheDocument();
  });

  it("desktopRows 'auto' : 1 rangée jusqu'à 4 cartes, 2 au-delà", () => {
    const { container, unmount } = wrap(<AgendaRail prevLabel="p" nextLabel="s">{cards(4)}</AgendaRail>);
    expect((container.querySelector('.ag-rail') as HTMLElement).style.getPropertyValue('--ag-rows')).toBe('repeat(1, auto)');
    unmount();
    const { container: c2 } = render(
      <ThemeProvider><AgendaRail prevLabel="p" nextLabel="s">{cards(5)}</AgendaRail></ThemeProvider>,
    );
    expect((c2.querySelector('.ag-rail') as HTMLElement).style.getPropertyValue('--ag-rows')).toBe('repeat(2, auto)');
  });

  it('clic sur un point → défilement du rail', () => {
    const scrollTo = jest.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, writable: true });
    wrap(<AgendaRail prevLabel="p" nextLabel="s">{cards(3)}</AgendaRail>);
    fireEvent.click(screen.getByRole('button', { name: 'Aller à la carte 2' }));
    expect(scrollTo).toHaveBeenCalled();
  });
});
