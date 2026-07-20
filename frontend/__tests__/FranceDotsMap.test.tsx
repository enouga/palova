import { render, screen } from '@testing-library/react';
import { FranceDotsMap } from '@/components/platform/FranceDotsMap';

describe('FranceDotsMap', () => {
  it('rend une couche décorative aria-hidden et non interactive', () => {
    render(<FranceDotsMap />);
    const layer = screen.getByTestId('france-dots');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).toHaveStyle({ pointerEvents: 'none' });
  });

  it('pins="full" (défaut) allume 6 clubs, "few" en allume 3, "none" aucun', () => {
    const { unmount } = render(<FranceDotsMap />);
    expect(screen.getAllByTestId('france-pin')).toHaveLength(6);
    unmount();
    const r2 = render(<FranceDotsMap pins="few" />);
    expect(screen.getAllByTestId('france-pin')).toHaveLength(3);
    r2.unmount();
    render(<FranceDotsMap pins="none" />);
    expect(screen.queryAllByTestId('france-pin')).toHaveLength(0);
  });

  it('le style du parent est fusionné (taille/position posées par le consommateur)', () => {
    render(<FranceDotsMap style={{ opacity: 0.5 }} />);
    expect(screen.getByTestId('france-dots')).toHaveStyle({ opacity: 0.5 });
  });
});
