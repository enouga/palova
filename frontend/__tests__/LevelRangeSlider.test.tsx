import { render, screen, fireEvent } from '@testing-library/react';
import { LevelRangeSlider } from '../components/player/LevelRangeSlider';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (props: Partial<React.ComponentProps<typeof LevelRangeSlider>> = {}) => {
  const onChange = jest.fn();
  render(
    <ThemeProvider>
      <LevelRangeSlider min={3.2} max={5.4} onChange={onChange} {...props} />
    </ThemeProvider>,
  );
  return { onChange };
};

describe('LevelRangeSlider', () => {
  it('affiche les paliers et la fourchette en français', () => {
    wrap();
    expect(screen.getByText(/Élémentaire/)).toBeInTheDocument(); // 3,2 → Élémentaire
    expect(screen.getByText(/Confirmé/)).toBeInTheDocument();    // 5,4 → Confirmé
    expect(screen.getByText('niveau 3,2 à 5,4')).toBeInTheDocument();
  });

  it('déplacer le min au-delà du max le borne (min ≤ max)', () => {
    const { onChange } = wrap();
    fireEvent.change(screen.getByLabelText('Niveau minimum'), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(5.4, 5.4); // clampé sur le max courant
  });

  it('déplacer le max sous le min le borne (max ≥ min)', () => {
    const { onChange } = wrap();
    fireEvent.change(screen.getByLabelText('Niveau maximum'), { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith(3.2, 3.2);
  });

  it('déplacement normal du min', () => {
    const { onChange } = wrap();
    fireEvent.change(screen.getByLabelText('Niveau minimum'), { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith(4, 5.4);
  });

  it('repère « moi » affiché quand myLevel fourni', () => {
    wrap({ myLevel: 4 });
    expect(screen.getByText('moi · 4')).toBeInTheDocument();
  });

  it('pas de repère « moi » sans niveau', () => {
    wrap({ myLevel: null });
    expect(screen.queryByText(/moi ·/)).not.toBeInTheDocument();
  });
});
