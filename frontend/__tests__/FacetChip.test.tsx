import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { FacetChip, FacetGroup, FILTER_TINTS } from '../components/ui/FacetChip';
import { inkOn } from '../lib/theme';

function wrap(ui: React.ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('FILTER_TINTS', () => {
  it('les teintes d’une même barre sont distinctes (Events)', () => {
    const events = [FILTER_TINTS.source, FILTER_TINTS.quand, FILTER_TINTS.categorie, FILTER_TINTS.genre, FILTER_TINTS.typeAnimation, FILTER_TINTS.acces];
    expect(new Set(events).size).toBe(events.length);
  });
});

describe('FacetChip', () => {
  it('active : pill pleine de la teinte, encre inkOn, coche', () => {
    wrap(<FacetChip label="Ce mois-ci" active tint={FILTER_TINTS.quand} onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Ce mois-ci' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveStyle({ background: FILTER_TINTS.quand, color: inkOn(FILTER_TINTS.quand) });
  });

  it('inactive : fond transparent, cliquable', () => {
    const onClick = jest.fn();
    wrap(<FacetChip label="P100" active={false} tint={FILTER_TINTS.categorie} onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'P100' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveStyle({ background: 'transparent' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('compteur en suffixe aria-hidden — le nom accessible reste le libellé seul', () => {
    wrap(<FacetChip label="P100" count={2} active={false} tint={FILTER_TINTS.categorie} onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: 'P100' }); // pas « P100 2 »
    const suffix = btn.querySelector('span[aria-hidden]');
    expect(suffix).toHaveTextContent('2');
  });

  it('count 0 et inactive → estompée (.45) mais cliquable', () => {
    const onClick = jest.fn();
    wrap(<FacetChip label="Animations" count={0} active={false} tint={FILTER_TINTS.source} onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Animations' });
    expect(btn).toHaveStyle({ opacity: 0.45 });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('relaie aria-expanded quand fourni', () => {
    wrap(<FacetChip label="Régler ▾" active={false} tint={FILTER_TINTS.niveau} onClick={() => {}} ariaExpanded />);
    expect(screen.getByRole('button', { name: 'Régler ▾' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('FacetGroup', () => {
  it('libellé + pastille de la teinte + enfants', () => {
    const { container } = wrap(
      <FacetGroup label="Quand" tint={FILTER_TINTS.quand}>
        <span>enfant</span>
      </FacetGroup>,
    );
    expect(screen.getByText('Quand')).toBeInTheDocument();
    expect(screen.getByText('enfant')).toBeInTheDocument();
    const dot = container.querySelector('span[aria-hidden]');
    expect(dot).toHaveStyle({ background: FILTER_TINTS.quand });
  });
});
