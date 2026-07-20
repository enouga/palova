import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { FacetPanel } from '../components/calendar/FacetPanel';
import { emptyCalendarState } from '../lib/tournamentCalendar';

const facets = {
  departments: [{ code: '75', name: 'Paris', count: 2 }, { code: '69', name: 'Rhône', count: 1 }],
  categories: [{ value: 'P500', count: 2 }, { value: 'P1000', count: 1 }],
  genders: [{ value: 'MEN' as const, count: 1 }, { value: 'WOMEN' as const, count: 1 }],
};

function setup(over: Partial<React.ComponentProps<typeof FacetPanel>> = {}) {
  const props = {
    facets, state: emptyCalendarState(),
    onToggleDept: jest.fn(), onToggleCategory: jest.fn(), onToggleGender: jest.fn(),
    onSetPreset: jest.fn(), onSetRange: jest.fn(), onToggleNearMe: jest.fn(), onClear: jest.fn(),
    ...over,
  };
  render(<ThemeProvider><FacetPanel {...props} /></ThemeProvider>);
  return props;
}

describe('FacetPanel', () => {
  it('rend les chips de département avec compteur et déclenche le toggle', () => {
    const p = setup();
    fireEvent.click(screen.getByText(/Paris/));
    expect(p.onToggleDept).toHaveBeenCalledWith('75');
  });

  it('le bouton « Autour de moi » déclenche onToggleNearMe', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: /Autour de moi/i }));
    expect(p.onToggleNearMe).toHaveBeenCalled();
  });

  it('le pied « Effacer les filtres » apparaît quand un filtre est actif', () => {
    const state = { ...emptyCalendarState(), deptCodes: new Set(['75']) };
    const p = setup({ state });
    fireEvent.click(screen.getByRole('button', { name: /Effacer les filtres/ }));
    expect(p.onClear).toHaveBeenCalled();
  });

  it('la rangée Quand porte la chip « Dates » (plus d\'inputs natifs)', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Dates' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Du')).not.toBeInTheDocument(); // les <input type=date> ont disparu
  });

  it('avec une plage posée : chip pleine + ✕ → onSetRange(null, null)', () => {
    const state = { ...emptyCalendarState(), from: '2026-07-24', to: '2026-08-02' };
    const p = setup({ state });
    expect(screen.getByRole('button', { name: /24 juil\. → 2 août/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer les dates' }));
    expect(p.onSetRange).toHaveBeenCalledWith(null, null);
  });

  // Régression : Group était défini DANS FacetPanel (nouvelle identité à chaque rendu → React
  // remontait le sous-arbre, et le calendrier se refermait au 1ᵉʳ tap). Harnais à état requis :
  // un onSetRange en jest.fn() ne re-rend pas, donc ne reproduit pas le remount.
  it('poser un début ne referme pas le calendrier (pas de remount du groupe Quand)', () => {
    function Harness() {
      const [state, setState] = useState(emptyCalendarState());
      return (
        <ThemeProvider>
          <FacetPanel facets={facets} state={state}
            onToggleDept={jest.fn()} onToggleCategory={jest.fn()} onToggleGender={jest.fn()}
            onSetPreset={jest.fn()} onSetRange={(from, to) => setState((s) => ({ ...s, from, to }))}
            onToggleNearMe={jest.fn()} onClear={jest.fn()} />
        </ThemeProvider>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dates' }));
    const dlg = screen.getByRole('dialog');
    const day = within(dlg).getAllByRole('button', { name: /^\d{2}\/\d{2}\/\d{4}$/ })[10];
    fireEvent.click(day);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('« Autour de moi » vit dans le groupe Où (plus de pill isolée au-dessus)', () => {
    setup();
    expect(screen.getByText('Où')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Autour de moi/i })).toBeInTheDocument();
  });

  it('pied « N résultats » rendu si resultCount fourni et filtre actif, absent sinon', () => {
    const state = { ...emptyCalendarState(), deptCodes: new Set(['75']) };
    const r1 = render(
      <ThemeProvider>
        <FacetPanel facets={facets} state={state} resultCount={3}
          onToggleDept={jest.fn()} onToggleCategory={jest.fn()} onToggleGender={jest.fn()}
          onSetPreset={jest.fn()} onSetRange={jest.fn()} onToggleNearMe={jest.fn()} onClear={jest.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByText('3 résultats')).toBeInTheDocument();
    r1.unmount();
    setup(); // aucun filtre actif → pas de pied du tout
    expect(screen.queryByText(/résultat/)).not.toBeInTheDocument();
  });
});
