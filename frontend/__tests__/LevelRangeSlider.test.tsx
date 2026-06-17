import { render, screen, fireEvent } from '@testing-library/react';
import { LevelRangeSlider } from '../components/player/LevelRangeSlider';
import { ThemeProvider } from '../lib/ThemeProvider';
import { LEVEL_QUIPS } from '../lib/levelQuips';

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
  it('affiche la fourchette en français', () => {
    wrap();
    expect(screen.getByText('3,2 à 5,4')).toBeInTheDocument();
  });

  it('au départ : décrit la borne min (palier + vanne du bon palier)', () => {
    wrap(); // min=3,2 → palier 3 Élémentaire
    expect(screen.getByText(/Niveau minimum/)).toBeInTheDocument();
    expect(screen.getByText(/Élémentaire/)).toBeInTheDocument();
    // la phrase affichée appartient au répertoire du palier 3
    expect(screen.getByText((t) => LEVEL_QUIPS[2].includes(t))).toBeInTheDocument();
  });

  it('activer la poignée max : décrit la borne max avec une vanne de son palier', () => {
    wrap(); // max=5,4 → palier 5 Confirmé
    fireEvent.focus(screen.getByLabelText('Niveau maximum'));
    expect(screen.getByText(/Niveau maximum/)).toBeInTheDocument();
    expect(screen.getByText(/Confirmé/)).toBeInTheDocument();
    expect(screen.getByText((t) => LEVEL_QUIPS[4].includes(t))).toBeInTheDocument();
  });

  it('déplacer le min au-delà du max le borne (min ≤ max)', () => {
    const { onChange } = wrap();
    fireEvent.change(screen.getByLabelText('Niveau minimum'), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(5.4, 5.4);
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
});
