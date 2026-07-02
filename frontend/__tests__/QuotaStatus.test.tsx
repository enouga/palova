import { render, screen } from '@testing-library/react';
import { QuotaStatus } from '../components/quota/QuotaStatus';
import { ThemeProvider } from '../lib/ThemeProvider';
import { MyQuotaStatus } from '../lib/api';

const wrap = (status: MyQuotaStatus | null) =>
  render(<ThemeProvider><QuotaStatus status={status} /></ThemeProvider>);

describe('QuotaStatus', () => {
  it('ne rend rien si status est null', () => {
    const { container } = wrap(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('WEEKLY : libellé « cette semaine » et compteurs des deux classes', () => {
    wrap({ model: 'WEEKLY', peak: { used: 3, limit: 5 }, offPeak: { used: 1, limit: 3 } });
    expect(screen.getByText('Heures pleines')).toBeInTheDocument();
    expect(screen.getByText('Heures creuses')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getAllByText('cette semaine')).toHaveLength(2);
  });

  it('UPCOMING : libellé « à venir »', () => {
    wrap({ model: 'UPCOMING', peak: { used: 0, limit: 2 }, offPeak: null });
    expect(screen.getByText('à venir')).toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('masque la classe illimitée (null)', () => {
    wrap({ model: 'WEEKLY', peak: { used: 1, limit: 2 }, offPeak: null });
    expect(screen.getByText('Heures pleines')).toBeInTheDocument();
    expect(screen.queryByText('Heures creuses')).not.toBeInTheDocument();
  });

  it('ne rend rien si les deux classes sont nulles', () => {
    const { container } = wrap({ model: 'WEEKLY', peak: null, offPeak: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('affiche le compteur même au plafond (used >= limit)', () => {
    wrap({ model: 'WEEKLY', peak: { used: 2, limit: 2 }, offPeak: null });
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('marque seulement la classe au plafond avec data-warn', () => {
    wrap({ model: 'WEEKLY', peak: { used: 30, limit: 1 }, offPeak: { used: 0, limit: 2 } });
    expect(screen.getByText('Heures pleines').closest('[data-warn]')).toHaveAttribute('data-warn', '1');
    expect(screen.getByText('Heures creuses').closest('[data-warn="1"]')).toBeNull();
  });

  it('défaut : enveloppe les pastilles dans un conteneur div', () => {
    const { container } = wrap({ model: 'WEEKLY', peak: { used: 1, limit: 2 }, offPeak: { used: 0, limit: 2 } });
    const kids = Array.from(container.children);
    expect(kids).toHaveLength(1);
    expect(kids[0].tagName).toBe('DIV');
  });

  it('inline : émet les pastilles sans conteneur (enfants directs)', () => {
    const { container } = render(
      <ThemeProvider>
        <QuotaStatus status={{ model: 'WEEKLY', peak: { used: 1, limit: 2 }, offPeak: { used: 0, limit: 2 } }} inline />
      </ThemeProvider>,
    );
    const kids = Array.from(container.children);
    expect(kids).toHaveLength(2);
    expect(kids.every((k) => k.tagName === 'SPAN')).toBe(true);
  });

  it('compact : pastilles pleines & creuses sur une ligne, suffixe affiché une seule fois', () => {
    render(
      <ThemeProvider>
        <QuotaStatus status={{ model: 'WEEKLY', peak: { used: 3, limit: 5 }, offPeak: { used: 1, limit: 3 } }} compact />
      </ThemeProvider>,
    );
    expect(screen.getByText('Heures pleines')).toBeInTheDocument();
    expect(screen.getByText('Heures creuses')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    // suffixe mutualisé : une seule occurrence sous la rangée
    expect(screen.getAllByText('cette semaine')).toHaveLength(1);
  });

  it('fill : transmet la pleine largeur aux pastilles', () => {
    const { container } = render(
      <ThemeProvider>
        <QuotaStatus status={{ model: 'WEEKLY', peak: { used: 1, limit: 2 }, offPeak: null }} inline fill />
      </ThemeProvider>,
    );
    expect(container.firstChild).toHaveStyle({ width: '100%' });
  });
});
