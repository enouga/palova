import { render, screen } from '@testing-library/react';
import { StatPill } from '../components/ui/StatPill';
import { ThemeProvider } from '../lib/ThemeProvider';
import { ACCENTS } from '../lib/theme';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('StatPill', () => {
  it('mode simple : rend le label et la valeur, sans jauge', () => {
    wrap(<StatPill icon="wallet" accent={ACCENTS.emerald} label="Porte-monnaie" value="130,00 €" />);
    expect(screen.getByText('Porte-monnaie')).toBeInTheDocument();
    expect(screen.getByText('130,00 €')).toBeInTheDocument();
    expect(screen.queryByTestId('statpill-fill')).not.toBeInTheDocument();
  });

  it('mode jauge : ratio en un seul nœud, suffixe et jauge présents', () => {
    wrap(<StatPill icon="sun" label="Heures pleines" meter={{ used: 3, limit: 5, suffix: 'cette semaine' }} />);
    expect(screen.getByText('Heures pleines')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.getByText('cette semaine')).toBeInTheDocument();
    expect(screen.getByTestId('statpill-fill')).toHaveStyle({ width: '60%' });
  });

  it('plafonne la jauge à 100 % quand used dépasse limit', () => {
    wrap(<StatPill icon="sun" label="Heures pleines" meter={{ used: 30, limit: 1, suffix: 'cette semaine' }} />);
    expect(screen.getByText('30/1')).toBeInTheDocument();
    expect(screen.getByTestId('statpill-fill')).toHaveStyle({ width: '100%' });
  });

  it('fill : occupe toute la largeur de sa cellule', () => {
    const { container } = wrap(<StatPill icon="wallet" accent={ACCENTS.emerald} label="Porte-monnaie" value="130,00 €" fill />);
    expect(container.firstChild).toHaveStyle({ width: '100%' });
  });

  it('warn : expose data-warn ; sinon absent', () => {
    const { rerender } = wrap(
      <StatPill icon="moon" label="Heures creuses" meter={{ used: 2, limit: 2, suffix: 'cette semaine' }} warn />,
    );
    expect(screen.getByText('Heures creuses').closest('[data-warn]')).toHaveAttribute('data-warn', '1');

    rerender(
      <ThemeProvider>
        <StatPill icon="moon" label="Heures creuses" meter={{ used: 0, limit: 2, suffix: 'cette semaine' }} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Heures creuses').closest('[data-warn="1"]')).toBeNull();
  });
});
